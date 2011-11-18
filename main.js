// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

var ldap = require('ldapjs');
var log4js = require('log4js');
var nopt = require('nopt');
var ldapRiak = require('ldapjs-riak');
var retry = require('retry');
var nstatic = require('node-static');

var blacklist = require('./lib/blacklist');
var groups = require('./lib/groups');
var keys = require('./lib/keys');
var owner = require('./lib/owner');
var salt = require('./lib/salt');
var schema = require('./lib/schema');



///--- Globals

var CLIENT = null;
var CONFIG = null;

var auditLogger = null;
var log = log4js.getLogger('main');
var groupManager = null;

var opts = {
  'certificate': String,
  'debug': Number,
  'file': String,
  'key': String,
  'lrusize': Number,
  'lruage': Number,
  'port': Number,
  'help': Boolean
};

var shortOpts = {
  'a': ['--lruage'],
  'c': ['--certificate'],
  'd': ['--debug'],
  'f': ['--file'],
  'k': ['--key'],
  'l': ['--lru'],
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

    CONFIG = JSON.parse(fs.readFileSync(file, 'utf8'));

    if (CONFIG.loggers)
      log4js.configure(CONFIG.loggers, {});
    if (CONFIG.logLevel)
      log4js.setGlobalLogLevel(CONFIG.logLevel);

    if (CONFIG.certificate && CONFIG.key && !CONFIG.port)
      CONFIG.port = 636;

    if (!CONFIG.port)
      CONFIG.port = 389;

    if (!CONFIG.lruCacheSize)
      CONFIG.lruCacheSize = 1000;

    if (!CONFIG.lruCacheAge)
      CONFIG.lruCacheAge = 300;

  } catch (e) {
    console.error('Unable to parse configuration file: ' + e.message);
    process.exit(1);
  }

  if (parsed.port)
    CONFIG.port = parsed.port;

  if (parsed.lruage)
    CONFIG.lruCacheAge= parsed.lruage;
  if (parsed.lrusize)
    CONFIG.lruCacheSize = parsed.lrusize;

  if (parsed.debug) {
    if (parsed.debug > 1) {
      log4js.setGlobalLogLevel('TRACE');
    } else {
      log4js.setGlobalLogLevel('DEBUG');
    }
  }

  if (parsed.certificate)
    CONFIG.certificate = parsed.certificate;
  if (parsed.key)
    CONFIG.key = parsed.key;

  if (CONFIG.certificate)
    CONFIG.certificate = fs.readFileSync(CONFIG.certificate, 'utf8');
  if (CONFIG.key)
    CONFIG.key = fs.readFileSync(CONFIG.key, 'utf8');

  log.debug('config processed: %j', CONFIG);
}



function audit(req, res, next) {
  function log() {
    if (!auditLogger) {
      // hack to ensure that this only outputs to the access log, and
      // still use file rolling
      auditLogger = log4js.getLogger('audit');
      auditLogger.setLevel(log4js.levels.TRACE);
    }

    return auditLogger;
  }


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

  log().trace('clientip=' + (req.connection.remoteAddress || 'localhost') +
              ', ' +
              'bindDN=' + req.connection.ldap.bindDN.toString() + ', ' +
              'msgid=' + req.id + ', ' +
              'request=' + req.type + ', ' +
              'requestDN=' + req.dn.toString() + ', ' +
              additional +
              'status=' + res.status + ', ' +
              'time=' + (new Date().getTime() - req.startTime) + 'ms, '
             );
}


