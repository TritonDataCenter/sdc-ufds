// Copyright (c) 2014, Joyent, Inc. All rights reserved.

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var assert = require('assert-plus');
var ldap = require('ldapjs');


function RemoteDirectory(opts) {
    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');
    assert.object(opts.ldapConfig, 'opts.ldapConfig');
    assert.string(opts.ldapConfig.url, 'opts.ldapConfig.url');
    assert.arrayOfString(opts.ldapConfig.queries, 'opts.ldapConfig.queries');

    EventEmitter.call(this);
    var self = this;
    this.__defineGetter__('url', function () {
        return self.ldapConfig.url;
    });


    this.log = opts.log;
    this.pollInterval = opts.pollInterval;
    this.queueSize = opts.queueSize;
    this.ldapConfig = opts.ldapConfig;
    this._parseQueries(this.ldapConfig.queries)
}
util.inherits(RemoteDirectory, EventEmitter);
module.exports = RemoteDirectory;


RemoteDirectory.prototype._parseQueries = function _parseQueries(queries) {
    var self = this;
    var parsed = [];
    queries.forEach(function (query) {
        var url = ldap.parseURL((self.url + query).replace(/\s/g, '%20'));

        var filter = url.filter || ldap.filters.parseString('(objectclass=*)');
        var scope = url.scope || 'sub';

        // Only support scope=sub for how
        assert.equal(scope, 'sub');
        assert.string(url.DN);

        queries.push({
            query: query,
            dn: ldap.parseDN(url.DN),
            filter: filter,
            scope: scope
        });
    });
    this.queries = parsed;
};


RemoteDirectory.prototype.connect = function connect() {
    if (this.client) {
        throw new Error('already connected')
    }

    var self = this;
    var log = this.log;
    var config = this.ldapConfig;
    config.log = log;
    config.reconnect = config.reconnect || { maxDelay: 10000 };

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


RemoteDirectory.prototype._init = function _init() {
};


RemoteDirectory.prototype.stop = function stop() {
    if (this.stopped) {
        return;
    }
    this.stopped = true;
    this.client.destroy();
};


