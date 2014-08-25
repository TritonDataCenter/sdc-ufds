/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */


/*
 * A brief overview of this source file: what is its purpose.
 */

module.exports = Instance;

var assert = require('assert-plus');
var EventEmitter = require('events').EventEmitter;
var vasync = require('vasync');
var ldap = require('ldapjs');
var util = require('util');
var sprintf = require('util').format;
var backoff = require('backoff');
var once = require('once');

var Checkpoint = require('./checkpoint');
var errors = require('./errors');
var ops = require('./operations');

var CHANGELOG = 'cn=changelog';

var LDAP_PROXY_EVENTS = [
    'connect',
    'connectTimeout',
    'close',
    'end',
    'error',
    'socketTimeout',
    'timeout'
];

/*
 * Instance constructor
 *
 * Required
 * - replicator
 * - remoteUfds
 * - replicationSuffix
 * - checkpointDn
 * - log
 * - pollInterval
 */
function Instance(options) {
    assert.object(options, 'options');
    assert.object(options.log, 'options.log');
    assert.object(options.replicator, 'options.replicator');
    assert.object(options.remoteCfg, 'options.remoteCfg');
    assert.number(options.pollInterval, 'options.pollInterval');
    assert.number(options.queueSize, 'options.queueSize');
    assert.number(options.localUfdsVersion, 'options.localUfdsVersion');

    EventEmitter.call(this);

    /**
     * Client Identifier
     */
    this.id = options.id;

    /**
     * Bunyan Logger
     */
    this.log = options.log;

    /**
     * The interval to poll UFDS
     */
    this.pollInterval = options.pollInterval;

    /**
     * Indicates whether we are already polling UFDS
     */
    this.currPolling = false;

    /**
     * Indicates if we are seeing new changelog entries at the moment. When
     * the upstream UFDS returns changelogs we will be catching up until the
     * queue is drained and we don't get more changelogs in the next iteration
     */
    this.caughtUp = false;

    /**
     * There is a bug with res.sentEntries at the moment
     */
    this.sentEntries = 0;


    /**
     * The serial entry queue, ensure entries are processed serially.
     */
    this.queue = vasync.queue(handleEntry, 1);
    this.queueError = false;

    /**
     * Maximum number of entries to process per interval
     */
    this.queueSize = options.queueSize;

    /**
     * The latest consumed changenumber. This number represents the latest entry
     * that was actually consumed
     */
    this.changenumber = 0;

    /**
     * The latest received search entry changenumber. This number represents the
     * latest entry that was received in the onSearchEntry callback.
     */
    this.searchnumber = 0;

    /**
     * Replication suffix
     */
    // this.replicationSuffix = options.replicationSuffix || '';

    /**
     * Checkpoint DN
     */
    this.checkpoint = null;
    this.checkpointDn = options.checkpointDn;

    /**
     * Local UFDS replicator client
     */
    this.replicator = options.replicator;

    /**
     * Remote UFDS client
     *
     * The replication url has the following form:
     * ldapurl = scheme://[hostport]/dn?attributes?scope?filter?extensions
     *
     * - dn: root dn to replicate from
     * - attributes: attributes to return
     * - scope: one, base or sub
     * - filter: ldap filter
     * - extensions: ladp extensions
     *
     * For now we will focus on dn, scope and filter only
     */
    this.remoteCfg = options.remoteCfg;
    this.remoteUfds = null;

    /**
     * Retry options
     */
    this.retry = options.retry || {};

    /**
     * The local UFDS version, used to stop propagation when the remote has
     * been updated, but the local UFDS hasn't.
     */
    this.localUfdsVersion = options.localUfdsVersion;
}

util.inherits(Instance, EventEmitter);



/*
 * Accessor for the localUfds instance
 */
Instance.prototype.localUfds = function (callback) {
    var replicator = this.replicator;

    return replicator.ensureLocalUfds(function () {
        return callback(replicator.localUfds);
    });
};



