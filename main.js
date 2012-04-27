// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

var Logger = require('bunyan');
var ldap = require('ldapjs');
var morayClient = require('moray-client');
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
    var _config;
    var parsed = nopt(OPTS, SHORT_OPTS, process.argv, 2);
    var file = parsed.file || __dirname + '/etc/ufds.config.json';

    if (parsed.help)
        usage(0);

    LOG.info({file: file}, 'Processing configuration file');

    try {

        _config = JSON.parse(fs.readFileSync(file, 'utf8'));

        if (_config.certificate && _config.key && !_config.port)
            _config.port = 636;

        if (!_config.port)
            _config.port = 389;

    } catch (e) {
        console.error('Unable to parse configuration file: ' + e.message);
        process.exit(1);
    }

    if (parsed.port)
        _config.port = parsed.port;

    if (parsed.debug)
        LOG.level(parsed.debug > 1 ? 'trace' : 'debug');

    if (parsed.certificate)
        _config.certificate = parsed.certificate;
    if (parsed.key)
        _config.key = parsed.key;

    if (_config.certificate)
        _config.certificate = fs.readFileSync(_config.certificate, 'utf8');
    if (_config.key)
        _config.key = fs.readFileSync(_config.key, 'utf8');

    LOG.debug('config processed: %j', _config);
    _config.log = LOG;
    return _config;
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
    default:
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
             'time=' + (new Date().getTime() - req.startTime) + 'ms, ');
}


function createMorayClient(options) {
    assert.ok(options);

    return morayClient.createClient({
        url: options.moray.url,
        log: LOG.child({
            component: 'moray'
        }),
        retry: options.moray.retry || false,
        connectTimeout: options.moray.connectTimeout || 1000
    });
}


function createServer(options) {
    assert.ok(options);

    var _server = ldap.createServer(options);
    _server.after(audit);

    // Admin bind
    _server.bind(options.rootDN, function (req, res, next) {
        if (req.version !== 3)
            return next(new ldap.ProtocolError(req.version + ' is not v3'));

        if (req.credentials !== options.rootPassword)
            return next(new ldap.InvalidCredentialsError(req.dn.toString()));

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

        var suffixes = Object.keys(options.trees);
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

    return _server;
}


function listen(_server) {
    return _server.listen(config.port, config.host, function () {
        LOG.info('UFDS listening at: %s\n\n', _server.url);
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
    req.config = config;

    return next();
});

var clog = config.changelog;
moray.putBucket(clog.bucket, {schema: clog.schema}, function (clogErr) {
    if (clogErr)
        errorAndExit(clogErr, 'Unable to set changelog bucket');

    server.search('cn=changelog',
                  function _setup(req, res, next) {
                      req.bucket = clog.bucket;
                      req.suffix = 'cn=changelog';
                      return next();
                  },
                  be.search());

    return Object.keys(trees).forEach(function (t) {
        LOG.debug({
            bucket: trees[t].bucket,
            schema: trees[t].schema,
            suffix: t
        }, 'Configuring UFDS bucket');

        var bucket = trees[t].bucket;
        var cfg = {
            schema: trees[t].schema,
            post: [
                be.changelog.add,
                be.changelog.mod,
                be.changelog.del
            ]
        };

        return moray.putBucket(bucket, cfg, function (err) {
            if (err)
                errorAndExit(err, 'Unable to set Moray bucket');

            function __setup(req, res, next) {
                req.bucket = trees[t].bucket;
                req.suffix = t;

                return next();
            }

            server.add(t, __setup, be.add());
            server.bind(t, __setup, be.bind());
            server.compare(t, __setup, be.compare());
            server.del(t, __setup, be.del());
            server.modify(t, __setup, be.modify());
            server.search(t, __setup, be.search());

            if (++finished < Object.keys(trees).length)
                return false;

            return listen(server);
        });
    });
});
