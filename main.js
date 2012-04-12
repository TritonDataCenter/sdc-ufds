// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

var Logger = require('bunyan');
var ldap = require('ldapjs');
var moray = require('moray-client');
var nopt = require('nopt');
var retry = require('retry');
var uuid = require('node-uuid');


var be = require('./lib');
var schema = require('./lib/schema');

// TODO: groups and blacklist



///--- Globals

var LOG = new Logger({
    name: 'ufds',
    stream: process.stdout,
    serializers: {
        err: Logger.stdSerializers.err
    }
});

var OPTS = {
    'certificate': String,
    'debug': Number,
    'file': String,
    'key': String,
    'port': Number,
    'help': Boolean
};

var SHORT_OPTS = {
    'c': ['--certificate'],
    'd': ['--debug'],
    'f': ['--file'],
    'k': ['--key'],
    'p': ['--port'],
    'h': ['--help']
};

var SCHEMA;



///--- Helpers

function usage(code, message) {
    var _opts = '';
    Object.keys(SHORT_OPTS).forEach(function (k) {
        var longOpt = SHORT_OPTS[k][0].replace('--', '');
        var type = OPTS[longOpt].name || 'string';
        if (type && type === 'boolean') type = '';
        type = type.toLowerCase();

        _opts += ' [--' + longOpt + ' ' + type + ']';
    });

    var msg = (message ? message + '\n' : '') +
        'usage: ' + path.basename(process.argv[1]) + _opts;

    console.error(msg);
    process.exit(code);
}


function errorAndExit(err, message) {
    LOG.fatal({err: err}, message);
    process.exit(1);
}


function processConfig() {
    var config;
    var parsed = nopt(OPTS, SHORT_OPTS, process.argv, 2);

    if (parsed.help)
        usage(0);

    try {
        var file = parsed.file || __dirname + '/etc/ufds.config.json';

        config = JSON.parse(fs.readFileSync(file, 'utf8'));

        if (config.certificate && config.key && !config.port)
            config.port = 636;

        if (!config.port)
            config.port = 389;

    } catch (e) {
        console.error('Unable to parse configuration file: ' + e.message);
        process.exit(1);
    }

    if (parsed.port)
        config.port = parsed.port;

    if (parsed.debug)
        LOG.level(parsed.debug > 1 ? 'trace' : 'debug');

    if (parsed.certificate)
        config.certificate = parsed.certificate;
    if (parsed.key)
        config.key = parsed.key;

    if (config.certificate)
        config.certificate = fs.readFileSync(config.certificate, 'utf8');
    if (config.key)
        config.key = fs.readFileSync(config.key, 'utf8');

    LOG.debug('config processed: %j', config);
    config.log = LOG;
    return config;
}



function audit(req, res, next) {
    var additional = '';
    switch (req.type) {
    case 'BindRequest':
        additional += 'bindType=' + req.authentication + ', ';
        break;
    case 'AddRequest':
        var attrs = req.toObject().attributes;
        if (attrs.userpassword)
            attrs.userpassword = ['XXXXXX'];
        additional += 'entry= ' + JSON.stringify(attrs) + ', ';
        break;
    case 'SearchRequest':
        additional += 'scope=' + req.scope + ', ' +
            'filter=' + req.filter.toString() + ', ' +
            'attributes=' + (req.attributes.join() || '[]') + ', ' +
            'sentEntries=' + res.sentEntries + ', ';
        break;
    }

    LOG.info('clientip=' + (req.connection.remoteAddress || 'localhost') +
             ', ' +
             'bindDN=' + req.connection.ldap.bindDN.toString() + ', ' +
             'msgid=' + req.id + ', ' +
             'request=' + req.type + ', ' +
             'requestDN=' + req.dn.toString() + ', ' +
             additional +
             'status=' + res.status + ', ' +
             'time=' + (new Date().getTime() - req.startTime) + 'ms, '
            );
}


function createMorayClient(config) {
    assert.ok(config);

    return moray.createClient({
        url: config.moray.url,
        log: LOG.child({
            component: 'moray'
        }),
        retry: config.moray.retry || false,
        connectTimeout: config.moray.connectTimeout || 1000
    });
}