/*
 * Entry point for initializing the replicator. After creating a new replicator
 * instance you just need to call this method while providing a cb(err) function
 * callback. initCheckpoint gets called if the connection to the remote client
 * was successful
 */
Instance.prototype.init = function (cb) {
    var self = this;
    cb = once(cb);

    function connect() {
        self.connecting = true;
        self.createClient(function (err, client) {
            self.connecting = false;

            if (err) {
                cb(err);
                return;
            }

            if (self.closed && client) {
                client.unbind();
                return;
            }

            function handleClose() {
                if (self.remoteUfds && !self.connecting && !self.closed) {
                    self.log.warn(err, 'client [%d] disconnected', self.id);
                    self.remoteUfds = null;
                    if (self.timer) {
                        clearInterval(self.timer);
                    }
                    connect();
                }
            }

            client.once('error', handleClose);
            client.once('close', handleClose);
            self.remoteUfds = client;
            self.initCheckpoint(cb);
            return;
        });
    }

    connect();
};


/*
 * Creates a new LDAP client
 */
Instance.prototype.createClient = function (cb) {
    var self = this;
    var log = self.log;
    cb = once(cb);

    this.parseReplicationQueries();
    this.setupQueue();

    var dn = self.remoteCfg.bindDN;
    var pw = self.remoteCfg.bindCredentials;

    var retryOpts = this.retry;
    retryOpts.maxDelay = retryOpts.maxDelay || retryOpts.maxTimeout || 30000;
    retryOpts.retries = retryOpts.retries || Infinity;

    function _createClient(_, _cb) {
        var client = ldap.createClient(self.remoteCfg);
        client.once('connect', onConnect);
        client.on('error', onError);

        function onConnect() {
            client.removeListener('error', onError);
            log.trace('ldap: client [%d] connected to local UFDS', self.id);

            client.bind(dn, pw, function (err) {
                if (err) {
                    log.error({
                        bindDN: dn,
                        err: err
                    }, 'client [%d]: invalid credentials; aborting', self.id);
                    return _cb(err);
                }

                log.info({
                    bindDN: dn
                }, 'Remote UFDS [%d]: connected and bound', self.id);
                client.socket.setKeepAlive(true);
                return _cb(null, client);
            });
        }

        function onError(err) {
            client.removeListener('connect', onConnect);
            log.fatal(err, 'Remote UFDS client [%d] error', self.id);
            return _cb(err);
        }
    }

    var retry = backoff.call(_createClient, null, cb);

    retry.setStrategy(new backoff.ExponentialStrategy(retryOpts));
    retry.failAfter(retryOpts.retries);

    retry.on('backoff', function (number, delay) {
        var level;
        if (number === 0) {
            level = 'info';
        } else if (number < 5) {
            level = 'warn';
        } else {
            level = 'error';
        }

        log[level]({
            attempt: number,
            delay: delay
        }, 'ufds: client [%d] connection attempt failed', self.id);
    });

    retry.start();
};


/*
 * Initializes the checkpoint for this instance. The checkpoints gets saved in
 * a specific tree and its uid will be calcualted based on the url and the
 * replication queries so two checkpoints are the same only if they are about
 * replication profile
 */
Instance.prototype.initCheckpoint = function (cb) {
    var self = this;
    var log = this.log;

    var chkOps = {
        replicator: this.replicator,
        url: this.remoteCfg.url,
        queries: this.remoteCfg.queries,
        dn: this.checkpointDn
    };

    this.checkpoint = new Checkpoint(chkOps);
    this.checkpoint.init(onCheckpoint);

    function onCheckpoint(err, changenumber) {
        if (err) {
            log.fatal(err, '[%d] Unable to initialize checkpoint', self.id);
            return cb(err);
        }

        self.log.debug('Checkpoint initialized');
        self.changenumber = changenumber;
        self.searchnumber = changenumber;

        log.info('[%d] UFDS client bound!', self.id);
        self.timer = setInterval(tryPoll, self.pollInterval, self);
        tryPoll(self);

        return cb();
    }
};



