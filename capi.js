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
var metadata = require('./capi/metadata');


///--- Globals

var client;
var log = restify.log;
var server;

var opts = {
  'certificate': String,
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
    ldap.log4js.setLevel('TRACE');
  } else {
    log.level(log.Level.Debug);
    ldap.log4js.setLevel('DEBUG');
  }
}

if (process.env.PORT)
  port = process.env.PORT;

if (!parsed.port)
  parsed.port = 80;



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

// Show
server.get('/customers', [before], customers.list, [log.w3c]);
server.get('/customers.json', [before], customers.list, [log.w3c]);
server.get('/customers.xml', [before], customers.list, [log.w3c]);

// CreateCustomer
server.post('/customers', [before], customers.create, [log.w3c]);

// UpdateCustomer
server.put('/customers/:id', [before], customers.update, [log.w3c]);

// GetCustomer
server.get('/customers/:id', [before], customers.get, [log.w3c]);
server.get('/customers/:id.json', [before], customers.get, [log.w3c]);
server.get('/customers/:id.xml', [before], customers.get, [log.w3c]);

// DeleteCustomer
server.del('/customers/:id', [before], customers.del, [log.w3c]);

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
           [before], metadata.list, [log.w3c]);
server.get('/auth/customers/:uuid/metadata/:appkey.json',
           [before], metadata.list, [log.w3c]);
server.get('/auth/customers/:uuid/metadata/:appkey.xml',
           [before], metadata.list, [log.w3c]);
server.put('/auth/customers/:uuid/metadata/:appkey/:key',
           [before], metadata.put, [log.w3c]);
server.get('/auth/customers/:uuid/metadata/:appkey/:key',
           [before], metadata.get, [log.w3c]);
server.del('/auth/customers/:uuid/metadata/:appkey/:key',
           [before], metadata.del, [log.w3c]);

/// Keys
server.post('/customers/:uuid/keys', [before], keys.post, [log.w3c]);
server.get('/customers/:uuid/keys', [before], keys.list, [log.w3c]);
server.get('/customers/:uuid/keys.json', [before], keys.list, [log.w3c]);
server.get('/customers/:uuid/keys.xml', [before], keys.list, [log.w3c]);
server.get('/customers/:uuid/keys/:id', [before], keys.get, [log.w3c]);
server.get('/customers/:uuid/keys/:id.json', [before], keys.get, [log.w3c]);
server.get('/customers/:uuid/keys/:id.xml', [before], keys.get, [log.w3c]);
server.put('/customers/:uuid/keys/:id', [before], keys.put, [log.w3c]);
server.put('/customers/:uuid/keys/:id.json', [before], keys.put, [log.w3c]);
server.put('/customers/:uuid/keys/:id.xml', [before], keys.put, [log.w3c]);
server.del('/customers/:uuid/keys/:id', [before], keys.del, [log.w3c]);


///-- Start up

client = ldap.createClient({
  url: 'ldap://localhost:1389'
});

client.bind('cn=root', 'secret', function(err) {
  assert.ifError(err);

  server.listen(parsed.port, function() {
    log.info('CAPI listening on port %d', parsed.port);
  });
});