function createServer(config) {
    assert.ok(config);

    var server = ldap.createServer(config);
    server.after(audit);

    // Admin bind
    server.bind(config.rootDN, function(req, res, next) {
        if (req.version !== 3)
            return next(new ldap.ProtocolError(req.version + ' is not v3'));

        if (req.credentials !== config.rootPassword)
            return next(new ldap.InvalidCredentialsError(req.dn.toString()));

        res.end();
        return next();
    });

    // ldapwhoami -H ldap://localhost:1389 -x -D cn=root -w secret
    // cn=root
    server.exop('1.3.6.1.4.1.4203.1.11.3', function(req, res, next) {
        res.responseValue = req.connection.ldap.bindDN.toString();
        res.end();
        return next();
    });

    // RootDSE
    server.search('', function(req, res, next) {
        function now() {
            function pad(n) { return ((n < 10) ? '0' + n : n); }
            var d = new Date();
            return d.getUTCFullYear() +
                pad(d.getUTCMonth() + 1) +
                pad(d.getUTCDate()) +
                pad(d.getUTCHours()) +
                pad(d.getUTCMinutes()) +
                pad(d.getUTCSeconds()) +
                '.0Z';
        }

        var suffixes = config.trees.keys();
        suffixes.push('cn=changelog');
        var entry = {
            dn: '',
            attributes: {
                namingcontexts: suffixes,
                supportedcontrol: ['1.3.6.1.4.1.38678.1'],
                supportedcontrol: ['2.16.840.1.113730.3.4.3'],
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

    return server;
}


function listen(server) {
    return server.listen(config.port, config.host, function () {
        LOG.info('UFDS listening at: %s\n\n', server.url);
    });
}


///--- Mainline

var config = processConfig();

SCHEMA = schema.load(__dirname + '/schema', LOG);
LOG.info({schema: Object.keys(SCHEMA)}, 'Schema loaded');

var finished = 0;
var moray = createMorayClient(config);
var server = createServer(config);
var trees = config.trees;

server.use(function setup(req, res, next) {
    req.req_id = uuid();
    req.log = LOG.child({req_id: req.req_id}, true);
    req.moray = moray;
    req.schema = SCHEMA;

    return next();
});

return Object.keys(trees).forEach(function (t) {
    LOG.debug({
        bucket: trees[t].bucket,
        schema: trees[t].schema,
        suffix: t
    }, 'Configuring UFDS bucket');

    var bucket = trees[t].bucket;
    var cfg = {
        schema: trees[t].schema
        // TODO Changelog Post function
    };

    return moray.putBucket(bucket, cfg, function (err) {
        if (err)
            errorAndExit(err, 'Unable to set Moray bucket');

        function _setup(req, res, next) {
            req.bucket = trees[t].bucket;
            req.suffix = t;

            return next();
        }

        server.add(t, be.add(_setup));
        server.bind(t, be.bind(_setup));
        server.compare(t, be.compare(_setup));
        server.del(t, be.del(_setup));
        server.modify(t, be.modify(_setup));
        server.search(t, be.search(_setup));

        return ++finished === Object.keys(trees).length ? listen(server) : 0;
    });
});


    /*
    var trees = Object.keys(config.trees);
    var servers = [createServer(config, trees)];
    // Ghetto!
    var cert = CONFIG.certificate;
    var key = CONFIG.key;
    delete CONFIG.certificate;
    delete CONFIG.key;
    servers.push(createServer(CONFIG, trees));
    CONFIG.certificate = cert;
    CONFIG.key = key;

    servers.forEach(function(server) {
        trees.forEach(function(t) {
            var suffix = ldap.parseDN(t);
            var tree = CONFIG.trees[t];
            if (typeof(tree.riak) !== 'object') {
                log.warn('Tree type %s is an invalid type. Ignoring %s', tree.type, t);
                return;
            }

            tree.riak.log4js = log4js;
            var be = ldapRiak.createBackend(tree.riak);
            var timer;

            function _init(callback) {
                var operation = retry.operation({
                    retries: 10,
                    factor: 2,
                    minTimeout: 1000,
                    maxTimeout: Number.MAX_VALUE,
                    randomize: false
                }); // Bake in the defaults, as they're fairly sane

                operation.attempt(function(currentAttempt) {
                    be.init(function(err) {
                        if (err) {
                            log.warn('Error initializing backend(attempt=%d): %s',
                                     currentAttempt, err.toString());
                            if (operation.retry(err))
                                return;

                            return callback(operation.mainError());
                        }

                        return callback();
                    });
                });
            }

            function setup(req, res, next) {
                if (req.toObject)
                    req.object = req.toObject();

                if (tree.blacklistRDN)
                    req.blacklistEmailDN = tree.blacklistRDN + ', ' + suffix;

                req.schema = _schema;
                req.suffix = suffix;
                req.client = CLIENT;

                // Allows downstream code to easily check group membership
                req.memberOf = function(groupdn, callback) {
                    return groupManager.memberOf(req.dn, groupdn, callback);
                };

                req.searchCallback = function(req, entry, callback) {
                    return groupManager.searchCallback(req, entry, callback);
                };

                return next();
            }

            function authorize(req, res, next) {
                // Check the easy stuff first
                if (req.type === 'BindRequest')
                    return next();

                var bindDN = req.connection.ldap.bindDN;

                if (bindDN.equals(CONFIG.rootDN)) {
                    req.hidden = true;
                    return next();
                }

                if (bindDN.equals(req.dn) || bindDN.parentOf(req.dn))
                    return next();

                // Otherwise check the backend
                var operators = 'cn=operators, ou=groups, ' + t;
                groupManager.memberOf(bindDN, operators, function(err, member) {
                    if (err)
                        return next(err);

                    return next(member ? null : new ldap.InsufficientAccessRightsError());
                });
            }

            var pre = [setup, authorize];

            server.add(t, be, pre, blacklist.add, salt.add, keys.add, owner.add,
                       schema.add, be.add());
            server.bind(t, be, pre, be.bind(salt.bind));
            server.compare(t, be, pre, be.compare(salt.compare));
            server.del(t, be, pre, be.del());
            // No modifyDN
            server.search(t, be, pre, owner.search, be.search(salt.search));
            // This doesn't actually work with multiple backends...
            server.search('cn=changelog', be, pre, be.changelogSearch());

            // Modify is the most complicated, since we have to go load the enttry
            // to validate the schema
            server.modify(t, be, pre, be.modify(
                [
                    function (req, res, next) {
                        assert.ok(req.riak);
                        var client = req.riak.client;

                        client.get(req.riak.bucket, req.riak.key, function(err, entry) {
                            if (err) {
                                if (err.statusCode === 404)
                                    return next(new ldap.NoSuchObjectError(req.dn.toString()));

                                log.warn('%s error talking to riak %s', req.logId, err.stack);
                                return next(new ldap.OperationsError('Riak: ' + err.message));
                            }

                            // store this so we don't go refetch it.
                            req.entry = entry;
                            req.riak.entry = entry;
                            return next();
                        });
                    },
                    schema.modify, salt.modify]));

            // Go ahead and kick off backend initialization
            _init(function(err) {
                if (err) {
                    log.fatal('Unable to initialize Riak backend, exiting');
                    process.exit(1);
                }

                log.info('Riak backend initialized');
            });
        });
    });

    // Rock 'n Roll
    servers[0].listen(CONFIG.port, function() {
        log.info('UFDS listening at: %s\n\n', servers[0].url);
    });
    servers[1].listen(CONFIG.loopbackPath, function() {
        log.info('UFDS listening at: %s\n\n', servers[1].url);
        CLIENT = ldap.createClient({
            socketPath: CONFIG.loopbackPath,
            log4js: log4js
        });

        CLIENT.once('error', function(err) {
            log.fatal('Error connecting: %s', err.stack);
            process.exit(1);
        });

        CLIENT.bind(CONFIG.rootDN, CONFIG.rootPassword, function(err) {
            if (err) {
                log.fatal('Unable to bind to: %s: %s', CONFIG.loopbackPath, err.stack);
                process.exit(1);
            }

            groupManager = groups.createGroupManager({
                cache: {
                    size: CONFIG.lruCacheSize,
                    age: CONFIG.lruCacheAge,
                },
                client: CLIENT,
                log4js: log4js
            });
        });
    });

});
*/



///--- Serve up docs

// var file = new(nstatic.Server)('./docs/pkg');
// var docsPort = CONFIG.port < 1024 ? 80 : 9080;
// require('http').createServer(function (req, res) {
//     req.addListener('end', function () {
//         file.serve(req, res);
//     });
// }).listen(docsPort, function() {
//     log.info('Docs listener up at %d', docsPort);
// });

