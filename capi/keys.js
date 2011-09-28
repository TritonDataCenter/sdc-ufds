// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');

var httpSignature = require('http-signature');
var ldap = require('ldapjs');
var restify = require('restify');
var sprintf = require('sprintf').sprintf;
var uuid = require('node-uuid');

var util = require('./util');



///--- Globals

var KEY_DN = 'fingerprint=%s, %s';

var HIDDEN = [new ldap.Control({
  type: 'hidden',
  criticality: true
})];

var Change = ldap.Change;
var fingerprint = httpSignature.sshKeyFingerprint;
var log = restify.log;



///--- Helpers

function idToFingerprint(id) {
  var fp = '';
  for (var i = 0; i < id.length; i++) {
    if (i && i % 2 === 0)
      fp += ':';
    fp += id[i];
  }

  return fp;
}


function fingerprintToId(fingerprint) {
  return fingerprint.replace(/:/g, '');
}


function translateKey(key, uuid) {
  assert.ok(key);

  return {
    id: fingerprintToId(key.fingerprint),
    customer_id: uuid,
    customer_uuid: uuid,
    name: key.name,
    body: key.openssh,
    fingerprint: key.fingerprint,
    standard: key.pkcs,
    created_at: key._ctime,
    updated_at: key._mtime
  };
}


function loadKeys(req, callback) {
  var dn = req.customer.dn.toString();
  var opts = {
    scope: 'one',
    filter: '(objectclass=sdckey)'
  };
  req.ldap.search(dn, opts, HIDDEN, function(err, _res) {
    if (err) {
      if (err instanceof ldap.NoSuchObjectError)
        return callback(new restify.ResourceNotFoundError(req.uriParams.uuid));

      return callback(new restify.InternalError(err.toString()));
    }

    var entries = [];
    var done = false;
    _res.on('error', function(err) {
      if (done)
        return;
      done = true;
      if (err instanceof ldap.NoSuchObjectError)
        return callback(new restify.ResourceNotFoundError(req.url));

      return callback(new restify.InternalError(err.toString()));
    });
    _res.on('searchEntry', function(_entry) {
      entries.push(translateKey(_entry.toObject(), req.uriParams.uuid));
    });
    _res.on('end', function(result) {
      if (done)
        return;
      done = true;

      return callback(null, entries);
    });
  });
}


function loadKey(req, callback) {
  return loadKeys(req, function(err, keys) {
    if (err)
      return callback(err);

    var key;
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].id === req.uriParams.id) {
        key = keys[i];
        break;
      }
    }

    if (!key)
      return callback(new restify.ResourceNotFoundError(req.uriParams.id));


    return callback(null, key);
  });
}



///--- API

