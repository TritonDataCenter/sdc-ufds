// Copyright (c) 2014, Joyent, Inc. All rights reserved.

var crypto = require('crypto');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

var assert = require('assert-plus');
var ldap = require('ldapjs');
var once = require('once');
var clone = require('clone');
var vasync = require('vasync');

var RemoteDirectory = require('./remote_directory');
var controls = require('../controls/index');


//--- Globals

var PAGE_SIZE = 50;


///--- API

function Replicator(opts) {
    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');
    assert.object(opts.ldapConfig, 'opts.ldapConfig');

    EventEmitter.call(this);

    this.log = opts.log;
    this.ldapConfig = opts.ldapConfig;
    this.baseDN = opts.baseDN || 'o=smartdc';
    this.checkpointDN = opts.checkpointDN || this.baseDN;
    this.checkpointObjectclass = opts.checkpointObjectclass ||
        'sdcreplcheckpoint';
    this.pollInterval = parseInt(opts.pollInterval, 10) || 1000;

    var self = this;
    this._remotes = {};
    this.__defineGetter__('remotes', function () {
        return Object.keys(self._remotes);
    });

    // Valid states:
    // - init: Initializing resources before startup
    // - poll: Polling remote servers for new changes
    // - process: Applying changes in queue
    // - wait: Waiting for local server reconnect
    // - destroy: Shutdown/destroyed
    this._state = 'init';
    this.__defineGetter__('state', function () {
        return self._state;
    });

    this._queue = [];

    this._connect();
}
util.inherits(Replicator, EventEmitter);
module.exports = Replicator;

/**
 * Add remove UFDS instance to replicate from.
 */
Replicator.prototype.addRemote = function addRemote(opts, cb) {
    assert.object(opts);
    assert.string(opts.url);
    var url = opts.url;

    if (this._remotes[url]) {
        return cb(new Error(util.format('duplicate remote url: %s', url)));
    }

    var config = clone(opts);
    config.url = url;
    var log = this.log.child({remoteUFDS: url});
    var remote = new RemoteDirectory({
        ldapConfig: config,
        log: log
    });
    remote.connect();

    this._remotes[url] = {
        url: url,
        connection: remote,
        searchnumber: 0 // Last changenumber encountered in search
    };

    var init = this._checkpointInit.bind(this, this._remotes[url], cb);

    // Initialize checkpoint whenever localUfds is connected
    if (this.client.connected) {
        init();
    } else {
        this.client.once('connect', init);
    }
};

/**
 * Begin replication.
 */
Replicator.prototype.start = function start() {
    assert.equal(this.state, 'init');
    this._setState('poll');
};

/**
 * Pause replication.
 */
Replicator.prototype.pause = function pause(from_err) {
    // Record if the pause is due to disconnect/error
    this._errWait = from_err || this._errWait;
    this._setState('wait');
};

/**
 * Resume replication after a pause.
 */
Replicator.prototype.resume = function resume() {
    if (!this.client.connected) {
        // Resuming is impossible the local connection isn't available.
        return;
    }
    if (this._errWait) {
        // If replicator was paused due to error, the queue should be flushed
        // and the checkpoints reinitialized.  This ensures that the result of
        // any in flight transactions at the time of pause can be accounted
        // for.
        var self = this;
        this._queue = [];
        vasync.forEachParallel({
            inputs: this.remotes,
            func: function (url, cb) {
                self._checkpointInit(self._remotes[url], cb);
            }
        }, function (err, res) {
            if (err) {
                // FIXME: perhaps retry?
                self.log.fatal('error during reinitialization');
                self.emit('error', err);
            } else {
                self._errWait = null;
                self.log.info('reinitialize success');
                self._setState('poll');
            }
        });
    } else {
        // Resumption after a manual pause is much easier
        if (this._queue.length > 0) {
            // Proceed to item processing if any are available
            this.log.info('resume processing');
            this._setState('process');
        } else {
            // Otherwise, go back to polling
            this.log.info('resume polling');
            this._setState('poll');
        }
    }
};

/**
 * Halt and destroy the replicator.
 */
Replicator.prototype.destroy = function destroy() {
    this._setState('destroy');
};


///--- Private methods

/**
 * Establish connection to local UFDS instance.
 */
