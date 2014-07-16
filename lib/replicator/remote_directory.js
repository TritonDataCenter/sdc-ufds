// Copyright (c) 2014, Joyent, Inc. All rights reserved.

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var assert = require('assert-plus');
var once = require('once');
var ldap = require('ldapjs');

///--- Globals

var CHANGELOG = 'cn=changelog';

///--- API

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
    this.rawQueries = opts.ldapConfig.queries;
    this._parseQueries(this.ldapConfig.queries);
}
util.inherits(RemoteDirectory, EventEmitter);
module.exports = RemoteDirectory;


/**
 * Initiate conncetion to remote UFDS instance.
 */
RemoteDirectory.prototype.connect = function connect() {
    if (this.client) {
        throw new Error('already connected');
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
        if (!self.client.destroyed) {
            log.warn('ldap disconnect');
        }
    });
    client.on('connectError', function (err) {
        log.warn(err, 'ldap connection attempt failed');
    });

    this.client = client;
};


/**
 * Poll for new changelog entries.
 *
 * Parameters:
 *  - start: Starting changenumber
 *  - end: Ending changenumber
 *  - result: Result callback
 *  - done: Completion callback
 */
RemoteDirectory.prototype.poll = function poll(start, end, result, done) {
    if (this.polling) {
        return done();
    }
    var self = this;
    var cb = once(function (last) {
        self.polling = false;
        self.log.debug({last: last}, 'poll end');
        done(last);
    });
    this.polling = true;
    this.log.debug({start: start, end: end}, 'poll start');

    var filter = new ldap.AndFilter({
        filters: [
            new ldap.GreaterThanEqualsFilter({
                attribute: 'changenumber',
                value: start.toString()
            }),
            new ldap.LessThanEqualsFilter({
                attribute: 'changenumber',
                value: end.toString()
            })
        ]
    });
    var opts = {
        scope: 'sub',
        filter: filter
    };
    this.client.search(CHANGELOG, opts, function (err, res) {
        var last = 0;
        if (err) {
            self.warn({err: err}, 'error during changelog search');
            return cb(last);
        }
        res.on('searchEntry', function (entry) {
            // Format the entry
            var data = entry.object;
            last = parseInt(data.changenumber, 10);
            try {
                var parsed = JSON.parse(data.changes);
                data.changes = parsed;
            } catch (e) {
                self.emit('error', e);
            }
            data.targetdn = ldap.parseDN(data.targetdn);

            var queries = self._matchQueries(data);
            if (queries.length > 0) {
                // Forward the filters downstream for del/mod changes
                data.queries = queries;
                result(data);
            }
        });
        res.on('end', function () {
            cb(last);
        });
        res.on('error', function (err2) {
            self.log.warn({err: err2}, 'error during search');
            cb(last);
        });
    });
};


/**
 * Destroy connection to remote UFDS.
 */
RemoteDirectory.prototype.destroy = function destroy() {
    if (this.client.destroyed) {
        return;
    }
    this.client.destroy();
};


/**
 * Parse queries for entry matching.
 */
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

        parsed.push({
            query: query,
            dn: ldap.parseDN(url.DN),
            filter: filter,
            scope: scope
        });
    });
    this.queries = parsed;
};


/**
 * Test changelog entry against configured queries.
 */
RemoteDirectory.prototype._matchQueries = function _matchQueries(entry) {
    var matches = [];
    for (var i = 0; i < this.queries.length; i++) {
        var query = this.queries[i];

        if (entry.targetdn.childOf(query.dn)) {
            switch (entry.changetype) {
            case 'modify':
            case 'delete':
                // The local entry must be consulted for validity
                matches.push(query.filter);
                break;
            case 'add':
                // Add entries are easy. They can be matched on the spot.
                if (query.filter.matches(entry.changes)) {
                    matches.push(query.filter);
                    return matches;
                }
                break;
            default:
                this.emit('error', new Error('invalid change type: %s',
                            entry.changetype));
                break;
            }
        }
    }
    return matches;
};
