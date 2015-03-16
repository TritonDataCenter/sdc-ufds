/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * UFDS LDAP Server definition, including the server itself,
 * moray configuration and connection callbacks, buckets
 * creation/upgrade, server suffixes, controls, searches and
 * the different LDAP operations.
 */

var assert = require('assert');
var util = require('util');
var sprintf = util.format;
var EventEmitter = require('events').EventEmitter;
var path = require('path');
var fs = require('fs');

var ldap = require('ldapjs');
var filters = ldap.filters;
var morayClient = require('moray');
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}
var bunyan = require('bunyan');
var vasync = require('vasync');
var backoff = require('backoff');

var be = require('./index');
var sch = require('./schema');


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
        retry: {
            // try to reconnect forever
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
                supportedcontrol: [
                    '1.2.840.113556.1.4.473',   // Server side sort
                    '1.3.6.1.4.1.38678.1',      // Joyent "hidden"
                    '2.16.840.1.113730.3.4.3'   // Persistent search
                ],
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
        // CAPI-342: Do not log.error 404s.
        if (err.name && err.name === 'NoSuchObjectError') {
            _server.log.info({err: err}, 'LDAPJS Server NoSuchObjectError');
        } else {
            _server.log.error({err: err}, 'LDAPJS Server Error');
        }
    });

    return _server;
}


///--- API

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
        self._morayConnectCallback(callback);
    });

    self.moray.on('connectAttempt', function (moray, delay) {
        self.log.info({
            attempt: moray.toString(),
            delay: delay
        }, 'ring: moray connection attempted: %s', moray.toString());
    });
};

UFDS.prototype._morayConnectCallback = function (callback) {
    var self = this;
    var clog = self.config.changelog;


    var retry = backoff.exponential({
        initialDelay: 500,
        maxDelay: 30000
    });

    var setupPipe = {
        arg: {},
        funcs: [
            function updateBucketClog(_, cb) {
                self.log.info({
                    bucket: clog.bucket,
                    version: self.config.moray.version,
                    schema: clog.schema
                }, 'Configuring UFDS clog bucket');
                self.moray.putBucket(clog.bucket, {
                    index: clog.schema,
                    options: {
                        guaranteeOrder: true,
                        version: self.config.moray.version
                    }
                }, function (err) {
                    if (err) {
                        if (err.name === 'BucketVersionError') {
                            // A newer bucket is acceptable
                            cb();
                            return;
                        }
                        self.log.error({err: err},
                            'Unable to set changelog bucket');
                    }
                    cb(err);
                });
            },
            function updateBucketMain(_, cb) {
                self.log.info({
                    bucket: self.tree.bucket,
                    version: self.config.moray.version,
                    schema: self.tree.schema,
                    suffix: self.suffix
                }, 'Configuring UFDS main bucket');
                self.moray.putBucket(self.tree.bucket, {
                    index: self.tree.schema,
                    pre: [be.pre.fixTypes],
                    options: {
                        guaranteeOrder: true,
                        version: self.config.moray.version
                    }
                }, function (err) {
                    if (err) {
                        if (err.name === 'BucketVersionError') {
                            // A newer bucket is acceptable
                            cb();
                            return;
                        }
                        self.log.fatal({err: err}, 'Unable to set UFDS bucket');
                    }
                    cb(err);
                });
            },
            function checkReindexNeeded(_, cb) {
                self.moray.getBucket(self.tree.bucket, function (err, res) {
                    if (err) {
                        cb(err);
                    } else {
                        if (res.reindex_active &&
                            Object.keys(res.reindex_active).length !== 0) {
                            _.reindex = true;
                        }
                        cb();
                    }
                });
            },
            function migrateEmailBlacklist(_, cb) {
                self._migrateBlacklist(function (err, skipReindex) {
                    if (err) {
                        return cb(err);
                    }
                    /*
                     * UFDS non-master instances may need to skip reindexing
                     * until the email blacklist has been migrated on the
                     * master and replicated locally.
                     */
                    if (skipReindex) {
                        _.reindex = false;
                    }
                    return cb();
                });
            },
            function completeReindex(_, cb) {
                if (!_.reindex) {
                    return cb();
                }
                var loops = 0;
                self.log.info({ bucket: self.tree.bucket },
                    'Beginning reindexObjects');
                function reindexLoop() {
                    // Keep the rows-per-reindex small to limit memory usage
                    var rowsPerRun = 250;
                    // Only do 'remaining' count once every 10th call so as to
                    // cut down on work done by PG/moray
                    var opts = {
                        no_count: ((loops % 10) !== 0)
                    };
                    self.moray.reindexObjects(self.tree.bucket, rowsPerRun,
                        opts, function (err, res) {
                        if (err) {
                            cb(err);
                            return;
                        }
                        if (res.processed === 0) {
                            cb();
                        } else {
                            loops++;
                            setImmediate(reindexLoop);
                        }
                    });
                }
                return reindexLoop();
            }
        ]
    };

    retry.on('ready', function () {
        vasync.pipeline(setupPipe, function (err, res) {
            if (err) {
                retry.backoff();
            } else {
                /* finish setup and report success */
                self._moraySetupCallback(function () {
                    self.server.log.info('UFDS listening at: %s',
                            self.server.url);
                    callback();
                });
                self._retry = null;
            }
        });
    });
    self._retry = retry;
    retry.emit('ready');
};