Replicator.prototype._connect = function _connect() {
    if (this.client) {
        throw new Error('already connected');
    }

    var self = this;
    var log = this.log;
    var config = this.ldapConfig;
    config.log = log;
    config.reconnect = config.reconnect || { maxDelay: 10000 };
    config.reconnect.failAfter = Infinity;

    var client = ldap.createClient(config);
    client.on('setup', function (clt, next) {
        clt.bind(config.bindDN, config.bindCredentials, function (err) {
            if (err) {
                log.error({ bindDN: config.bindDN, err: err },
                    'invalid bind credentials');
            }
            next(err);
        });
    });
    client.on('connect', function () {
        log.info({bindDN: config.bindDN}, 'connected and bound');
        self.emit('connect');
        // If the replicator isn't waiting to initialize, it should change
        // state to resume processing/polling.
        if (self.state !== 'init') {
            self.resume();
        }
    });
    client.on('error', function (err) {
        log.warn(err, 'ldap error');
    });
    client.on('close', function () {
        if (!self.destroyed) {
            log.warn('ldap disconnect');
            // suspend processing and polling until connected again
            self.pause(true);
        }
    });
    client.on('connectError', function (err) {
        log.warn(err, 'ldap connection attempt failed');
    });

    this.client = client;
};

/**
 * Transition between replicator states.
 */
Replicator.prototype._setState = function _setState(desired) {
    var self = this;
    if (this.state === desired) {
        return;
    }

    // Define valid state transitions
    function ok_from(choices) {
        return (choices.indexOf(self.state) !== -1);
    }

    var valid = false;
    var action;
    switch (desired) {
    case 'poll':
        valid = ok_from(['init', 'wait', 'process']);
        action = this._poll.bind(this);
        break;
    case 'process':
        valid = ok_from(['wait', 'poll']);
        action = this._process.bind(this);
        break;
    case 'destroy':
        // always allow destroy
        valid = true;
        action = this._destroy.bind(this);
        break;
    case 'wait':
        valid = ok_from(['poll', 'process']);
        action = function () {
            self.log.info('activity suspended');
        };
        break;
    case 'init':
    default:
        // noop for all others
        break;
    }
    if (valid) {
        // allowed transition
        this.log.debug({
            oldState: this.state,
            newState: desired
        }, 'state transition');
        this._state = desired;
        process.nextTick(action);
    } else {
        this.emit('error', new Error('invalid state transition:' +
                    this.state + ' -> ' + desired));
    }
};

/**
 * Poll remote directories for new changelog entries.
 */
Replicator.prototype._poll = function _poll(targetRemote) {
    if (this.state !== 'poll') {
        return;
    }
    var self = this;

    function pollRemote(url) {
        var remote = self._remotes[url];
        var startnum = remote.searchnumber + 1;
        var endnum = startnum + PAGE_SIZE;
        remote.connection.poll(startnum, endnum,
            self._enqueue.bind(self, url),
            function (last, matched) {
                if (last !== undefined && last !== 0) {
                    remote.searchnumber = last;
                    // Since new records were found at this remote directory,
                    // it's reasonable to assume there could be more.
                    // Immediately poll this remote for more records
                    self._poll(remote.url);
                }
            });
    }

    if (targetRemote) {
        pollRemote(targetRemote);
    } else {
        this.remotes.forEach(pollRemote);
    }

    if (!this._timer) {
        this._timer = setTimeout(function () {
            self._timer = null;
            self._poll();
        }, this.pollInterval);
    }
};

/**
 * Shutdown and destroy the replicator.
 */
Replicator.prototype._destroy = function _destroy() {
    var self = this;
    if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
    }
    this.destroyed = true;
    this.client.destroy();
    this.remotes.forEach(function (url) {
        self._remotes[url].connection.destory();
    });
    this.emit('destory');
    this.log.info('destroyed replicator');
};

/**
 * Record a changelog entry into the queue.
 */
Replicator.prototype._enqueue = function _enqueue(url, result) {
    this._queue.push({
        remote: this._remotes[url],
        change: result
    });
    if (this.state === 'poll') {
        // Begin processing entries if needed
        this._setState('process');
    }
};

/**
 * Process a queued changelog entry.
 */
