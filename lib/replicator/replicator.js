// Copyright (c) 2014, Joyent, Inc. All rights reserved.


var EventEmitter = require('events').EventEmitter;
var util = require('util');
var assert = require('assert-plus');
var ldap = require('ldapjs');
var clone = require('clone');

var RemoteDirectory = require('./remote_directory');

function Replicator(opts) {
    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');
    assert.object(opts.ldapConfig, 'opts.ldapConfig');

    EventEmitter.call(this);

    this.log = opts.log;
    this.ldapConfig = opts.ldapConfig;
    this.remotes = {};
    this.state = 'init';
}
util.inherits(Replicator, EventEmitter);
module.exports = Replicator;


Replicator.prototype.connect = function connect() {
    if (this.client) {
        throw new Error('already connected')
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
    this.state = 'destroyed';
    this.client.destroy();
    this._forEachRemote(function (remote) {
        remote.stop();
    });
    this.emit('destory');
    this.log.info('destroyed replicator');
};


Replicator.prototype.addRemote = function addRemote(opts) {
    assert.object(opts);
    assert.string(opts.url);
    var url = opts.url

    if (this.remotes[url]) {
        var err = new Error(util.format('duplicate remote url: %s', url));
        this.emit('error', err);
        return;
    }

    var config = clone(opts);
    config.url = url;
    var log = this.log.child({remoteUFDS: url});
    var remote = new RemoteDirectory({
        ldapConfig: config,
        log: log
    });
    remote.connect();

    this.remotes[url] = {
        connection: remote
    };
};


Replicator.prototype._forEachRemote = function _forEachRemote(cb) {
    var self = this;
    Object.keys(this.remotes).forEach(function (url) {
        cb(self.remotes[url].connection);
    });
};