/*
 * Specific setup for the serial vasync queue. For now we just define the
 * function to be called when the queue is drained. It's very important since
 * this is where we make the jump to the last searchnumber
 */
Instance.prototype.setupQueue = function () {
    var self = this;

    // If we are not processing the queue we can continue with the search
    this.queue.drain = onDrain;

    function onDrain() {
        self.currPolling = false;
        self.searchnumber = self.searchnumber + 1;

        // Reset the flag for the next queue
        if (self.queueError === true) {
            self.queueError = false;
        } else {
            updateChangenumber(self, self.searchnumber, function (err) {
                if (err) {
                    self.log.error(err, '[%d] updateChangenumber failed',
                        self.id);
                } else {
                    self.log.debug('[%d] Drained processing queue', self.id);
                    self.log.debug('[%d] Updated changenumber to %s', self.id,
                        self.changenumber);
                }
            });
        }
    }
};



/*
 * Each instance can replicate data from one or more subtrees. A replication
 * is the query fragment of an LDAP replication URL. When these queries are
 * provided in the config, they need to be parsed for correctness and set some
 * default values when they are not present, such as default filter to be
 * (objectclass=*)
 */
Instance.prototype.parseReplicationQueries = function () {
    this.queries = [];

    assert.arrayOfString(this.remoteCfg.queries, 'remoteCfg.queries');

    for (var i = 0; i < this.remoteCfg.queries.length; i++) {
        var query = this.remoteCfg.queries[i];
        var url = this.remoteCfg.url + query;

        var replicationUrl = ldap.parseURL(url.replace(/\s/g, '%20'));

        // Be sure to require DN to replicate
        // For now we default the scope to sub and the filter to (objectclass=*)
        assert.string(replicationUrl.DN, 'Replication DN');

        var filter = replicationUrl.filter ||
                        ldap.filters.parseString('(objectclass=*)');

        var scope = replicationUrl.scope || 'sub';

        this.queries.push({
            query: query,
            dn: ldap.parseDN(replicationUrl.DN),
            filter: filter,
            scope: scope
        });
    }
};



/*
 * Fail early for replication: If it's an add and the changes don't match the
 * replication filter we return false. For the simple case where the targetdn
 * matches and the changetype is modify or delete we return true for now and
 * properly test if we need to replicate in the handleEntry function since we
 * need to read the local entry and do a couple more things
 */
Instance.prototype.couldReplicate = function (targetdn, entry) {
    var changetype = entry.object.changetype;

    // Does any of our queries match the entry?
    // Return true for the first match, by the time we exit the loop we can
    // return false since none of the queries matches the entry
    for (var i = 0; i < this.queries.length; i++) {
        var query = this.queries[i];

        if (targetdn.childOf(query.dn)) {
            if (changetype == 'modify') {

                // When replication filters have objectclasses in them we can
                // 'fail' early by testing if the objectclass is of our interest
                var objectFilter = {
                    objectclass: entry.parsedEntry.objectclass };
                if (query.filter.matches(objectFilter)) {
                    return true;
                }

            // For deletes we can't take a look at the local entry first
            } else if (changetype == 'delete') {
                return true;

            } else if (changetype == 'add') {
                if (query.filter.matches(entry.parsedChanges)) {
                    return true;
                }
            }
        }
    }

    return false;
};



/*
 * Stops replicating data from the remote instance. To ensure we wait until
 * pending operations finish executing we only return when unbind has returned
 */
Instance.prototype.stop = function (cb) {
    var self = this;

    if (this.timer) {
        clearInterval(this.timer);
    }

    this.closed = true;
    if (!this.remoteUfds) {
        if (this.connecting) {
            this.connecting.abort();
        }
        cb();
        return;
    }

    LDAP_PROXY_EVENTS.forEach(function reEmit(event) {
        self.remoteUfds.removeAllListeners(event);
    });

    this.remoteUfds.unbind(function (err) {
        if (err) {
            self.log.fatal(err, 'Error trying to unbind from Local');
            cb(err);
        } else {
            cb();
        }
    });
};



