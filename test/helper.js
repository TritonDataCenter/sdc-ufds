// Copyright 2012 Joyent, Inc.  All rights reserved.
//
// Just a simple wrapper over nodeunit's exports syntax. Also exposes
// a common logger for all tests.
//

var assert = require('assert');
var fs = require('fs');

var Logger = require('bunyan');
var ldapjs = require('ldapjs');
var moray = require('moray-client');



///--- Globals

var CFG_FILE = process.env.TEST_CONFIG_FILE || __dirname + '/config.test.json';
var LOG = new Logger({
    level: (process.env.LOG_LEVEL || 'info'),
    name: process.argv[1],
    stream: process.stderr,
    src: true,
    serializers: Logger.stdSerializers
});



///--- Exports

module.exports = {

    after: function after(callback) {
        module.parent.tearDown = callback;
    },

    before: function before(callback) {
        module.parent.setUp = callback;
    },

    test: function test(name, tester) {
        module.parent.exports[name] = tester;
    },

    createClient: function createClient(nobind, callback) {
        if (typeof (nobind) === 'function') {
            callback = nobind;
            nobind = false;
        }
        assert.equal(typeof (callback), 'function');

        var client = ldapjs.createClient({
            connectTimeout: 1000,
            log: LOG,
            url: (process.env.UFDS_URL || 'ldap://localhost:1389')
        });

        client.once('error', function (err) {
            return callback(err);
        });

        client.once('connect', function () {
            if (nobind)
                return callback(null, client);

            var dn = process.env.UFDS_BIND_DN || 'cn=root';
            var pw = process.env.UFDS_BIND_PW || 'secret';
            return client.bind(dn, pw, function (err) {
                if (err)
                    return callback(err);

                return callback(null, client);
            });
        });
    },

    cleanup: function cleanupMoray(suffix, callback) {
        var client = moray.createClient({
            url: process.env.MORAY_URL || 'http://localhost:8080',
            log: LOG.child({
                component: 'moray'
            }),
            retry: false,
            connectTimeout: 1000
        });

        var bucket = process.env.MORAY_BUCKET ||
            'ufds_' + suffix.replace('=', '_');

        var keys = [];
        var req = client.keys(bucket, {limit: 1000});
        req.on('error', function (err) {
            return callback(err);
        });
        req.on('keys', function (_keys) {
            if (req.hasMoreKeys())
                req.next();
            Object.keys(_keys).forEach(function (k) {
                keys.push(k);
            });
        });
        req.on('end', function () {
            var finished = 0;
            keys.forEach(function (k) {
                client.del(bucket, k, function (err) {
                    assert.ifError(err);
                    return (++finished === keys.length ? callback() : false);
                });
            });
        });
    }
};

module.exports.__defineGetter__('log', function () {
    return LOG;
});
