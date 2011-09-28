// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var fs = require('fs');
var http = require('http');

var ldap = require('ldapjs');
var nopt = require('nopt');
var restify = require('restify');
var sprintf = require('sprintf').sprintf;
var uuid = require('node-uuid');

var customers = require('./capi/customers');
var keys = require('./capi/keys');
var login = require('./capi/login');
var limits = require('./capi/limits');
var metadata = require('./capi/metadata');
var utils = require('./capi/util');



///--- Globals

var client;
var log = restify.log;
var server;

var opts = {
  'certificate': String,
  'config': String,
  'debug': Number,
  'file': String,
  'key': String,
  'port': Number,
  'help': Boolean
};

var shortOpts = {
  'c': ['--certiifcate'],
  'd': ['--debug'],
  'f': ['--file'],
  'k': ['--key'],
  'p': ['--port'],
  'h': ['--help']
};



///--- Helpers

function usage(code, message) {
  var _opts = '';
  Object.keys(shortOpts).forEach(function(k) {
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
  // Some sweet, sweet hacking!
  var accept = req.headers.accept;
  if (!accept || accept.search('application/json') === -1) {
    res._accept = 'application/xml';
    req.xml = true;
  }

  if (/.*\.json$/.test(req.url)) {
    res._accept = 'application/json';
    req.xml = false;
  }

  req.ldap = client;
  return next();
}


///--- Mainline

var parsed = nopt(opts, shortOpts, process.argv, 2);
if (parsed.help)
  usage(0);

if (parsed.debug) {
  if (parsed.debug > 1) {
    log.level(log.Level.Trace);
  } else {
    log.level(log.Level.Debug);
  }
}

if (process.env.PORT)
  port = process.env.PORT;

if (!parsed.port)
  parsed.port = 8080;

try {
  var cfg = fs.readFileSync((parsed.file || './cfg/config.json'), 'utf8');
  config = JSON.parse(cfg);
} catch (e) {
  console.log(e.message);
  process.exit(1);
}

server = restify.createServer({
  serverName: 'CAPI',
  accept: ['application/xml', 'application/json', 'text/plain'],
  fullErrors: (parsed.debug && parsed.debug >= 3),
  cert: parsed.certificate ? fs.readFileSync(parsed.certificate, 'ascii') : null,
  key: parsed.key ? fs.readFileSync(parsed.key, 'ascii') : null,
  formatError: function(res, e) {
    e = { errors: [e.message] };
    if (res._accept === 'application/xml')
      e = { errors: { error: e } };
    return e;
  },
  contentHandlers: {
    'text/plain': function(obj) {
      return {
        body: obj + ''
      };
    }
  },
  contentWriters: {
    'text/plain': function(obj) {
      switch (typeof(obj)) {
      case 'string':
      case 'number':
      case 'boolean':
      case 'null':
        return obj + '';
      case 'object':
      case 'function':
        return JSON.stringify(obj);
      }
    }
  }
});



///--- CAPI shim

var loadBefore = [before, utils.loadCustomer];

// Show
server.get('/customers', [before], customers.list, [log.w3c]);
server.head('/customers', [before], customers.list, [log.w3c]);
server.get('/customers.json', [before], customers.list, [log.w3c]);
server.get('/customers.xml', [before], customers.list, [log.w3c]);

// CreateCustomer
server.post('/customers', [before], customers.create, [log.w3c]);

// UpdateCustomer
server.put('/customers/:uuid',
           loadBefore,
           customers.update,
           utils.loadCustomer,
           function respond(req, res, next) {
             var customer = utils.translateCustomer(req.customer.toObject());
             if (req.xml)
               customer = { customer: customer };
             res.send(200, customer);
             return next();
           },
           [log.w3c]);

// GetCustomer
server.get('/customers/:uuid', loadBefore, customers.get, [log.w3c]);
server.get('/customers/:uuid.json', loadBefore, customers.get, [log.w3c]);
server.get('/customers/:uuid.xml', loadBefore, customers.get, [log.w3c]);

// DeleteCustomer
server.del('/customers/:uuid', [before], customers.del, [log.w3c]);

// GetSalt
server.get('/login/:login', [before], login.getSalt, [log.w3c]);
server.get('/login/:login.json', [before], login.getSalt, [log.w3c]);
server.get('/login/:login.xml', [before], login.getSalt, [log.w3c]);

// Login
server.post('/login', [before], login.login, [log.w3c]);
server.post('/login.json', [before], login.login, [log.w3c]);
server.post('/login.xml', [before], login.login, [log.w3c]);

// ForgotPassword
server.post('/auth/forgot_password', [before], login.forgotPassword, [log.w3c]);

/// Metadata
server.get('/auth/customers/:uuid/metadata/:appkey',
           loadBefore, metadata.list, [log.w3c]);
server.get('/auth/customers/:uuid/metadata/:appkey.json',
           loadBefore, metadata.list, [log.w3c]);
server.get('/auth/customers/:uuid/metadata/:appkey.xml',
           loadBefore, metadata.list, [log.w3c]);
server.put('/auth/customers/:uuid/metadata/:appkey/:key',
           loadBefore, metadata.put, [log.w3c]);
server.get('/auth/customers/:uuid/metadata/:appkey/:key',
           loadBefore, metadata.get, [log.w3c]);
server.del('/auth/customers/:uuid/metadata/:appkey/:key',
           loadBefore, metadata.del, [log.w3c]);

/// Keys
server.post('/customers/:uuid/keys', loadBefore, keys.post, [log.w3c]);
server.get('/customers/:uuid/keys', loadBefore, keys.list, [log.w3c]);
server.get('/customers/:uuid/keys.json', loadBefore, keys.list, [log.w3c]);
server.get('/customers/:uuid/keys.xml', loadBefore, keys.list, [log.w3c]);
server.get('/customers/:uuid/keys/:id', loadBefore, keys.get, [log.w3c]);
server.get('/customers/:uuid/keys/:id.json', loadBefore, keys.get, [log.w3c]);
server.get('/customers/:uuid/keys/:id.xml', loadBefore, keys.get, [log.w3c]);
server.put('/customers/:uuid/keys/:id', loadBefore, keys.put, [log.w3c]);
server.put('/customers/:uuid/keys/:id.json', loadBefore, keys.put, [log.w3c]);
server.put('/customers/:uuid/keys/:id.xml', loadBefore, keys.put, [log.w3c]);
server.del('/customers/:uuid/keys/:id', loadBefore, keys.del, [log.w3c]);

/// Smartlogin

server.post('/customers/:uuid/ssh_sessions',
            loadBefore, keys.smartlogin, [log.w3c]);

/// Limits

server.get('/customers/:uuid/limits', loadBefore, limits.list, [log.w3c]);
server.put('/customers/:uuid/limits/:dc/:dataset',
           loadBefore, limits.put, [log.w3c]);
server.del('/customers/:uuid/limits/:dc/:dataset',
           loadBefore, limits.del, [log.w3c]);




///-- Start up

client = ldap.createClient({
  url: 'ldap://' + config.host + ':' + config.port
});

if (parsed.debug)
  client.log4js.setLevel(((parsed.debug > 1) ? 'TRACE' : 'DEBUG'));

client.bind(config.rootDN, config.rootPassword, function(err) {
  assert.ifError(err);

  server.listen(parsed.port, function() {
    log.info('CAPI listening on port %d', parsed.port);
  });
});
