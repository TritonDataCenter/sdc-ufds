// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

var ldap = require('ldapjs');
var log4js = require('log4js');
var nopt = require('nopt');
var ldapRiak = require('ldapjs-riak');

var salt = require('./lib/salt');
var schema = require('./lib/schema');



///--- Globals

var log = log4js.getLogger('main');
var config = null;
var server = null;

var opts = {
  'debug': Number,
  'file': String,
  'port': Number,
  'help': Boolean
};

var shortOpts = {
  'd': ['--debug'],
  'f': ['--file'],
  'p': ['--port'],
  'h': ['--help']
};



///--- Helpers

function usage(code) {
  var msg = 'usage: ' + path.basename(process.argv[1]) +
    ' [-hd] [-p port] [-f config_file]';

  if (code === 0) {
    console.log(msg);
  } else {
    console.error(msg);
  }

  process.exit(code);
}


function processConfig() {
  var parsed = nopt(opts, shortOpts, process.argv, 2);

  if (parsed.help)
    usage(0);

  try {
    var file = parsed.file || './cfg/config.json';

    config = JSON.parse(fs.readFileSync(file, 'utf8'));
    config.log4js = log4js;

    if (config.logLevel)
      log4js.setGlobalLogLevel(config.logLevel);

    if (!config.port)
      config.port = 389;

  } catch (e) {
    console.error('Unable to parse config file: ' + e.message);
    process.exit(1);
  }

  if (parsed.port)
    config.port = parsed.port;

  if (parsed.debug) {
    if (parsed.debug > 1) {
      log4js.setGlobalLogLevel('TRACE');
    } else {
      log4js.setGlobalLogLevel('DEBUG');
    }
  }
}


function audit(req, res, next) {
  var out = process.stderr;

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

  function ISODateString(d){
    if (!d)
      d = new Date();

    function pad(n) {
      return n <10 ? '0' + n : n;
    }
    return d.getUTCFullYear() + '-'
      + pad(d.getUTCMonth() + 1) + '-'
      + pad(d.getUTCDate()) + 'T'
      + pad(d.getUTCHours()) + ':'
      + pad(d.getUTCMinutes()) + ':'
      + pad(d.getUTCSeconds()) + 'Z';
  }

  var now = new Date();
  out.write(ISODateString(now) + ' ' +
            'clientip=' + req.connection.remoteAddress + ', ' +
            'bindDN=' + req.connection.ldap.bindDN.toString() + ', ' +
            'msgid=' + req.id + ', ' +
            'request=' + req.type + ', ' +
            'requestDN=' + req.dn.toString() + ', ' +
            additional +
            'status=' + res.status + ', ' +
            'time=' + (now.getTime() - req.startTime) + 'ms, ' +
            '\n'
           );
}


///--- Mainline

processConfig();

log.debug('config processed: %j', config);

server = ldap.createServer(config);
server.after(audit);

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


schema.loadDirectory(config.schemaDirectory, function(err, _schema) {
  if (err) {
    log.warn('Error loading schema: ' + err.stack);
    process.exit(1);
  }

  function addSchema(req, res, next) {
    if (req.toObject)
      req.object = req.toObject();

    req.schema = _schema;
    return next();
  }

  function authorize(req, res, next) {
    var bindDN = req.connection.ldap.bindDN;

    if (req.type === 'BindRequest' ||
        bindDN.equals(config.rootDN) ||
        bindDN.parentOf(req.dn) ||
        bindDN.equals(req.dn)) {
      return next();
    }

    return next(new ldap.InsufficientAccessRightsError());
  }

  var pre = [authorize, addSchema];

  Object.keys(config.trees).forEach(function(t) {
    var tree = config.trees[t];
    if (typeof(tree.riak) !== 'object') {
      log.warn('Tree type %s is an invalid type. Ignoring %s', tree.type, t);
      return;
    }

    tree.riak.log4js = log4js;
    var backend = ldapRiak.createBackend(tree.riak);

    server.add(t, backend, pre, schema.validateAdd, backend.add(salt.add));
    server.bind(t, backend, pre, backend.bind(salt.bind));
    server.compare(t, backend, pre, backend.compare(salt.compare));
    server.modify(t, backend, pre, backend.modify([
      schema.validateModify,
      salt.modify]));
    server.del(t, backend, pre, backend.del());
    server.modifyDN(t, backend, pre, backend.modifyDN());
    server.search(t, backend, pre, backend.search(salt.search));
  });

  server.listen(config.port, config.host, function() {
    log.info('UFDS listening at: %s\n\n', server.url);
  });
});





