// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');

var JSV = require('JSV').JSV;
var ldap = require('ldapjs');
var log4js = require('log4js');



///--- Globals

var env = JSV.createEnvironment('json-schema-draft-03');
env.setOption('strict', true);

var log = log4js.getLogger('schema');



///--- Helpers

// Thanks internet!
// http://stackoverflow.com/questions/171251/how-can-i-merge-properties-of-two-javascript-objects-dynamically
if (!Object.prototype.merge) {
  Object.defineProperty(Object.prototype, 'merge', {
    enumerable: false,
    value: function () {
      var override = true;
      var dest = this;
      var len = arguments.length;
      var props, merge, i, from;

      if (typeof(arguments[arguments.length - 1]) === 'boolean') {
        override = arguments[arguments.length - 1];
        len = arguments.length - 1;
      }

      for (i = 0; i < len; i++) {
        from = arguments[i];
        Object.getOwnPropertyNames(from).forEach(function (name) {
          var descriptor;

          // nesting
          if ((typeof(dest[name]) === 'object' || typeof(dest[name]) === 'undefined')
              && typeof(from[name]) === 'object') {

            // ensure proper types (Array rsp Object)
            if (typeof(dest[name]) === 'undefined') {
              dest[name] = Array.isArray(from[name]) ? [] : {};
            }
            if (override) {
              if (!Array.isArray(dest[name]) && Array.isArray(from[name])) {
                dest[name] = [];
              }
              else if (Array.isArray(dest[name]) && !Array.isArray(from[name])) {
                dest[name] = {};
              }
            }
            dest[name].merge(from[name], override);
          }

          // flat properties
          else if ((name in dest && override) || !(name in dest)) {
            descriptor = Object.getOwnPropertyDescriptor(from, name);
            if (descriptor.configurable) {
              Object.defineProperty(dest, name, descriptor);
            }
          }
        });
      }
      return this;
    }
  });
}



///--- API

module.exports = {

  add: function validateAdd(req, res, next) {
    assert.ok(req.schema);

    var schema = {};
    var object = req.toObject();
    var attrs = object.attributes;
    if (!attrs.objectclass)
      return next(new ldap.ObjectclassViolationError('no objectclass'));

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
      log.debug('%s schema validation error: %j', req.logId, report.errors);

      var msg = JSON.stringify(report.errors);
      return next(new ldap.ObjectclassViolationError(msg));
    }

    return next();
  },


  modify: function validateModify(req, res, next) {
    req.riak.db.get(req.riak.bucket, req.riak.key, function(err, obj, meta) {
      if (err) {
        if (err.statusCode === 404)
          return next(new ldap.NoSuchObjectError(req.dn.toString()));

        req.riak.log.warn('%s error talking to riak %s', req.logId, err.stack);
        return next(new ldap.OperationsError(err.message));
      }
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
  }

};
