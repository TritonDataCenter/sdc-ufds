// Copyright (c) 2014, Joyent, Inc. All rights reserved.


var crypto = require('crypto');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

var assert = require('assert-plus');
var ldap = require('ldapjs');
var once = require('once');
var clone = require('clone');

var RemoteDirectory = require('./remote_directory');


//--- Globals

var PAGE_SIZE = 50;


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
    // - queue: Applying changes in queue
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
    });
    client.on('error', function (err) {
        log.warn(err, 'ldap error');
    });
    client.on('close', function () {
        if (!self.stopped) {
            log.warn('ldap disconnect');
        }
    });
    client.on('connectError', function (err) {
        log.warn(err, 'ldap connection attempt failed');
    });

    this.client = client;
};


Replicator.prototype.destroy = function destroy() {
    var self = this;
    this._setState('destroy', function () {
        if (self._timer) {
            clearTimeout(self._timer);
            self._timer = null;
        }
        self.client.destroy();
        self.remotes.forEach(function (url) {
            self._remotes[url].connection.stop();
        });
        self.emit('destory');
        self.log.info('destroyed replicator');
    });
};


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
        changenumber: 0, // Last committed change
        searchnumber: 0 // Last changenumber encountered in search
    };

    var init = this.checkpointInit.bind(this, this._remotes[url], cb);

    // Initialize checkpoint whenever localUfds is connected
    if (this.client.connected) {
        init();
    } else {
        this.client.once('connect', init);
    }
};


Replicator.prototype.start = function start() {
    this._setState('poll', this._poll.bind(this));
};


Replicator.prototype._setState = function _setState(desired, func) {
    if (this.state === desired) {
        return;
    }
    // Define valid state transitions
    var valid = [];
    switch (this.state) {
        case 'init':
            valid = ['poll'];
            break;
        case 'poll':
            valid = ['queue'];
            break;
        case 'queue':
            valid = ['poll', 'wait'];
            break;
        case 'wait':
            valid = ['queue'];
            break;
        case 'destroy':
        default:
            valid = [];
            break;
    }
    // can always transition to destroy
    valid.push('destroy');
    if (valid.indexOf(desired) !== -1) {
        // allowed transition
        this.log.debug('state transition %s -> %s', this.state, desired);
        this._state = desired;
        func();
    } else {
        this.emit('error', new Error('invalid state transition:' +
                    this.state + ' -> ' + desired));
    }
};

Replicator.prototype._tryPoll = function _tryPoll() {
    //TODO finish
};


Replicator.prototype._poll = function _poll(targetRemote) {
    if (this.state !== 'poll') {
        return;
    }
    var self = this;

    function pollRemote(url) {
        var remote = self._remotes[url];
        var startnum = remote.searchnumber;
        var endnum = startnum + PAGE_SIZE;
        remote.connection.poll(startnum, endnum,
            self._enqueue.bind(self, url),
            function (last) {
                if (last > remote.searchnumber) {
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


Replicator.prototype._enqueue = function _enqueue(url, result) {
    this._queue.push({
        url: url,
        change: result
    });
    // Change state if needed
    this._setState('queue', this._processItem.bind(this));
};

Replicator.prototype._processItem = function _processItem() {
    var self = this;
    var entry = this._queue.shift();

    var done = once(function () {
        if (self._queue.length !== 0) {
            self.log.trace('process item');
            setTimeout(self._processItem.bind(self), 0);
        } else {
            self._setState('poll', self._poll.bind(self));
        }
    });

    if (entry.changetype === 'add') {
        this._processAdd(entry, done);
    }
};

Replicator.prototype._processAdd = function _processAdd(entry, cb) {
    // TODO: Add changelog control
    this.log.debug({entry: entry}, 'add');
    cb();
};





Replicator.prototype.checkpointInit = function checkpointInit(remote, cb) {
    var self = this;
    cb = once(cb);

    this.checkpointGet(remote.url, function (err, res) {
        if (err) {
            return cb(err);
        }
        if (res) {
            // Found a checkpoint
            remote.changenumber = parseInt(res.changenumber, 10);
            remote.searchnumber = remote.changenumber;
            remote.checkpoint = res.dn;

            self.log.debug({
                url: remote.url,
                changenumber: res.changenumber,
                dn: res.dn
            }, 'initialized from existing checkpoint');
            cb(null);
        } else {
            // Need to create one
            this.checkpointAdd(remote, cb);
        }
    });
};

Replicator.prototype.checkpointGet = function checkpointGet(url, cb) {
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

Replicator.prototype.checkpointAdd = function checkpointAdd(remote, cb) {
    cb = once(cb);

    var url = remote.url;
    var urlHash = crypto.createHash('md5').update(url).digest('hex');
    var dn = util.format('uid=%s, %s', urlHash, this.checkpointDN);
    var entry = {
        url: url,
        uid: urlHash,
        objectclass: this.checkpointObjectclass,
        changenumber: 0,
        query: remote.connection.rawQueries
    };

    this.client.add(dn, entry, function (err) {
        if (err) {
            return cb(err);
        }
        remote.checkpoint = dn;
        remote.changenumber = 0;
        cb(null);
    });
};

Replicator.prototype.checkpointSet = function checkpointSet(remote, num, cb) {
    var self = this;
    cb = once(cb);

    var change = new ldap.Change({
        type: 'replace',
        modification: {
            changenumber: num
        }
    });

    this.client.modify(remote.checkpoint, change, function (err, res) {
        if (err) {
            self.log.fatal({
                err: err,
                url: remote.url,
                changenumber: num
            }, 'unable to set checkpoint');
            return cb(err);
        }

        self.log.debug({
            url: remote.url,
            changenumber: num
        }, 'set checkpoint');
        return cb();
    });
};