module.exports = {


  // curl -is --data-urlencode key@/tmp/id_rsa.pub -d name=foo \
  // http://localhost:8080/customers/39ccebc2-816c-4d2b-921c-79aed3474db8/keys
  post: function(req, res, next) {
    assert.ok(req.ldap);

    log.debug('CreateKey(%s) entered: %o', req.uriParams.uuid, req.params);

    if (!req.params.name)
      return next(new restify.MissingParameterError(400, 'name is required'));
    if (!req.params.key)
      return next(new restify.MissingParameterError(400, 'key is required'));


    var fp = fingerprint(req.params.key);
    var dn = sprintf(KEY_DN, fp, req.customer.dn.toString());
    var entry = {
      name: [req.params.name],
      openssh: [req.params.key],
      fingerprint: [fp],
      objectclass: ['sdckey'],

    };
    return req.ldap.add(dn, entry, function(err) {
      if (err) {
        if (err instanceof ldap.EntryAlreadyExistsError) {
          return next(new restify.InvalidArgumentError(req.params.name +
                                                       ' already exists'));
        } else if (err instanceof ldap.ConstraintViolationError) {
          return next(new restify.InvalidArgumentError('ssh key is in use'));
        } else if (err instanceof ldap.NoSuchObjectError) {
          return next(new restify.ResourceNotFoundError(req.uriParams.uuid));
        }
        return next(new restify.InternalError(err.message));
      }

      // Need to reload so we can get all the generated params
      req.uriParams.id = fingerprintToId(fp);
      return loadKey(req, function(err, key) {
        if (err)
          return next(err);

        if (req.xml)
          key = { key: key };

        log.debug('CreateKey(%s) -> %o', req.uriParams.uuid, key);
        res.send(201, key);
        return next();
      });
    });
  },


  list: function(req, res, next) {
    assert.ok(req.ldap);

    log.debug('ListKeys(%s) entered', req.uriParams.uuid);

    return loadKeys(req, function(err, keys) {
      if (err)
        return next(err);

      if (req.xml)
        keys = { keys: { key: keys } };

      log.debug('ListKeys(%s) -> %o', req.uriParams.uuid, keys);
      res.send(200, keys);
      return next();
    });
  },


  get: function(req, res, next) {
    assert.ok(req.ldap);

    log.debug('GetKey(%s/%s) entered', req.uriParams.uuid, req.uriParams.id);

    return loadKey(req, function(err, key) {
      if (err)
        return next(err);

      if (req.xml)
        key = { key: key };

      log.debug('GetKey(%s/%s) -> %o',
                req.uriParams.uuid, req.uriParams.id, key);
      res.send(200, key);
      return next();
    });
  },


  put: function(req, res, next) {
    assert.ok(req.ldap);

    log.debug('PutKey(%s/%s) entered %o', req.uriParams.uuid, req.uriParams.id,
              req.params);

    return loadKey(req, function(err, key) {
      if (err)
        return next(err);

      function done() {
        log.debug('PutKey(%s/%s) ok', req.uriParams.uuid, req.uriParams.id);
        res.send(200);
        return next();
      }

      function modName() {
        var change = new Change({
          type: 'replace',
          modification: {
            name: [req.params.name]
          }
        });

        return req.ldap.modify(dn, change, function(err) {
          if (err)
            return next(new restify.InternalError(err.toString()));

          return done();
        });
      }


      var dn = sprintf(KEY_DN, key.fingerprint, req.customer.dn.toString());
      if (req.params.key) {
        log.debug('PutKey(%s/%s) rename', req.uriParams.uuid, req.uriParams.id);

        var _fp = fingerprint(req.params.key);
        var dn2 = sprintf(KEY_DN, _fp, req.customer.dn.toString());
        return req.ldap.modifyDN(dn, dn2, function(err) {
          if (err)
            return next(new restify.InternalError(err.message));

          if (req.params.name)
            return modName();

          return done();
        });
      }

      if (req.params.name)
        return modName();

      return done();
    });
  },


  del: function(req, res, next) {
    assert.ok(req.ldap);

    log.debug('DeleteKey(%s/%s) entered', req.uriParams.uuid, req.uriParams.id);

    return loadKey(req, function(err, key) {
      if (err)
        return next(err);


      var dn = sprintf(KEY_DN, key.fingerprint, req.customer.dn.toString());
      return req.ldap.del(dn, function(err) {
        if (err)
          return next(new restify.InternalError(err.message));

        log.debug('DeleteKey(%s/%s) ok', req.uriParams.uuid, req.uriParams.id);
        res.send(200);
        return next();
      });
    });
  },

  smartlogin: function(req, res, next) {
    assert.ok(req.customer);
    assert.ok(req.ldap);

    log.debug('SmartLogin(%s/%s) entered',
              req.uriParams.uuid, req.uriParams.fp);

    return loadKeys(req, function(err, keys) {
      if (err)
        return next(new restify.InternalError(err.message));

      var k = false;
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].fingerprint === req.params.fingerprint) {
          k = keys[i];
          break;
        }
      }

      if (!k)
        return next(new restify.InvalidArgumentError('Invalid SSH Key'));

      res.send(201);
      return next();
    });
  }

};
