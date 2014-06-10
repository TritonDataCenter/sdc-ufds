// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// Just a simple wrapper over nodeunit's exports syntax. Also exposes
// a common logger for all tests.
//

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var util = require('util');
var child_process = require('child_process');

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
    CONFIG.host = CONFIG.host || '10.99.99.18';
    CONFIG.port = CONFIG.port || 636;
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


function get(client, DN, callback) {
    return client.search(DN, '(objectclass=*)', function (err, res) {
        if (err) {
            return callback(err);
        }

        var obj;

        res.on('searchEntry', function (entry) {
            obj = entry.object;
        });

        res.once('error', function (err2) {
            return callback(err2);
        });

        res.once('end', function (result) {
            return callback(null, obj);
        });

        return;
    });
}


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

        var proto = (CONFIG.port === 636) ? 'ldaps' : 'ldap';
        var url = util.format('%s://%s:%s', proto, CONFIG.host, CONFIG.port);

        var client = ldapjs.createClient({
            connectTimeout: 1000,
            log: LOG,
            url: url,
            tlsOptions: {
                rejectUnauthorized: false
            }
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

    createCAPIClient: function createCAPIClient(cb) {
        assert.equal(typeof (cb), 'function');

        var host = (!CONFIG.host) ? '127.0.0.1' : CONFIG.host;

        var client = restify.createJsonClient({
            connectTimeout: 1000,
            log: LOG,
            url: util.format('http://%s:8080', host)
        });

        return cb(client);
    },

    createServer: function createServer(cb) {
        assert.equal(typeof (cb), 'function');
        // Don't initialize local server if remote is specified.
        if (CONFIG.host !== '127.0.0.1') {
            return cb(null, {});
        }
        var basePath = path.normalize(__dirname + '/../');
        var ufds = require(basePath + '/lib/ufds');
        var config = ufds.processConfigFile(CFG_FILE);
        config.log =  new Logger({
            name: 'ufds',
            stream: fs.createWriteStream(basePath + '/ufds.log', {flags: 'a'}),
            serializers: {
                err: Logger.stdSerializers.err
            }
        });
        var server = ufds.createServer(config);
        server.init(function () {
            cb(null, server);
            return true;
        });
    },

    destroyServer: function destroyServer(server, cb) {
        assert.equal(typeof (cb), 'function');
        // No cleanup needed for remote server
        if (CONFIG.host !== '127.0.0.1') {
            return cb();
        }
        server.server.close();
        server.moray.close();
        cb();
    },

    createCAPIServer: function createCAPIServer(cb) {
        assert.equal(typeof (cb), 'function');
        var basePath = path.normalize(__dirname + '/../');
        var capi = require(basePath + '/capi/server.js');
        var config = capi.processConfigFile(CFG_FILE);
        config.log = new Logger({
            name: 'capi',
            level: config.logLevel,
            stream: fs.createWriteStream(basePath + '/capi.log', {flags: 'a'}),
            serializers: restify.bunyan.serializers
        });
        var server = capi.createServer(config);
        server.connect(function (err) {
          if (err) {
            return cb(err);
          }
          cb(null, server);
        });
    },

    destroyCAPIServer: function destroyCAPIServer(server, cb) {
        assert.equal(typeof (cb), 'function');
        server.close(cb);
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
            dns: CONFIG.moray.dns || {},
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
    },

    get: get
};

module.exports.__defineGetter__('log', function () {
    return LOG;
});

module.exports.__defineGetter__('config', function () {
    return CONFIG;
});
