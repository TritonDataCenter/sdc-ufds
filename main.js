// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

var ldap = require('ldapjs');
var log4js = require('log4js');
var nopt = require('nopt');
var ldapRiak = require('ldapjs-riak');
var rbytes = require('rbytes');



///--- Globals

var SALT_LEN = 20;

var log = log4js.getLogger('ufds');
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

  // Load the config file first, and treat cmd-line switches as
  // overrides
  try {
    var file = parsed.file || './cfg/config.json';

    config = JSON.parse(fs.readFileSync(file, 'utf8'));

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

function saltPassword(salt, password) {
  var hash = crypto.createHash('sha1');
  hash.update('--');
  hash.update(salt);
  hash.update('--');
  hash.update(password);
  hash.update('--');
  return hash.digest('hex')
}


function loadSalt(req, callback) {
  req.riak.db.get(req.riak.bucket, req.riak.key, function(err, obj, meta) {
    if (err) {
      if (err.statusCode === 404)
        return callback(new ldap.NoSuchObjectError(req.dn.toString()));

      req.riak.log.warn('%s error talking to riak %s', req.logId, err.stack);
      return callback(new ldap.OperationsError(err.message));
    }
    obj = obj.attributes || {};

    if (!obj._salt)
      return callback(new ldap.NoSuchAttributeError('salt'));

    return callback(null, obj._salt[0]);
  })
}


function addSalt(req, res, next) {
  var entry = req.toObject().attributes;
  if (!entry.userpassword || !entry.userpassword.length)
    return next();

  var salt = '';
  var buf = rbytes.randomBytes(SALT_LEN); // CAPI's SALT length
  for (i = 0; i < buf.length; i++)
    salt += buf[i].toString(16); // hex encode

  // attrs are sorted on the wire, so userPassword will be closer to tail
  req.addAttribute(new ldap.Attribute({
    type: '_salt',
    vals: [salt]
  }));

  for (i = req.attributes.length - 1; i >= 0; i--) {
    if (req.attributes[i].type === 'userpassword') {
      req.attributes[i].vals = [saltPassword(salt, entry.userpassword[0])];
      return next();
    }
  }
}


function bindSalt(req, res, next) {
  return loadSalt(req, function(err, salt) {
    if (err)
      return next(err);

    req.credentials = saltPassword(salt, req.credentials);
    return next();
  });
}


function compareSalt(req, res, next) {
  if (req.attribute !== 'userpassword')
    return next();

  return loadSalt(req, function(err, salt) {
    if (err)
      return next(err);

    req.value = saltPassword(salt, req.value);
    return next();
  });
}


function searchSalt(req, res, next) {
  res.notAttributes.push('userpassword');
  return next();
}



///--- Mainline

processConfig();
config.log4js = log4js;

log.debug('config processed: %j', config);

server = ldap.createServer(config);

server.bind(config.rootDN, function(req, res, next) {
  if (req.version !== 3)
    return next(new ldap.ProtocolError(req.version + ' is not v3'));

  if (req.credentials !== config.rootPassword)
    return next(new ldap.InvalidCredentialsError(req.dn.toString()));

  res.end();
  return next();
});

// server.exop('1.3.6.1.4.1.4203.1.11.3', function(req, res, next) {
//   res.responseValue = 'u:xxyyz@EXAMPLE.NET';
//   res.end(0);
//   return next();
// });

ldap.loadSchema(config.schemaLocation, function(err, schema) {
  if (err) {
    console.error('Unabled to load schema: %s', err.stack);
    process.exit(1);
  }

  Object.keys(config.trees).forEach(function(t) {
    var tree = config.trees[t];
    if (tree.type === 'riak') {
      tree.riak.log4js = log4js;
      var backend = ldapRiak.createBackend(tree.riak);
      server.add(t,
                 backend,
                 ldap.createSchemaAddHandler({
                   log4js: log4js,
                   schema: schema
                 }),
                 backend.add(addSalt));
      server.modify(t,
                    backend,
                    ldap.createSchemaModifyHandler({
                      log4js: log4js,
                      schema: schema
                    }),
                    backend.modify());


      server.bind(t, backend, backend.bind(bindSalt));
      server.compare(t, backend, backend.compare(compareSalt));
      server.del(t, backend, backend.del());

      server.modifyDN(t, backend, backend.modifyDN());
      server.search(t,
                    backend,
                    ldap.createSchemaSearchHandler({
                      log4js: log4js,
                      schema: schema
                    }),
                    backend.search(searchSalt));
    }
  });

  server.listen(config.port, config.host, function() {
    log.info('UFDS listening at: %s', server.url);
  });
});

