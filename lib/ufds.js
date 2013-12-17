/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * UFDS LDAP Server definition, including the server itself,
 * moray configuration and connection callbacks, buckets
 * creation/upgrade, server suffixes, controls, searches and
 * the different LDAP operations.
 */

var assert = require('assert');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var path = require('path');

var ldap = require('ldapjs');
var morayClient = require('moray');
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}
var bunyan = require('bunyan');

var be = require('./index');
var sch = require('./schema');


function audit(req, res, next) {
    var attrs;

    var data = {
        clientip: req.connection.remoteAddress || 'localhost',
        latency: (new Date().getTime() - req.startTime),
        ufdsReq: {
            bindDN: req.connection.ldap.bindDN.toString(),
            msgid: req.id,
            request: req.type,
            requestDN: req.dn.toString(),
            status: res.status
        }
    };
    var ufdsReq = data.ufdsReq;
    switch (req.type) {
    case 'BindRequest':
        ufdsReq.bindType = req.authentication;
        break;
    case 'AddRequest':
        attrs = req.toObject().attributes;
        if (attrs.userpassword) {
            attrs.userpassword = ['XXXXXX'];
        }
        ufdsReq.entry = attrs;
        break;
    case 'SearchRequest':
        ufdsReq.scope = req.scope;
        ufdsReq.filter = req.filter.toString();
        ufdsReq.attributes = req.attributes;
        ufdsReq.sentEntries = req.sentEntries;
        break;
    default:
        break;
    }

    req.log.info(data, '%s "%s"', req.type, ufdsReq.requestDN);
}


function createMorayClient(options) {
    assert.ok(options);

    return morayClient.createClient({
        url: options.moray.url,
        log: options.log.child({
            component: 'moray'
        }),
        noCache: true,
        reconnect: true,
        retry: { // try to reconnect forever
            maxTimeout: 30000,
            retries: Infinity
        },
        dns: options.moray.dns || {},
        connectTimeout: options.moray.connectTimeout || 1000
    });
}


function createLDAPServer(options) {
    assert.ok(options);

    var _server = ldap.createServer(options);
    _server.after(audit);

    // Admin bind
    _server.bind(options.rootDN, function (req, res, next) {
        if (req.version !== 3) {
            return next(new ldap.ProtocolError(req.version + ' is not v3'));
        }

        if (req.credentials !== options.rootPassword) {
            return next(new ldap.InvalidCredentialsError(req.dn.toString()));
        }
        res.end();
        return next();
    });

    // ldapwhoami -H ldap://localhost:1389 -x -D cn=root -w secret
    // cn=root
    _server.exop('1.3.6.1.4.1.4203.1.11.3', function (req, res, next) {
        res.responseValue = req.connection.ldap.bindDN.toString();
        res.end();
        return next();
    });

    // RootDSE
    _server.search('', function (req, res, next) {
        function now() {
            function pad(n) {
                return String((n < 10) ? '0' + n : n);
            }
            var d = new Date();
            return String(d.getUTCFullYear() +
                pad(d.getUTCMonth() + 1) +
                pad(d.getUTCDate()) +
                pad(d.getUTCHours()) +
                pad(d.getUTCMinutes()) +
                pad(d.getUTCSeconds()) +
                '.0Z');
        }

        var suffixes = ['o=smartdc'];
        suffixes.push('cn=changelog');
        suffixes.push('cn=changelogcount');
        suffixes.push('cn=latestchangenumber');
        var entry = {
            dn: '',
            attributes: {
                namingcontexts: suffixes,
                supportedcontrol: ['1.3.6.1.4.1.38678.1',
                    '2.16.840.1.113730.3.4.3'],
                supportedextension: ['1.3.6.1.4.1.4203.1.11.3'],
                supportedldapversion: 3,
                currenttime: now(),
                objectclass: 'RootDSE'
            }
        };

        res.send(entry);
        res.end();
        return next();
    });

    _server.on('clientError', function (err) {
        _server.log.error({err: err}, 'LDAPJS Server Error');
    });

    return _server;
}


function UFDS(config) {
    this.config = config;
    this.log = config.log;
    this.moray = createMorayClient(config);
    this.server = createLDAPServer(config);
    // This is the only tree we're interested into for UFDS:
    this.suffix = 'o=smartdc';
    this.tree = config[this.suffix];
    this.use_bcrypt = (typeof (config.use_bcrypt) === 'boolean') ?
        config.use_bcrypt : true;
}

util.inherits(UFDS, EventEmitter);

UFDS.prototype.init = function (callback) {
    var self = this;
    var schema = sch.load(path.resolve(__dirname, '../schema'), self.log);
    self.log.info({schema: Object.keys(schema)}, 'Schema loaded');

    self.moray.once('error', function (err) {
        self.log.fatal({err: err}, 'Moray Error');
        process.exit(1);
    });

    self.server.use(function setup(req, res, next) {
        req.req_id = uuid();
        req.log = self.log.child({req_id: req.req_id}, true);
        req.moray = self.moray;
        req.schema = schema;
        req.config = self.config;
        // Allow to replace bcrypt encryption with SHA1 from config:
        req.use_bcrypt = self.use_bcrypt;
        return next();
    });

    // Do not add the listener more than 'once' to moray connect, or it will be
    // called for every client reconnection:
    self.moray.once('connect', function () {
        self.log.info('Successfully connected to moray');
        self.morayConnectCalback(self, callback);
    });

    self.moray.on('connectAttempt', function (moray, delay) {
        self.log.info({
            attempt: moray.toString(),
            delay: delay
        }, 'ring: moray connection attempted: %s', moray.toString());
    });
};


