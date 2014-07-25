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
var fs = require('fs');

var ldap = require('ldapjs');
var morayClient = require('moray');
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}
var bunyan = require('bunyan');
var vasync = require('vasync');

var be = require('./index');
var sch = require('./schema');
var controls = require('./controls/index');


///--- Globals

var SUFFIX = 'o=smartdc';
var UUID_SUFFIX = 'cn=uuid';

///--- Helpers

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
        // try to reconnect forever
        retry: {
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
        if (req.dn.toString() !== '') {
            // The empty DN became a catch-all route in recent ldapjs
            return next(new ldap.NoSuchObjectError());
        }

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

        var suffixes = [SUFFIX];
        suffixes.push('cn=changelog');
        var entry = {
            dn: '',
            attributes: {
                namingcontexts: suffixes,
                supportedcontrol: [
                    '1.2.840.113556.1.4.473',   // Server side sort
                    '1.3.6.1.4.1.38678.1',      // Joyent "hidden"
                    controls.ChangelogHintRequestControl.OID,
                    controls.CheckpointUpdateRequestControl.OID,
                    '2.16.840.1.113730.3.4.3'   // Persistent search
                ],
                supportedextension: ['1.3.6.1.4.1.4203.1.11.3'],
                supportedldapversion: 3,
                morayVersion: options.moray.version,
                currenttime: now(),
                objectclass: 'RootDSE'
            }
        };

        res.send(entry);
        res.end();
        return next();
    });

    _server.on('clientError', function (err) {
        // CAPI-342: Do not log.error 404s.
        if (err.name && err.name === 'NoSuchObjectError') {
            _server.log.info({err: err}, 'LDAPJS Server NoSuchObjectError');
        } else {
            _server.log.error({err: err}, 'LDAPJS Server Error');
        }
    });

    return _server;
}


function processConfigFile(file) {
    try {
        var config = JSON.parse(fs.readFileSync(file, 'utf8'));

        if (config.certificate && config.key && !config.port) {
            config.port = 636;
        }

        if (!config.port) {
            config.port = 389;
        }
    } catch (e) {
        console.error('Unable to parse configuration file: ' + e.message);
        process.exit(1);
    }
    return config;
}


function UFDS(config) {
    this.config = config;
    this.log = config.log;
    this.moray = createMorayClient(config);
    this.server = createLDAPServer(config);
    // This is the only tree we're interested into for UFDS:
    this.suffix = SUFFIX;
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
        self.morayConnectCallback(callback);
    });

    self.moray.on('connectAttempt', function (moray, delay) {
        self.log.info({
            attempt: moray.toString(),
            delay: delay
        }, 'ring: moray connection attempted: %s', moray.toString());
    });
};


/**
 * Shutdown UFDS server and close moray connection.
 */
UFDS.prototype.close = function close() {
    if (!this.closed) {
        this.server.close();
        this.moray.close();
        this.closed = true;
    }
};


// Will emit 'morayError' if we cannot set either changelog (ufds_cn_changelog)
// or main UFDS (ufds_o_smartdc) buckets.
//
// Note that this same function can be used as a callback for 'morayError'.
UFDS.prototype.morayConnectCallback = function (callback) {
    var self = this;
    var clog = self.config.changelog;

    this.log.info('morayCallback');
    if (this._reconnectTimeout) {
        clearTimeout(this._reconnectTimeout);
        this._reconnectTimeout = null;
    }

    vasync.pipeline({
        funcs: [
            function morayClog(_, next) {
                self.log.debug({
                    bucket: clog.bucket,
                    schema: clog.schema
                }, 'Configuring Changelog bucket');
                self.moray.putBucket(clog.bucket, {
                    index: clog.schema,
                    options: {
                        guaranteeOrder: true,
                        version: self.config.moray.version
                    }
                }, function (mErr) {
                    if (mErr) {
                        self.log.fatal({err: mErr},
                            'Unable to set changelog bucket');
                    }
                    next(mErr);
                });
            },
            function morayUFDS(_, next) {
                self.log.debug({
                    bucket: self.tree.bucket,
                    schema: self.tree.schema,
                    suffix: self.suffix
                }, 'Configuring UFDS bucket');
                self.moray.putBucket(self.tree.bucket, {
                    index: self.tree.schema,
                    pre: [
                        be.pre.fixTypes
                    ],
                    options: {
                        guaranteeOrder: true,
                        version: self.config.moray.version
                    }
                }, function (mErr) {
                    if (mErr) {
                        self.log.fatal({err: mErr},
                            'Unable to set UFDS bucket');
                    }
                    next(mErr);
                });
            },
            function uuidInit(_, next) {
                var key = UUID_SUFFIX;
                var opts = {};
                function uuidExists(cb) {
                    self.log.debug('lookup ufds uuid');
                    self.moray.getObject(self.tree.bucket, key, opts,
                        function (err, obj) {
                            if (err) {
                                if (err.name === 'ObjectNotFoundError') {
                                    cb(null, false);
                                } else {
                                    cb(err);
                                }
                            } else {
                                cb(null, true);
                            }
                    });
                }
                function uuidCreate(cb) {
                    self.log.debug('create ufds uuid');
                    self.moray.putObject(self.tree.bucket, key, {
                        objectclass: ['sdcufds'],
                        uuid: [uuid()]
                    }, opts, cb);
                }
                uuidExists(function (err, exists) {
                    if (err) {
                        return next(err);
                    }
                    if (exists) {
                        return next();
                    }
                    self.log.debug('ufds uuid not found');
                    return uuidCreate(function (err2) {
                        if (err2) {
                            self.log.fatal({err: err2},
                                'unable to store ufds uuid');
                        }
                        next(err);
                    });
                });
            }
        ]
    }, function (err, result) {
        if (err) {
            self.log.info('Trying again in 10 seconds');
            self._reconnectTimer = setTimeout(
                    self.morayConnectCallback.bind(self), 10000);
        } else {
            self.server.search('cn=changelog', function _setup(req, res, next) {
                req.bucket = clog.bucket;
                req.suffix = 'cn=changelog';
                return next();
            }, be.search());
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

            // server UUID endpoint
            function __uuidSetup(req, res, next) {
                req.bucket = self.tree.bucket;
                req.suffix = UUID_SUFFIX;
                return next();
            }
            self.server.search(UUID_SUFFIX, __uuidSetup, be.search());

            self.server.listen(self.config.port, self.config.host,
                function () {
                self.server.log.info('UFDS listening at: %s\n\n',
                    self.server.url);
                callback();
            });
        }
    });
};

///--- API

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
        // required member into morayConnectCallback.
        if (!options.moray) {
            throw new TypeError('options.moray (Object) required');
        }

        if (!options.changelog) {
            throw new TypeError('options.changelog (Object) required');
        }

        if (!options[SUFFIX]) {
            throw new TypeError('options[\'o=smartdc\'] (Object) required');
        }

        var ufds = new UFDS(options);
        return ufds;
    },
    processConfigFile: processConfigFile
};