Replicator.prototype._process = function _process() {
    if (this.state !== 'process') {
        return;
    }
    var self = this;
    var entry = this._queue.shift();

    var done = once(function (err) {
        if (err) {
            // Retry the item if it failed
            self.log.warn({err: err}, 'error during change');
            self._queue.unshift(entry);
        }
        if (self._queue.length !== 0) {
            setTimeout(self._process.bind(self), 0);
        } else {
            self._setState('poll');
        }
    });

    entry.controls = [];
    // Record the source of the change when performing that action
    var clogHint = new controls.ChangelogHintRequestControl({
        value: {
            url: entry.remote.url,
            changenumber: parseInt(entry.change.changenumber, 10)
        }
    });
    entry.controls.push(clogHint);

    // Update the checkpoint on successful action
    var checkpointUpdate = new controls.CheckpointUpdateRequestControl({
        value: {
            dn: entry.remote.checkpoint,
            changenumber: parseInt(entry.change.changenumber, 10)
        }
    });
    entry.controls.push(checkpointUpdate);

    switch (entry.change.changetype) {
        case 'add':
            this._processAdd(entry, done);
            break;
        case 'modify':
            this._processModify(entry, done);
            break;
        case 'delete':
            this._processDel(entry, done);
            break;
        default:
            this.emit('error', new Error('invalid changetype:' +
                        entry.change.changetype));
            break;
    }
};

Replicator.prototype._processAdd = function _processAdd(entry, cb) {
    var self = this;
    var dn = entry.change.targetdn.toString();
    var attrs = entry.change.changes;
    var ctrls = entry.controls;

    this.log.trace({dn: dn}, 'begin add');
    this.client.add(dn, attrs, ctrls, function (err, res) {
        if (err) {
            if (err.name == 'EntryAlreadyExistsError' ||
                err.name == 'ConstraintViolationError') {
                // Treat this seriously but move forward
                self.log.fatal({
                    err: err,
                    changenumber: entry.change.changenumber,
                    dn: dn,
                    remoteUFDS: entry.remote.url
                }, 'add failure');
                cb();
            } else {
                // log and try again
                self.log.warn({err: err}, 'error during add');
                cb(err);
            }
        }
        // success
        self.log.debug({dn: dn}, 'add success');
        cb();
    });
};

Replicator.prototype._processModify = function _processModify(entry, cb) {
    // Possible scenarios:
    // 1. Old and updated entries match the filter - modify
    // 2. Neither matches filter - ignore
    // 3. Old matches, updated doesn't - delete
    // 4. Old doesn't match, updated does - modify
    // 5. Local not found, updated matches - add
    var self = this;
    var dn = entry.change.targetdn.toString();
    var changes = entry.change.changes;

    function matchesFilter(obj) {
        var queries = entry.change.queries;
        for (var i = 0; i < queries.length; i++) {
            if (queries[i].matches(obj)) {
                return true;
            }
        }
        return false;
    }
    function evalOptions(old) {
        var updated = {};
        var oldMatches = false;
        if (old !== null) {
            updated = clone(old);
            oldMatches = matchesFilter(old);
        }
        changes.forEach(function (change) {
            ldap.Change.apply(change, updated);
        });
        var newMatches = matchesFilter(updated);

        if (!oldMatches && !newMatches) {
            // scenario 2: ignore
            return cb();
        } else if (newMatches && old !== null) {
            // scenarios 1 & 4: modify
            self.client.modify(dn, changes, entry.controls, function (err) {
                if (!err) {
                    self.log.debug({dn: dn}, 'modify success');
                }
                cb(err);
            });
        } else if (oldMatches && !newMatches) {
            // scenarios 3: delete
            self.client.del(dn, entry.controls, function (err) {
                if (!err) {
                    self.log.debug({dn: dn}, 'modify-delete success');
                }
                cb(err);
            });
        } else if (old === null && newMatches) {
            // scenarios 5: add
            self.client.add(dn, updated, entry.controls, function (err) {
                if (!err) {
                    self.log.debug({dn: dn}, 'modify-add success');
                }
                cb(err);
            });
        } else {
            // Shouldn't be possible, squawk about it
            self.log.err('impossible modify combination');
            return cb();
        }
    }

    this.log.trace({dn: dn}, 'begin modify');
    this.client.search(dn, {scope: 'base'}, function (err, res) {
        if (err) {
            if (err.name === 'NoSuchObjectError') {
                return evalOptions(null);
            }
            return cb(err);
        }
        res.once('searchEntry', function (item) {
            res.removeAllListeners();
            evalOptions(item.object);
        });
        res.once('error', function (err) {
            if (err.name === 'NoSuchObjectError') {
                evalOptions(null);
            } else {
                cb(err);
            }
        })
    });
};

