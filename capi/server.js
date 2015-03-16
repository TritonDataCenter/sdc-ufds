/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var assert = require('assert');
var fs = require('fs');
var http = require('http');
var path = require('path');
var sprintf = require('util').format;

var Logger = require('bunyan');
var UFDS = require('ufds');
var nopt = require('nopt');
var restify = require('restify');
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}
var once = require('once');

var customers = require('./customers');
var keys = require('./keys');
var login = require('./login');
var limits = require('./limits');
var metadata = require('./metadata');
var fraud = require('./fraud');
var utils = require('./util');

// --- Helpers

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

function processConfigFile(file) {
    var config = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!config.ufds) {
        config.ufds = 'ldaps://127.0.0.1:636';
    }
    if (!config.logLevel) {
        config.logLevel = 'info';
    }
    // We need to override config.port here, b/c the port in config is for LDAP
    config.port = 8080;
    return config;
}

///--- CAPI shim

function CAPI(config) {
    var self = this;
    var log = config.log;

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

        if (!self.ufds_client) {
            next(new restify.InternalError('Upstream server down'));
        } else {
            req.ufds = self.ufds_client;
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
    server.get('/fraud', fraud.verifyBlackList, fraud.list);
    server.post('/fraud', fraud.verifyBlackList, fraud.create);
    server.get('/fraud/:email', fraud.verifyBlackList, fraud.search);

    ///-- Start up
    this.server = server;
    this.log = log;
    this.config = config;
}

CAPI.prototype.connect = function connect(cb) {
    var self = this;
    cb = once(cb);

    var ufds = new UFDS({
        url: this.config.ufds,
        bindDN: this.config.rootDN,
        bindPassword: this.config.rootPassword,
        cache: {
            size: 5000,
            expiry: 30
        },
        retry: {
            initialDelay: 1000
        },
        clientTimeout: 120000,
        hidden: true,
        log: this.log,
        failFast: true,
        idleTimeout: 90000
    });
    ufds.once('destroy', function (err) {
        // Give up on life if client exits during setup
        // (such as for bad credentials)
        self.log.fatal(err, 'UFDS abort during setup');
        ufds.close();
        cb(err);
    });

    ufds.once('connect', function () {
        ufds.on('error', function (err) {
            self.log.err(err, 'UFDS error');
        });
        ufds.on('close', function () {
            self.log.info('UFDS disconnected');
        });
        ufds.on('connect', function () {
            self.log.info('UFDS reconnected');
        });
        ufds.removeAllListeners('destroy');
        ufds.on('destroy', function (err) {
            self.log.err(err, 'Aborting on UFDS error');
            self.close();
        });

        self.ufds_client = ufds;
        self.server.listen(self.config.port, function () {
            self.log.info('CAPI listening on port %d', self.config.port);
            cb();
        });
    });
};

CAPI.prototype.close = function close(cb) {
    this.server.close();
    this.ufds_client.close(cb);
};

module.exports = {
    createServer: function createServer(config) {
        return new CAPI(config);
    },
    processConfigFile: processConfigFile
};
