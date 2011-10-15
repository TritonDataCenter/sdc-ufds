// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var fs = require('fs');

var ldap = require('ldapjs');
var log4js = require('log4js');



///--- Globals

var log = log4js.getLogger('schema');



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
          var file = '../../' + directory + '/' + f.replace(/\.js$/, '');
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
    var validators = [];
    var entry = req.toObject();
    var attrs = entry.attributes;

    log.debug('%s add: validating %j', req.logId, entry);

    if (!attrs.objectclass)
      return next(new ldap.ObjectclassViolationError('no objectclass'));

    var finished = 0;
    var done = false;
    function callback(err) {
      if (err && !done) {
        done = true;
        return next(err);
      }

      if (++finished === attrs.objectclass.length && !done) {
        done = true;
        log.debug('%s add successfully validated %s',
                  req.logId, req.dn.toString());
        return next();
      }
    }

    for (var i = 0; i < attrs.objectclass.length; i++) {
      var oc = attrs.objectclass[i].toLowerCase();

      if (!req.schema[oc] && !done) {
        done = true;
        return next(new ldap.UndefinedAttributeTypeError(oc + ' not a known objectclass'));
      }

      req.schema[oc]._add(entry, callback);
    }
  },

  modify: function(req, res, next) {
    /*
    req.riak.client.get(req.riak.bucket, req.riak.key, function(err, obj) {
      if (err) {
        if (err.statusCode === 404)
          return next(new ldap.NoSuchObjectError(req.dn.toString()));

        req.riak.log.warn('%s error talking to riak %s', req.logId, err.stack);
        return next(new ldap.OperationsError(err.message));
      }

      req.riak.entry = obj; // store this so we don't go refetch it.

      attrs = obj.attributes || {};

      if (!attrs.objectclass)
        return next(new ldap.ObjectclassViolationError('no objectclass'));

      req.changes.forEach(function(c) {
        var attr = c.modification;
        switch (c.operation) {
        case 'add':
          if (!attrs[attr.type])
            attrs[attr.type] = [];

          attr.vals.forEach(function(v) {
            if (attrs[attr.type].indexOf(v) === -1)
              attrs[attr.type].push(v);
          });
          break;
        case 'replace':
          attrs[attr.type] = attr.vals;
          break;
        case 'delete':
          if (attrs[attr.type])
            delete attrs[attr.type];
          break;
        }
      });

      var schema = {};
      for (var i = 0; i < attrs.objectclass.length; i++) {
        var oc = attrs.objectclass[i].toLowerCase();

        if (!req.schema[oc])
          return next(new ldap.UndefinedAttributeTypeError(oc));

        schema.merge(req.schema[oc]);
      }

      if (log.isDebugEnabled())
        log.debug('%s validating %j against %j', req.logId, attrs, schema);
      var report = env.validate(attrs, schema);
      if (report.errors.length !== 0) {
        var err = report.errors[0];
        log.debug('%s schema validation error: %j', req.logId, err);
        return next(new ldap.ObjectclassViolationError(err.message));
      }

      return next();
    });
    */
    return next();
  }

};