Replicator.prototype._processDel = function _processDel(entry, cb) {
    // Three scenarios:
    // 1. Entry does not exist locally - ignore
    // 2. Entry does exist locally but does not match filter - ignore
    // 2. Entry does exist locally and does match filter - delete
    var self = this;
    var dn = entry.change.targetdn.toString();
    function performDelete() {
        self.client.del(dn, entry.controls, function (err) {
            if (err) {
                if (err.name !== 'NotAllowedOnNonLeafError') {
                    return cb(err);
                } else {
                    // Log this, but still succeed
                    self.log.warn({dn: dn}, 'skipping delete of non-leaf node');
                }
            }
            self.log.debug({dn: dn}, 'delete success');
            return cb();
        });
    }

    // Log at trace instead of debug due to processing of non-matching entries
    this.log.trace({dn: dn}, 'begin delete');
    // Check for an existing item at that DN
    this.client.search(dn, {scope: 'base'}, function (err, res) {
        if (err) {
            return cb(err);
        }
        res.once('searchEntry', function (item) {
            res.removeAllListeners();
            // The item needs to match a queries to be deleted
            var queries = entry.change.queries;
            for (var i = 0; i < queries.length; i++) {
                var query = queries[i];
                if (query.matches(item)) {
                    return performDelete();
                }
            }
            // No matches. We're not meant to delete this, so report success.
            return cb();
        });
        res.once('end', cb.bind(null, null)); // Not found
        res.once('error', function (err) {
            // If the item doesn't exist in the directory, we can consider the
            // deletion a success.
            if (err.name === 'NoSuchObjectError') {
                cb();
            } else {
                cb(err);
            }
        });
    });
};


/**
 * Initialize local checkpoint for remote UFDS instance.
 */
Replicator.prototype._checkpointInit = function _checkpointInit(remote, cb) {
    var self = this;
    cb = once(cb);

    this._checkpointGet(remote.url, function (err, res) {
        if (err && err.name !== 'NoSuchObjectError') {
            return cb(err);
        }
        if (res) {
            // Found a checkpoint
            console.dir(res);
            remote.searchnumber = parseInt(res.changenumber, 10);
            remote.checkpoint = res.dn.toString();

            self.log.debug({
                url: remote.url,
                changenumber: res.changenumber,
                dn: res.dn
            }, 'initialized from existing checkpoint');
            cb(null);
        } else {
            // Need to create one
            self._checkpointAdd(remote, cb);
        }
    });
};

/**
 * Query local UFDS for a checkpoint record.
 */
Replicator.prototype._checkpointGet = function _checkpointGet(url, cb) {
    var self = this;
    cb = once(cb);

    var filter = new ldap.AndFilter({
        filters: [
            new ldap.EqualityFilter({
                attribute: 'objectclass',
                value: self.checkpointObjectclass
            }),
            new ldap.EqualityFilter({
                attribute: 'url',
                value: url
            })
        ]
    });
    var opts = {
        filter: filter,
        scope: 'sub'
    };

    this.client.search(this.baseDN, opts, function (err, res) {
        if (err) {
            cb(err);
        }
        var result = null;
        res.on('searchEntry', function (entry) {
            if (result) {
                cb(new Error('multiple checkpoints found for url: ' + url));
                return;
            }
            var obj = entry.object;
            result = {
                dn: obj.dn,
                changenumber: obj.changenumber
            };
        });
        res.on('end', function () {
            cb(null, result);
        });
        res.on('error', function (err2) {
            cb(err2);
        });
    });
};

/**
 * Add a checkpoint record to local UFDS.
 */
Replicator.prototype._checkpointAdd = function _checkpointAdd(remote, cb) {
    cb = once(cb);

    var self = this;
    var url = remote.url;
    var urlHash = crypto.createHash('md5').update(url).digest('hex');
    var dn = util.format('uid=%s, %s', urlHash, this.checkpointDN);
    var entry = {
        url: url,
        uid: urlHash,
        objectclass: [this.checkpointObjectclass],
        changenumber: 0,
        query: remote.connection.rawQueries
    };
    console.dir(entry);

    this.client.add(dn, entry, function (err) {
        if (err) {
            return cb(err);
        }
        remote.checkpoint = dn;
        remote.searchnumber = 0;
        self.log.debug({url: url, changenumber: 0}, 'checkpoint add');
        cb(null);
    });
};