UFDS.prototype._migrateBlacklist = function _migrateBlacklist(callback) {
    var self = this;

    /*
     * 1. does the blacklist require migration
     * 2. generate new emailblacklistentry records
     * 3. modify old blacklist entry
     * 4. commit batch
     */
    var arg = {
        toMigrate: [],
        baseDN: this.config[this.suffix].blacklistRDN + ', ' + this.suffix,
        bucket: this.tree.bucket,
        clogBucket: this.config.changelog.bucket,
        batch: []
    };
    var chain = [
        function checkBlacklist(_, cb) {
            var opts = { noCache: true };
            self.moray.getObject(_.bucket, _.baseDN, opts, function (err, res) {
                if (err) {
                    if (err.name === 'ObjectNotFoundError') {
                        /*
                         * The CAPI fraud endpoints aren't going to work with
                         * this missing.  I hope someone had a good reason for
                         * removing it.
                         */
                        return cb();
                    } else {
                        return cb(err);
                    }
                }
                if (Array.isArray(res.value.email) &&
                    res.value.email.length > 0) {
                    /* grab the old-style blacklist entries */
                    _.toMigrate = res.value.email;
                    _.old = res;
                }
                return cb();
            });
        },
        function generateNewEntries(_, cb) {
            if (_.toMigrate.length === 0) {
                return cb();
            }
            /*
             * If this is a non-master UFDS instance, migrating the blacklist
             * would cause conflicts once it is performed on the master and
             * replicated to this DC.  In such cases, we must forgo the
             * migration but also temporarly skip the bucket reindexing.  That
             * cannot occur until the master has migrated the blacklist and
             * replicated the changes to the local DC.
             */
            if (!self.config.ufds_is_master) {
                _.toMigrate = [];
                _.skipReindex = true;
                return cb();
            }

            function validateEntry(email, next) {
                var entryFilter;
                var entry = {
                    uuid: uuid(),
                    objectclass: ['emailblacklistentry'],
                    _parent: _.baseDN
                };
                /* Is it a single email or a *@domain wildcard? */
                if (email.indexOf('*') !== -1) {
                    entry.denydomain =  email.split('@')[1];
                    entryFilter = new filters.EqualityFilter({
                        attribute: 'denydomain',
                        value: entry.denydomain
                    });
                } else {
                    entry.denyemail =  email;
                    entryFilter = new filters.EqualityFilter({
                        attribute: 'denyemail',
                        value: entry.denyemail
                    });
                }

                /*
                 * Check if a new-style entry already exists.
                 * This is a little iffy given that denyemail/denydomain may
                 * not yet be valid indexes within moray.  If that's the case,
                 * it's unlikely that there will be enough child entries to
                 * present a problem.
                 */
                var filter = new filters.AndFilter({
                    filters: [
                        new filters.EqualityFilter({
                            attribute: 'objectclass',
                            value: 'emailblacklistentry'
                        }),
                        new filters.EqualityFilter({
                            attribute: '_parent',
                            value: _.baseDN
                        }),
                        entryFilter
                    ]
                });
                var found = false;
                var res = self.moray.findObjects(_.bucket, filter.toString());
                res.once('error', function (err) {
                    res.removeAllListeners();
                    next(err);
                });
                res.once('record', function () {
                    found = true;
                });
                res.once('end', function () {
                    if (found) {
                        return next();
                    }
                    var dn = sprintf('uuid=%s, %s', entry.uuid, _.baseDN);
                    _.batch.push({
                        bucket: _.bucket,
                        key: dn,
                        operation: 'put',
                        value: entry,
                        options: { etag: null }
                    });
                    _.batch.push(be.changelog.createClogBatch(
                        'add',
                        _.clogBucket,
                        dn,
                        JSON.stringify(entry),
                        null));
                    return next();
                });
            }
            vasync.forEachPipeline({
                inputs: _.toMigrate,
                func: validateEntry
            }, function (err, res) {
                cb(err);
            });
        },
        function fixOldBlacklist(_, cb) {
            if (_.toMigrate.length === 0) {
                return cb();
            }
            var fixed = _.old.value;
            var changeEntry = {
                operation: 'delete',
                modification: {
                    type: 'email',
                    vals: []
                }
            };
            fixed.email = [];
            _.batch.push({
                bucket: _.bucket,
                key: _.baseDN,
                operation: 'put',
                value: fixed,
                options: { etag: _.old._etag }
            });
            _.batch.push(be.changelog.createClogBatch(
                'modify',
                _.clogBucket,
                _.baseDN,
                JSON.stringify([changeEntry]),
                JSON.stringify(fixed)));
            return cb();
        },
        function commitChanges(_, cb) {
            if (_.toMigrate.length === 0) {
                return cb();
            }
            self.log.debug({changes: _.batch},
                'committing blacklist migration');
            var opts = {};
            self.moray.batch(_.batch, opts, function (err, res) {
                if (err) {
                    return cb(err);
                }
                self.log.info('Blacklist migrated');
                return cb();
            });
        }
    ];

    vasync.pipeline({
        funcs: chain,
        arg: arg
    }, function (err, res) {
        callback(err, arg.skipReindex);
    });
};

