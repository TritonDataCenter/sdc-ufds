// Copyright 2012 Joyent, Inc.  All rights reserved.

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

var client;
var log;
var server;

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


function before(req, res, next) {
    req.ldap = client;

    res.sendError = function sendError(errors) {
        if (req.xml) {
            errors = { errors: { error: errors } };
        } else {
            errors = { errors: errors };
        }
        res.send(409, errors);
    };

    return next();
}


///--- Mainline

var parsed = nopt(opts, shortOpts, process.argv, 2);
if (parsed.help)
    usage(0);

if (process.env.PORT)
    parsed.port = process.env.PORT;

if (!parsed.port)
    parsed.port = 8080;


///--- CAPI shim

log = new Logger({
    name: 'capi',
    streams: [
        {
            level: (parsed.debug ? 'debug' : 'info'),
            stream: process.stdout
        }
    ]
});

server = restify.createServer({
    name: 'capi',
    log: log
});

server.use(restify.acceptParser(server.acceptable));
server.use(restify.dateParser());
server.use(restify.queryParser());
server.use(restify.bodyParser());

server.on('after', restify.auditLogger({
    body: true,
    log: new Logger({
        name: 'audit',
        streams: [
            {
                level: 'info',
                stream: process.stdout
            }
        ]
    })
}));

server.use(before);

// Show
server.get('/customers', customers.list);
server.head('/customers', customers.list);

// CreateCustomer
server.post('/customers', customers.create);

// UpdateCustomer
server.put('/customers/:uuid',
           before,
           utils.loadCustomer,
           customers.update,
           utils.loadCustomer,
           function respond(req, res, next) {
               var customer = utils.translateCustomer(req.customer.toObject());
               res.send(200, customer);
               return next();
           });

// GetCustomer
server.get('/customers/:uuid', utils.loadCustomer, customers.get);
server.head('/customers/:uuid', utils.loadCustomer, customers.get);

// DeleteCustomer
server.del('/customers/:uuid', customers.del);

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



///-- Start up

function initError(err) {
    process.stderr.write('Unable to bind to UFDS: ');
    process.stderr.write(err.stack);
    process.stderr.write('\n');
    process.exit(1);
}



try {
    if (!parsed.file)
        parsed.file = './etc/ufds.config.json';
    if (!parsed.ufds)
        parsed.ufds = 'ldaps://localhost:636';

    var config = JSON.parse(fs.readFileSync(parsed.file, 'utf8'));


    client = ldap.createClient({
        url: parsed.ufds,
        log: log
    });
    client.once('error', initError);
    client.on('connect', function () {
        client.bind(config.rootDN, config.rootPassword, function (err) {
            if (err) {
                console.error('Unable to bind to UFDS: ' + err.stack);
                process.exit(1);
            }

            server.listen(parsed.port, function () {
                client.removeListener('error', initError);
                console.error('CAPI listening on port %d', parsed.port);
            });
        });
    });
} catch (e) {
    console.error(e.stack);
    process.exit(1);
}
