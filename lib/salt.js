// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var crypto = require('crypto');

var ldap = require('ldapjs');
var rbytes = require('rbytes');



///--- Globals

var SALT_LEN = 20;



///--- API

function saltPassword(salt, password) {
  var hash = crypto.createHash('sha1');
  hash.update('--');
  hash.update(salt);
  hash.update('--');
  hash.update(password);
  hash.update('--');
  return hash.digest('hex');
}


function loadSalt(req, callback) {
  req.riak.client.get(req.riak.bucket, req.riak.key, function(err, obj) {
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
  });
}


function add(req, res, next) {
  assert.ok(req.object);

  var entry = req.object.attributes;
  if (!entry.userpassword || !entry.userpassword.length)
    return next();

  var salt = '';
  var buf = rbytes.randomBytes(SALT_LEN); // CAPI's SALT length
  for (i = 0; i < buf.length; i++)
    salt += buf[i].toString(16); // hex encode

  req.addAttribute(new ldap.Attribute({
    type: '_salt',
    vals: [salt]
  }));

  // attrs are sorted on the wire, so userPassword will be closer to tail
  for (i = req.attributes.length - 1; i >= 0; i--) {
    if (req.attributes[i].type === 'userpassword') {
      req.attributes[i] = new ldap.Attribute({
        type: 'userpassword',
        vals: [saltPassword(salt, entry.userpassword[0])]
      });
      break;
    }
  }

  return next();
}


function bind(req, res, next) {
  return loadSalt(req, function(err, salt) {
    if (err)
      return next(err);

    req.credentials = saltPassword(salt, req.credentials);
    return next();
  });
}


function compare(req, res, next) {
  if (req.attribute !== 'userpassword')
    return next();

  return loadSalt(req, function(err, salt) {
    if (err)
      return next(err);

    req.value = saltPassword(salt, req.value);
    return next();
  });
}


function modify(req, res, next) {
  var toSalt = false;

  // attrs are sorted on the wire, so userPassword will be closer to tail
  for (var i = req.changes.length - 1; i >= 0; i--) {
    var c = req.changes[i];
    if (c.operation !== 'delete' && c.modification.type === 'userpassword') {
      toSalt = true;
      break;
    }
  }

  if (!toSalt)
    return next();

  return loadSalt(req, function(err, salt) {
    if (err)
      return next(err);

    req.changes[i].modification = {
      userpassword: saltPassword(salt, req.changes[i]._modification.vals[0])
    };
    return next();
  });
}


function search(req, res, next) {
  if (!req.hidden)
    res.notAttributes.push('userpassword');

  return next();
}



///--- Exports

module.exports = {

  bind: bind,

  add: add,

  compare: compare,

  modify: modify,

  search: search

};
