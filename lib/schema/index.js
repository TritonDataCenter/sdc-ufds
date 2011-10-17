// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var fs = require('fs');

var ldap = require('ldapjs');
var log4js = require('log4js');



///--- Globals

var log = log4js.getLogger('schema');


///--- Helpers

function runValidations(req, entry, next) {
  assert.ok(req);
  assert.ok(entry);

  var attributes = entry.attributes;
  var finished = 0;
  var done = false;

  if (!attributes.objectclass)
    return next(new ldap.ObjectclassViolationError('no objectclass'));

  function callback(err) {
    if (err && !done) {
      done = true;
      return next(err);
    }

    if (++finished === attributes.objectclass.length && !done) {
      done = true;
      log.debug('%s successfully validated %s', req.logId, req.dn.toString());
      return next();
    }
  }

  for (var i = 0; i < attributes.objectclass.length; i++) {
    var oc = attributes.objectclass[i].toLowerCase();

    if (!req.schema[oc] && !done) {
      done = true;
      var msg = oc + ' not a known objectclass';
      return next(new ldap.UndefinedAttributeTypeError(msg));
    }

    req.schema[oc]._validate(entry, callback);
  }
}



///--- Exports

module.exports = {

  load: function(directory, callback) {
    assert.ok(directory);

    var validators = {};
    return fs.readdir(directory, function(err, files) {
      if (err)
        return callback(err);

      files.forEach(function(f) {
        if (!/\.js$/.test(f))
          return;


        log.info('Loading schema validator: %s/%s', directory, f);
        try {
          var file = directory + '/' + f.replace(/\.js$/, '');
          var v = require(file).createInstance();
          validators[v.name] = v;
        } catch (e) {
          return callback(e);
        }
      });

      return callback(null, validators);
    });
  },


  add: function(req, res, next) {
    assert.ok(req.schema);

    var entry = req.toObject();
    log.debug('%s add: validating %j', req.logId, entry);
    return runValidations(req, entry, next);
  },


  modify: function(req, res, next) {
    assert.ok(req.entry);
    assert.ok(req.schema);

    log.debug('%s modify: validating %j', req.logId, req.entry);
    var attributes = req.entry.attributes;

    req.changes.forEach(function(c) {
      var attr = c.modification;
      switch (c.operation) {
      case 'add':
        if (!attributes[attr.type])
          attributes[attr.type] = [];

        attr.vals.forEach(function(v) {
          if (attributes[attr.type].indexOf(v) === -1)
            attributes[attr.type].push(v);
        });
        break;
      case 'replace':
        attributes[attr.type] = attr.vals;
        break;
      case 'delete':
        if (attributes[attr.type])
          delete attributes[attr.type];
        break;
      }
    });

    // Mock up the entry for now, as we don't want to mess with whatever the
    // riak backend is going to do later
    return runValidations(req, { dn: req.dn, attributes: attributes }, next);
  }

};