/*
 * Sets a new checkpoint after a matching replication entry has been processed.
 *
 * Note that we don't mess with this.searchnumber here because the processing
 * queue moves slower than the onSearchEntry callback.
 */
function updateChangenumber(self, number, callback) {
    self.changenumber = number;
    self.checkpoint.set(self.changenumber, function (err) {
        return callback(err);
    });
}



/*
 * This funciton gets called by the vasync serial queue. Entries are processed
 * in order. After sucessfully processing an entry we update the current change
 * number in the checkpoint DN.
 */
function handleEntry(entry, callback) {
    var self = entry.self;
    var log = self.log;

    if (self.queueError === true) {
        return callback();
    }

    var changetype = entry.object.changetype;

    // Check upstream vs downstream version here.  If the ufds master has
    // been upgraded, but we haven't, then we log errors and expect that this
    // ufds instance will be updated shortly.
    if (entry.object && entry.object.targetdn === 'cn=version, o=smartdc') {
        try {
            var changes = JSON.parse(entry.object.changes);
            var version;
            if (entry.object.changetype === 'add') {
                version = parseInt(changes.version[0], 10);
            } else if (entry.object.changetype === 'modify') {
                version = parseInt(changes[0].modification.vals[0], 10);
            }
        } catch (e) {
            update(e);
        }

        if (version != undefined) {
            log.info({
                localUfdsVersion: self.localUfdsVersion,
                remoteUfdsVersion: version
            }, 'master propagated new schema version');
            if (self.localUfdsVersion < version) {
                var msg = 'Remote UFDS schema version is greater than the ' +
                    'local UFDS version.  It is unsafe to apply entries.  ' +
                    'Please upgrade this UFDS instance.';
                return (update(new Error(msg)));
            }
        }
    }

    switch (changetype) {
        case 'add':
            ops.add(self, entry, update);
            break;
        case 'modify':
            ops.modify(self, entry, update);
            break;
        case 'delete':
            ops.del(self, entry, update);
            break;
        default:
            var err = new TypeError('changetype %s not supported for ' +
                                'object %s', changetype, entry.object);
            log.error(err, 'Invalid changetype');
            self.queueError = true;
            return callback();
    }

    function update(err1) {
        if (err1) {
            log.error(err1, 'Replication operation failed', entry.object);
            self.queueError = true;
            return callback();
        }

        var changenumber = parseInt(entry.object.changenumber, 10) + 1;

        updateChangenumber(self, changenumber, function (err2) {
            if (err2) {
                log.error(err2, '[%d] updateChangenumber failed', self.id);
                self.queueError = true;
            }

            return callback();
        });
    }
}



/*
 * Main execution loop
 */
function tryPoll(self) {
    try {
        poll(self);
    } catch (e) {
        self.log.error(e, 'Error executing the poll function');
        throw e;
    }
}



/*
 * Poll function. This function will return immediately when the serial queue
 * is processing entries, so a bottleneck is avoided every time pollInterval
 * wants to trigger a new search. As long as we are not processing entries
 * we should be able to make new searches on the remote. Note that the search is
 * done with an upper limit (and it is configurable)
 */
function poll(self) {
    var log = self.log;
    if (self.currPolling) {
        return;
    }

    // When remote instance is disconnected we want to re-create the timer
    if (!self.remoteUfds) {
        self.log.error('Cannot process changelog without a connection ' +
            'to client [%d]', self.id);
        return;
    }

    // When local instance is disconnected we want to wait for a reconnection
    if (!self.replicator.localUfds) {
        self.log.error('Cannot process changelog for client [%d] ' +
            'without a connection to the Local UFDS', self.id);
        return;
    }

    self.currPolling = true;

    var start = parseInt(self.changenumber, 10);
    var max = start + self.queueSize;

    var filter = sprintf('(&(changenumber>=%s)(changenumber<=%s))', start, max);

    var opts = {
        scope: 'sub',
        filter: filter
    };

    log.trace('[%d] Searching %s with opts %j', self.id, CHANGELOG, opts);
    self.remoteUfds.search(CHANGELOG, opts, function (err, res) {
        onSearch(self, err, res);
    });
}



