// Copyright 2013 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var fs = require('fs');
var http = require('http');
var path = require('path');
var sprintf = require('util').format;

var Logger = require('bunyan');
var ldap = require('ldapjs');
var nopt = require('nopt');
var restify = require('restify');
var uuid = require('node-uuid');

var customers = require('./capi/customers');
var keys = require('./capi/keys');
var login = require('./capi/login');
var limits = require('./capi/limits');
var metadata = require('./capi/metadata');
var utils = require('./capi/util');



///--- Globals



var opts = {
    'certificate': String,
    'config': String,
    'debug': Boolean,
    'file': String,
    'key': String,
    'port': Number,
    'ufds': String,
    'help': Boolean
};

var shortOpts = {
    'c': ['--certiifcate'],
    'd': ['--debug'],
    'f': ['--file'],
    'k': ['--key'],
    'p': ['--port'],
    'h': ['--help'],
    'u': ['--ufds']
};



///--- Helpers

function usage(code, message) {
    var _opts = '';
    Object.keys(shortOpts).forEach(function (k) {
        var longOpt = shortOpts[k][0].replace('--', '');
        var type = opts[longOpt].name || 'string';
        if (type && type === 'boolean') type = '';
        type = type.toLowerCase();

        _opts += ' [--' + longOpt + ' ' + type + ']';
    });
    _opts += ' dn attribute value(s)';

    var msg = (message ? message + '\n' : '') +
        'usage: ' + path.basename(process.argv[1]) + _opts;

    process.stderr.write(msg + '\n');
    process.exit(code);
}



///--- CAPI shim

function CAPI(config) {

    var log = new Logger({
        name: 'capi',
        level: config.logLevel,
        stream: process.stdout,
        serializers: restify.bunyan.serializers
    });

    var client;

    function before(req, res, next) {
        req.ldap = client;

        res.sendError = function sendError(errors) {
            if (req.xml) {
                errors = { errors: { error: errors } };
            } else {
                errors = { errors: errors };
            }
            log.warn({errors: errors}, 'These are the errors');
            res.send(409, errors);
        };

        return next();
    }

    var server = restify.createServer({
        name: 'capi',
        log: log
    });

    server.use(restify.acceptParser(server.acceptable));
    server.use(restify.dateParser());
    server.use(restify.queryParser());
    server.use(restify.bodyParser());
    server.use(restify.fullResponse());

    server.on('after', restify.auditLogger({log: log}));

    server.use(before);

    // Show
    server.get('/customers', customers.list);
    server.head('/customers', customers.list);

    // CreateCustomer
    server.post('/customers', customers.create);

    // UpdateCustomer
    server.put('/customers/:uuid', before, utils.loadCustomer,
            customers.update, utils.loadCustomer,
            function respond(req, res, next) {
                var customer = utils.translateCustomer(
                    req.customer.toObject());
                res.send(200, customer);
                return next();
            });

    // GetCustomer
    server.get('/customers/:uuid', utils.loadCustomer, customers.get);
    server.head('/customers/:uuid', utils.loadCustomer, customers.get);

    // DeleteCustomer
    server.del('/customers/:uuid', utils.loadCustomer, customers.del);

    // GetSalt
    server.get('/login/:login', login.getSalt);
    server.head('/login/:login', login.getSalt);

    // Login
    server.post('/login', login.login);

    // ForgotPassword
    server.post('/auth/forgot_password', login.forgotPassword);

    server.use(utils.loadCustomer);

    /// Metadata
    server.get('/auth/customers/:uuid/metadata/:appkey', metadata.list);
    server.put('/auth/customers/:uuid/metadata/:appkey/:key', metadata.put);
    server.get('/auth/customers/:uuid/metadata/:appkey/:key', metadata.get);
    server.del('/auth/customers/:uuid/metadata/:appkey/:key', metadata.del);

    /// Keys
    server.post('/customers/:uuid/keys', keys.post);
    server.get('/customers/:uuid/keys', keys.list);
    server.get('/customers/:uuid/keys/:id', keys.get);
    server.put('/customers/:uuid/keys/:id', keys.put);
    server.del('/customers/:uuid/keys/:id', keys.del);

    /// Smartlogin

    server.post('/customers/:uuid/ssh_sessions', keys.smartlogin);

    /// Limits

    server.get('/customers/:uuid/limits', limits.list);
    server.put('/customers/:uuid/limits/:dc/:dataset', limits.put);
    server.del('/customers/:uuid/limits/:dc/:dataset', limits.del);


    // FIXME: Replace with proper backoff
    // hack to get backoff+retry
    var _attempt = 0;
    var _sleep = 1000;
    var _try = 10;

    function initError(err) {
        if (err) {
            process.stderr.write('Unable to bind to UFDS: ');
            process.stderr.write(err.stack);
            process.stderr.write('\n');
            if (++_attempt <= _try) {
                setTimeout(connect, _sleep);
            } else {
                process.stderr.write('Giving up trying to connect to UFDS\n');
                process.exit(1);
            }
        }
    }


    ///-- Start up

    function connect() {
        client = ldap.createClient({
            url: config.ufds,
            log: log
        });
        client.on('error', initError);
        client.on('connect', function () {
            client.bind(config.rootDN, config.rootPassword, function (err) {
                client.removeListener('error', initError);
                if (err) {
                    console.error('Unable to bind to UFDS: ' + err.stack);
                    process.exit(1);
                }
                server.listen(config.port, function () {
                    console.error('CAPI listening on port %d', config.port);
                });
            });
        });
    }


    return {
        server: server,
        client: client,
        log: log,
        connect: connect
    };
}


function processConfig() {

    var _config;
    var parsed = nopt(opts, shortOpts, process.argv, 2);
    var file = parsed.file || __dirname + '/etc/ufds.config.json';

    if (parsed.help) {
        usage(0);
    }

    try {

        _config = JSON.parse(fs.readFileSync(file, 'utf8'));

    } catch (e) {
        console.error('Unable to parse configuration file: ' + e.message);
        process.exit(1);
    }

    if (!_config.ufds) {
        _config.ufds = 'ldaps://127.0.0.1';
        if (_config.port) {
            _config.ufds += ':' + parsed.port;
        }
    }

    if (parsed.debug) {
        _config.logLevel = 'debug';
    }

    if (!_config.logLevel) {
        _config.logLevel = 'info';
    }

    // We need to override config.port here, b/c the port in config is for LDAP
    _config.port = (process.env.PORT) ? process.env.PORT : 8080;

    return _config;
}

var cfg = processConfig();

var capi = CAPI(cfg);

capi.connect();

// Increase/decrease loggers levels using SIGUSR2/SIGUSR1:
var sigyan = require('sigyan');
sigyan.add([capi.log]);
