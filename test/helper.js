// Copyright 2012 Joyent, Inc.  All rights reserved.
//
// Just a simple wrapper over nodeunit's exports syntax. Also exposes
// a common logger for all tests.
//

var assert = require('assert');
var fs = require('fs');

var Logger = require('bunyan');
var ldapjs = require('ldapjs');
var moray = require('moray');



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
            url: process.env.MORAY_URL || 'tcp://10.99.99.13:2020',
            log: LOG.child({
                component: 'moray'
            }),
            retry: false,
            connectTimeout: 1000,
            noCache: true
        }),
        bucket = process.env.MORAY_BUCKET ||
            'ufds_' + suffix.replace('=', '_'),
        req,
        rows = [];

        client.once('error', function (err) {
            return callback(err);
        });
        client.on('connect', function () {
            req = client.findObjects(bucket, 'objectclass=*', {limit: 1000});
            req.once('error', function (err) {
                return callback(err);
            });
            req.on('record', function (obj) {
                rows.push(obj);
            });
            req.on('end', function () {
                var finished = 0;
                rows.forEach(function (r) {
                    client.delObject(r.bucket, r.key, function (err) {
                        assert.ifError(err);
                        finished += 1;
                        if (finished === rows.length) {
                            client.close();
                            return callback();
                        } else {
                            return false;
                        }
                    });
                });
            });
        });



    }
};

module.exports.__defineGetter__('log', function () {
    return LOG;
});
