// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

var ldap = require('ldapjs');
var log4js = require('log4js');
var nopt = require('nopt');
var ldapRiak = require('ldapjs-riak');

var keys = require('./lib/keys');
var owner = require('./lib/owner');
var salt = require('./lib/salt');
var schema = require('./lib/schema');



///--- Globals

log4js.setGlobalLogLevel('INFO');

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


schema.load(__dirname + '/schema', function(err, _schema) {
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
        bindDN.equals(req.dn) ||
        bindDN.childOf('ou=operators, o=smartdc')) {
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
    var be = ldapRiak.createBackend(tree.riak);
    be.init(function(err) {
      if (err) {
        process.stderr.write(err.toString() + '\n');
        process.exit(1);
      }
    });

    server.add(t, be, pre, owner.add, keys.add, schema.add, be.add(salt.add));
    server.bind(t, be, pre, be.bind(salt.bind));
    server.compare(t, be, pre, be.compare(salt.compare));
    server.del(t, be, pre, be.del());
    server.modifyDN(t, be, pre, owner.modifyDN, be.modifyDN());
    server.search(t, be, pre, owner.search, be.search(salt.search));

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

    var entry = {
      dn: '',
      attributes: {
        namingcontexts: 'o=smartdc',
        supportedcontrol: ['1.3.6.1.4.1.38678.1'],
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


  // Rock 'n Roll
  server.listen(config.port, function() {
    log.info('UFDS listening at: %s\n\n', server.url);
  });

});