/*
 * On Search callback. Gets executed when the client has received a response
 * from the remote UFDS server. If there is an error in the response we want to
 * stop execution immediately.
 */
function onSearch(self, err, res) {
    var log = self.log;
    var entries = [];

    if (err) {
        self.currPolling = false;
        log.error(err, 'onSearch error produced');
        return;
    }

    self.sentEntries = 0;

    /*
     * Inside this function we evaluate if the received entry can be pushed to
     * the serial queue
     */
    function onSearchEntry(entry) {
        log.trace('[%d] Search entry', self.id,
                    entry.object.targetdn,
                    entry.object.changenumber, entry.object.changetype);

        // BUG in UFDS. Doing this while it gets fixed
        self.sentEntries++;

        // On first new entry we are again catching up with the upstream UFDS
        if (self.caughtUp) {
            self.caughtUp = false;
        }

        // Sets the current searchnumber
        self.searchnumber = parseInt(entry.object.changenumber, 10);

        var targetdn = ldap.parseDN(entry.object.targetdn);
        var changes = JSON.parse(entry.object.changes);
        entry.parsedChanges = changes;

        // - add changetypes have the object in the changes attribute
        // - modifies have it in the entry
        if (entry.object.entry) {
            entry.parsedEntry = JSON.parse(entry.object.entry);
        }

        // Evaluate for replication if it's children of the DN
        if (self.couldReplicate(targetdn, entry)) {
            log.trace('[%d] targetdn match for replication',
                    self.id, targetdn.toString());
            entries.push(entry);
        }
    }


    /*
     * When a search ends we need to check how many entries need to be pushed
     * to the queue and if the replicator has caught up with the remote UFDS
     * changelog.
     */
    function onSearchEnd(res1) {
        // When the search returns nothing we can set currPolling to false
        // since the queue is empty at this point
        if (entries.length === 0) {

            if (self.queueError === true) {
                return;
            }

            // This is executed when we have hit the last changenumber in the
            // master UFDS changelog, basically there are no more entries
            if (self.changenumber == self.searchnumber &&
                self.sentEntries === 0) {
                log.trace('[%d] No new changelog entries', self.id);

                if (self.currPolling) {
                    self.currPolling = false;
                }

                if (!self.caughtUp) {
                    self.caughtUp = true;
                    self.emit('caughtup', self.id, self.changenumber);
                }

            // This is executed when a full queueSize didn't return any match
            // for us, so self.searchnumber > self.changenumber
            } else {
                self.searchnumber = self.searchnumber + 1;

                updateChangenumber(self, self.searchnumber, function (err1) {
                    self.currPolling = false;

                    if (err1) {
                        log.error(err1, '[%d] updateChangenumber failed',
                            self.id);
                    } else {
                        log.debug('[%d] No replication matches on this range',
                            self.id);
                        log.debug('[%d] Updated changenumber to %s', self.id,
                            self.changenumber);
                    }
                });
            }
        }

        entries.sort(sort);
        entries.forEach(function (entry, index) {
            try {
                entry.self = self;
                self.queue.push(entry);
            } catch (e) {
                log.error(e, 'found error');
                throw e;
            }

            if (index === entries.length - 1) {
                log.info('[%d] Finished search up to changenumber %s',
                    self.id, self.searchnumber);
            }
        });
    }

    res.on('searchEntry', onSearchEntry);
    res.on('end', onSearchEnd);

    res.on('error', function (err2) {
        self.currPolling = false;
        log.error(err2, 'onError error produced');
    });
}



/*
 * Sorts an array by changenumber of an entry
 */
function sort(a, b) {
    a = parseInt(a.object.changenumber, 10);
    b = parseInt(b.object.changenumber, 10);

    return a - b;
}