function createServer(config, trees) {
  var server = ldap.createServer(config);
  server.after(audit);

  server.bind(CONFIG.rootDN, function(req, res, next) {
    if (req.version !== 3)
      return next(new ldap.ProtocolError(req.version + ' is not v3'));

    if (req.credentials !== CONFIG.rootPassword)
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

    var suffixes = trees.slice();
    suffixes.push('cn=changelog');
    var entry = {
      dn: '',
      attributes: {
        namingcontexts: suffixes,
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

  return server;
}



///--- Mainline

log4js.setGlobalLogLevel('INFO');
processConfig();

schema.load(__dirname + '/schema', function(err, _schema) {
  if (err) {
    log.fatal('Error loading schema: ' + err.stack);
    process.exit(1);
  }

  var trees = Object.keys(CONFIG.trees);
  var servers = [createServer(CONFIG, trees)];
  // Ghetto!
  var cert = CONFIG.certificate;
  var key = CONFIG.key;
  delete CONFIG.certificate;
  delete CONFIG.key;
  servers.push(createServer(CONFIG, trees));
  CONFIG.certificate = cert;
  CONFIG.key = key;

  servers.forEach(function(server) {
    trees.forEach(function(t) {
      var suffix = ldap.parseDN(t);
      var tree = CONFIG.trees[t];
      if (typeof(tree.riak) !== 'object') {
        log.warn('Tree type %s is an invalid type. Ignoring %s', tree.type, t);
        return;
      }

      tree.riak.log4js = log4js;
      var be = ldapRiak.createBackend(tree.riak);
      var timer;

      function _init(callback) {
        var operation = retry.operation({
          retries: 10,
          factor: 2,
          minTimeout: 1000,
          maxTimeout: Number.MAX_VALUE,
          randomize: false
        }); // Bake in the defaults, as they're fairly sane

        operation.attempt(function(currentAttempt) {
          be.init(function(err) {
            if (err) {
              log.warn('Error initializing backend(attempt=%d): %s',
                       currentAttempt, err.toString());
              if (operation.retry(err))
                return;

              return callback(operation.mainError());
            }

            return callback();
          });
        });
      }

      function setup(req, res, next) {
        if (req.toObject)
          req.object = req.toObject();

        if (tree.blacklistRDN)
          req.blacklistEmailDN = tree.blacklistRDN + ', ' + suffix;

        req.schema = _schema;
        req.suffix = suffix;
        req.client = CLIENT;

        // Allows downstream code to easily check group membership
        req.memberOf = function(groupdn, callback) {
          return groupManager.memberOf(req.dn, groupdn, callback);
        };

        req.searchCallback = function(req, entry, callback) {
          return groupManager.searchCallback(req, entry, callback);
        };

        return next();
      }

      function authorize(req, res, next) {
        // Check the easy stuff first
        if (req.type === 'BindRequest')
          return next();

        var bindDN = req.connection.ldap.bindDN;

        if (bindDN.equals(CONFIG.rootDN) || bindDN.equals(req.dn) ||
            bindDN.parentOf(req.dn))
          return next();

        // Otherwise check the backend
        var operators = 'cn=operators, ou=groups, ' + t;
        groupManager.memberOf(bindDN, operators, function(err, member) {
          if (err)
            return next(err);

          return next(member ? null : new ldap.InsufficientAccessRightsError());
        });
      }

      var pre = [setup, authorize];

      server.add(t, be, pre, blacklist.add, salt.add, keys.add, owner.add,
                 schema.add, be.add());
      server.bind(t, be, pre, be.bind(salt.bind));
      server.compare(t, be, pre, be.compare(salt.compare));
      server.del(t, be, pre, be.del());
      server.modifyDN(t, be, pre, owner.modifyDN, be.modifyDN());
      server.search(t, be, pre, owner.search, be.search(salt.search));
      // This doesn't actually work with multiple backends...
      server.search('cn=changelog', be, pre, be.changelogSearch());

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

      // Go ahead and kick off backend initialization
      _init(function(err) {
        if (err) {
          log.fatal('Unable to initialize Riak backend, exiting');
          process.exit(1);
        }

        log.info('Riak backend initialized');
      });
    });
  });

  // Rock 'n Roll
  servers[0].listen(CONFIG.port, function() {
    log.info('UFDS listening at: %s\n\n', servers[0].url);
  });
  servers[1].listen(CONFIG.loopbackPath, function() {
    log.info('UFDS listening at: %s\n\n', servers[1].url);
    CLIENT = ldap.createClient({
      socketPath: CONFIG.loopbackPath,
      log4js: log4js
    });

    CLIENT.once('error', function(err) {
      log.fatal('Error connecting: %s', err.stack);
      process.exit(1);
    });

    CLIENT.bind(CONFIG.rootDN, CONFIG.rootPassword, function(err) {
      if (err) {
        log.fatal('Unable to bind to: %s: %s', CONFIG.loopbackPath, err.stack);
        process.exit(1);
      }

      groupManager = groups.createGroupManager({
        cache: {
          size: CONFIG.lruCacheSize,
          age: CONFIG.lruCacheAge,
        },
        client: CLIENT
      });
    });
  });

});



///--- Serve up docs

var file = new(nstatic.Server)('./docs/pkg');
var docsPort = CONFIG.port < 1024 ? 80 : 9080;
require('http').createServer(function (req, res) {
    req.addListener('end', function () {
        file.serve(req, res);
    });
}).listen(docsPort, function() {
  log.info('Docs listener up at %d', docsPort);
});