// Will emit 'morayError' if we cannot set either changelog (ufds_cn_changelog)
// or main UFDS (ufds_o_smartdc) buckets.
//
// Note that this same function can be used as a callback for 'morayError'.
UFDS.prototype.morayConnectCalback = function (ufds, callback) {
    var self = ufds;
    var clog = self.config.changelog;

    self.moray.putBucket(clog.bucket, {
        index: clog.schema,
        options: {
            guaranteeOrder: true,
            version: self.config.moray.version
        }
    }, function (cErr) {
        if (cErr) {
            self.log.fatal({err: cErr}, 'Unable to set changelog bucket');
            self.log.info('Trying again in 10 seconds');
            return setTimeout(function () {
                self.emit('morayError', self);
            }, 10000);
        }

        self.server.search('cn=changelog', function _setup(req, res, next) {
            req.bucket = clog.bucket;
            req.suffix = 'cn=changelog';
            return next();
        }, be.search());

        // Hack to be able to return changelog count w/o performing any search:
        self.server.search('cn=changelogcount', function _log(req, res, next) {
            var client = req.moray;
            var query = util.format('select count(*) from %s', clog.bucket);
            var count = 0;
            var r = client.sql(query);

            r.on('record', function (rec) {
                if (rec && rec.count) {
                    count = rec.count;
                }
            });

            r.once('error', function (err) {
                r.removeAllListeners('record');
                r.removeAllListeners('end');
                return next(err);
            });

            r.once('end', function () {
                res.send({
                    dn: 'cn=changelogcount',
                    attributes: {
                        objectclass: ['changelogcount'],
                        cn: ['changelogcount'],
                        count: [count]
                    }
                });
                res.end();
                return next();
            });
        });

        // And same thing for latestchangenumber, given it could not match
        // for ufds-replicas:
        self.server.search('cn=latestchangenumber',
                function _log2(req, res, next) {
            var client = req.moray;
            var query = util.format(
                'select _id from %s order by _id desc limit 1', clog.bucket);
            var count = 0;
            var r = client.sql(query);

            r.on('record', function (rec) {
                if (rec && rec._id) {
                    count = rec._id;
                }
            });

            r.once('error', function (err) {
                r.removeAllListeners('record');
                r.removeAllListeners('end');
                return next(err);
            });

            r.once('end', function () {
                res.send({
                    dn: 'cn=latestchangenumber',
                    attributes: {
                        objectclass: ['latestchangenumber'],
                        cn: ['latestchangenumber'],
                        count: [count]
                    }
                });
                res.end();
                return next();
            });
        });

        self.log.debug({
            bucket: self.tree.bucket,
            schema: self.tree.schema,
            suffix: self.suffix
        }, 'Configuring UFDS bucket');

        return self.moray.putBucket(self.tree.bucket, {
            index: self.tree.schema,
            pre: [
                be.pre.fixTypes
            ],
            options: {
                guaranteeOrder: true,
                version: self.config.moray.version
            }
        }, function (err) {
            if (err) {
                self.log.fatal({err: err}, 'Unable to set UFDS bucket');
                self.log.info('Trying again in 10 seconds');
                return setTimeout(function () {
                    self.emit('morayError', self);
                }, 10000);
            }

            function __setup(req, res, next) {
                req.bucket = self.tree.bucket;
                req.suffix = self.suffix;

                return next();
            }

            self.server.add(self.suffix, __setup, be.add());
            self.server.bind(self.suffix, __setup, be.bind());
            self.server.compare(self.suffix, __setup, be.compare());
            self.server.del(self.suffix, __setup, be.del());
            self.server.modify(self.suffix, __setup, be.modify());
            self.server.search(self.suffix, __setup, be.search());
            return self.server.listen(self.config.port, self.config.host,
                function () {
                self.server.log.info('UFDS listening at: %s\n\n',
                    self.server.url);
                callback();
            });

        });
    });
};

module.exports = {
    createServer: function createServer(options) {
        // Just create a new Bunyan instance if not given:
        if (options.log === undefined) {
            options.log = new bunyan({
                name: 'ufds',
                stream: process.stdout,
                serializers: {
                    err: bunyan.stdSerializers.err
                }
            });
        }
        // Minimal type check. We should possibly check for every tree
        // required member into morayConnectCalback.
        if (!options.moray) {
            throw new TypeError('options.moray (Object) required');
        }

        if (!options.changelog) {
            throw new TypeError('options.changelog (Object) required');
        }

        if (!options['o=smartdc']) {
            throw new TypeError('options[\'o=smartdc\'] (Object) required');
        }

        var ufds = new UFDS(options);
        return ufds;
    }
};
