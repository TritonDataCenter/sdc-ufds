// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');

var ldap = require('ldapjs');
var log4js = require('log4js');



///--- Globals

var log = log4js.getLogger('Validator');



///--- API

function Validator(options) {
  assert.equal(typeof(options), 'object');
  assert.equal(typeof(options.name), 'string');

  if (options.required) {
    assert.equal(typeof(options.required), 'object');
    this.required = options.required;
  } else {
    this.required = {};
  }

  if (options.optional) {
    assert.equal(typeof(options.optional), 'object');
    this.optional = options.optional;
  } else {
    this.optional = {};
  }

  if (options.strict)
    this.strict = options.strict;

  this._optionalKeys = Object.keys(this.optional);
  this._requiredKeys = Object.keys(this.required);

  this.__defineGetter__('name', function() {
    return options.name;
  });
}
module.exports = Validator;


Validator.prototype._validate = function(entry, callback) {
  var i;
  var errors = [];

  var attrs = Object.keys(entry.attributes);
  var attrName;

  for (i = 0; i < this._requiredKeys.length; i++) {
    attrName = this._requiredKeys[i];
    if (attrName === 'objectclass' || /^_.*/.test(attrName))
      continue;
    if (attrs.indexOf(attrName) === -1) {
      errors.push(attrName + ' is required');
      continue;
    }

    if (this.required[attrName] &&
        entry.attributes[attrName].length > this.required[attrName]) {
      errors.push(attrName +
                  ' can only have ' +
                  this.required[attrName] +
                  ' values');
    }
  }

  for (i = 0; i < attrs; i++) {
    attrName = attrs[i];
    if (attrName === 'objectclass' || /^_.*/.test(attrName))
      continue;

    if (this._requiredKeys.indexOf(attrName) !== -1)
      continue; // already processed

    if (this._optionalKeys.indexOf(attrName) === -1 && this.strict)
      errors.push(attrs[i] + ' not allowed');

    if (this.optional[attrName] &&
        entry.attributes[attrName].length > this.optional[attrName]) {
      errors.push(attrName +
                  ' can only have ' +
                  this.optional[attrName] +
                  ' values');
    }
  }

  if (errors.length)
    return callback(new ldap.ObjectclassViolationError(errors.join('\n')));

  if (typeof(this.validate) == 'function')
    return this.validate(entry, callback);

  return callback();
};
