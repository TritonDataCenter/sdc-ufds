// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// Just a simple wrapper over nodeunit's exports syntax. Also exposes
// a common logger for all tests.
//

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var util = require('util');

var Logger = require('bunyan');
var ldapjs = require('ldapjs');
var moray = require('moray');
var restify = require('restify');

///--- Globals
var CONFIG;
var CFG_FILE = process.env.TEST_CONFIG_FILE ||
            path.normalize(__dirname + '/../etc/config.coal.json');

try {
    CONFIG = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
} catch (e) {
    console.error('Unable to parse configuration file: ' + e.message);
    process.exit(1);
}

var LOG = new Logger({
    level: (CONFIG.logLevel || 'info'),
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

        var host, port;
        if (!CONFIG.port && !CONFIG.host) {
            host = '10.99.99.18';
            port = 636;
        } else if (!CONFIG.host && CONFIG.port) {
            host = '127.0.0.1';
            port = CONFIG.port;
        } else {
            port = CONFIG.port;
            host = CONFIG.host;
        }
        var proto = (port === 636) ? 'ldaps' : 'ldap';
        var url = util.format('%s://%s:%s', proto, host, port);

        var client = ldapjs.createClient({
            connectTimeout: 1000,
            log: LOG,
            url: url
        });

        client.once('error', function (err) {
            return callback(err);
        });

        client.once('connect', function () {
            if (nobind) {
                return callback(null, client);
            }

            var dn = CONFIG.rootDN || 'cn=root';
            var pw = CONFIG.rootPassword || 'secret';
            return client.bind(dn, pw, function (err) {
                if (err) {
                    return callback(err);
                }

                return callback(null, client);
            });
        });
    },

    createCAPICLient: function createCAPICLient(cb) {
        assert.equal(typeof (cb), 'function');

        var host = (!CONFIG.host) ? '127.0.0.1' : CONFIG.host;

        var client = restify.createJsonClient({
            connectTimeout: 1000,
            log: LOG,
            url: util.format('http://%s:8080', host)
        });

        return cb(client);
    },

    cleanup: function cleanupMoray(suffix, callback) {
        var client = moray.createClient({
            url: CONFIG.moray.url || 'tcp://10.99.99.17:2020',
            log: LOG.child({
                component: 'moray'
            }),
            retry: CONFIG.moray.retry || {
                minTimeout: 1000,
                retries: 3
            },
            connectTimeout: 1000,
            noCache: true
        });
        var bucket = process.env.MORAY_BUCKET ||
            'ufds_' + suffix.replace('=', '_');
        var req;
        var rows = [];

        client.once('error', function (err) {
            return callback(err);
        });
        client.on('connect', function () {
            req = client.findObjects(bucket,
                '(&(objectclass=sdcperson)(email=*@test.joyent.com))',
                {limit: 1000});
            req.once('error', function (err) {
                return callback(err);
            });
            req.on('record', function (obj) {
                rows.push(obj);
            });
            req.on('end', function () {
                var finished = 0;
                if (rows.length === 0) {
                    client.close();
                    return callback();
                }
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