UFDS.prototype._moraySetupCallback = function _moraySetupCallback(callback) {
    var clog = this.config.changelog;

    this.server.search('cn=changelog', function _setup(req, res, next) {
        req.bucket = clog.bucket;
        req.suffix = 'cn=changelog';
        return next();
    }, be.search());

    // Hack to be able to return changelog count w/o performing any search:
    this.server.search('cn=changelogcount', function _log(req, res, next) {
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
    this.server.search('cn=latestchangenumber', function _log2(req, res, next) {
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

    var bucket = this.tree.bucket;
    var suffix = this.suffix;
    function _reqSetup(req, res, next) {
        req.bucket = bucket;
        req.suffix = suffix;
        return next();
    }

    this.server.add(this.suffix, _reqSetup, be.add());
    this.server.bind(this.suffix, _reqSetup, be.bind());
    this.server.compare(this.suffix, _reqSetup, be.compare());
    this.server.del(this.suffix, _reqSetup, be.del());
    this.server.modify(this.suffix, _reqSetup, be.modify());
    this.server.search(this.suffix, _reqSetup, be.search());
    this.server.listen(this.config.port, this.config.host, callback);
};


///--- Exports

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

        if (!options['o=smartdc']) {
            throw new TypeError('options[\'o=smartdc\'] (Object) required');
        }

        var ufds = new UFDS(options);
        return ufds;
    },
    processConfigFile: processConfigFile
};
