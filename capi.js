/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * UFDS CAPI main file.
 *
 * CAPI is the backwards compatible HTTP proxy for the UFDS LDAP server.
 * It's used by SmartLogin for SSH'ing smart machines.
 */

var assert = require('assert');
var fs = require('fs');
var http = require('http');
var path = require('path');
var sprintf = require('util').format;

var Logger = require('bunyan');
var SDC = require('sdc-clients');
var nopt = require('nopt');
var restify = require('restify');
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}

var customers = require('./capi/customers');
var keys = require('./capi/keys');
var login = require('./capi/login');
var limits = require('./capi/limits');
var metadata = require('./capi/metadata');
var fraud = require('./capi/fraud');
var utils = require('./capi/util');


function entitify(str) {
    str = '' + str;
    /* BEGIN JSSTYLED */
    str = str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/'/g, '&apos;')
        .replace(/"/g, '&quot;');
    /* END JSSTYLED */
    return str;
}

function toXml(elm) {
    var xml = '';
    if (Array.isArray(elm)) {
        xml += elm.map(function (e) {
            return (toXml(e));
        }).join('\n');
    } else if (typeof (elm) === 'object' && Object.keys(elm)) {
        Object.keys(elm).forEach(function (k) {
            if (elm[k]) {
                xml += sprintf('<%s>%s</%s>', k, toXml(elm[k]), k);
            }
        });
    } else {
        xml += entitify(elm);
    }
    return (xml);
}

///--- Globals

var UFDS_CLIENT;

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



// --- Helpers

function createUfdsClient(options, callback) {
    var ufds = new SDC.UFDS(options);

    ufds.once('connect', function () {
        ufds.removeAllListeners('error');
        ufds.on('error', function (err) {
            options.log.error(err, 'UFDS disconnected');
        });
        ufds.on('connect', function () {
            options.log.info('UFDS reconnected');
        });
        callback(null, ufds);
    });

    ufds.once('error', function (err) {
        // You are screwed. It's likely that the bind credentials were bad.
        // Treat this as fatal and move on:
        options.log.error({err: err}, 'UFDS connection error');
        callback(err);
    });
}


function usage(code, message) {
    var _opts = '';
    Object.keys(shortOpts).forEach(function (k) {
        var longOpt = shortOpts[k][0].replace('--', '');
        var type = opts[longOpt].name || 'string';
        if (type && type === 'boolean') {
            type = '';
        }
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

    var server = restify.createServer({
        name: 'capi',
        log: log,
        formatters: {
            'application/xml': function formatXml(req, res, body) {
                var o;
                var xml = '<?xml version="1.0" encoding="utf-8"?>\n';
                if (body instanceof Error) {
                    o = { errors: { error: body.body } };
                } else if (Buffer.isBuffer(body)) {
                    o = JSON.parse(body.toString('base64'));
                } else {
                    o = body;
                }

                xml += toXml(o);

                res.setHeader('Content-Length', Buffer.byteLength(xml));
                return xml;
            }
        }
    });

    server.use(restify.acceptParser(server.acceptable));
    server.use(restify.dateParser());
    server.use(restify.queryParser());
    server.use(restify.bodyParser());
    server.use(restify.fullResponse());
    server.use(function capiSetup(req, res, next) {
        res.sendError = function sendError(errors) {
            if (req.accepts('application/xml')) {
                errors = { errors: { error: errors } };
            } else {
                errors = { errors: errors };
            }
            log.warn({errors: errors}, 'These are the errors');
            res.send(409, errors);
            return (false);
        };

        if (!UFDS_CLIENT) {
            next(new restify.InternalError('Upstream server down'));
        } else {
            req.ufds = UFDS_CLIENT;
            next();
        }
    });

    server.on('after', restify.auditLogger({log: log}));

    // Show
    server.get('/customers', customers.operators, customers.list);
    server.head('/customers', customers.operators, customers.list);

    // CreateCustomer
    server.post('/customers', customers.create);

    // UpdateCustomer
    server.put('/customers/:uuid', utils.loadCustomer,
               customers.update, utils.loadCustomer,
               function respond(req, res, next) {
                    var customer = utils.translateCustomer(req.customer);
                    res.send(200, customer);
                    next();
               });

    // GetCustomer
    server.get('/customers/:uuid', utils.loadCustomer, customers.get);
    server.head('/customers/:uuid', utils.loadCustomer, customers.get);
    // CustomerForgotPassword
    server.put('/customers/:uuid/forgot_password',
                utils.loadCustomer, customers.forgot_password,
                utils.loadCustomer, function respondForgotPwd(req, res, next) {
                    var customer = utils.translateCustomer(req.customer);
                    res.send(200, customer);
                    next();
               });

    // DeleteCustomer
    server.del('/customers/:uuid', utils.loadCustomer, customers.del);

    // GetSalt
    server.get('/login/:uuid', utils.loadCustomer, login.getSalt);
    server.head('/login/:uuid', utils.loadCustomer, login.getSalt);

    // Login
    server.post('/login', utils.loadCustomer, login.login);

    // ForgotPassword
    server.post('/forgot_password', login.forgotPassword);

    server.use(utils.loadCustomer);

    /// Metadata
    server.get('/customers/:uuid/metadata/:appkey', metadata.list);
    server.put('/customers/:uuid/metadata/:appkey/:key', metadata.put);
    server.get('/customers/:uuid/metadata/:appkey/:key', metadata.get);
    server.del('/customers/:uuid/metadata/:appkey/:key', metadata.del);

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

    /// Fraud
    server.get('/fraud', fraud.loadBlackList, fraud.list);
    server.post('/fraud', fraud.loadBlackList, fraud.create);
    server.get('/fraud/:email', fraud.loadBlackList, fraud.search);

    ///-- Start up

    function connect() {
        createUfdsClient({
            url: config.ufds,
            bindDN: config.rootDN,
            bindPassword: config.rootPassword,
            cache: {
                size: 5000,
                expiry: 30
            },
            maxConnections: 1,
            retry: {
                initialDelay: 1000
            },
            clientTimeout: 120000,
            hidden: true,
            log: log
        }, function (err, ufds) {
            if (err) {
                log.error({err: err}, 'CAPI UFDS connect error');
                process.exit(1);
            }
            UFDS_CLIENT = ufds;

            server.listen(config.port, function () {
                log.info('CAPI listening on port %d', config.port);
            });
        });
    }

    return {
        server: server,
        log: log,
        connect: connect
    };
}


function processConfig() {

    var _config;
    var parsed = nopt(opts, shortOpts, process.argv, 2);
    var file = parsed.file || __dirname + '/etc/config.json';

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
        _config.ufds = 'ldaps://127.0.0.1:1391';
        // if (_config.port) {
        //     _config.ufds += ':' + parsed.port;
        // }
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



///--- Mainline

(function main() {
    var cfg = processConfig();

    var capi = CAPI(cfg);

    capi.connect();
}());
