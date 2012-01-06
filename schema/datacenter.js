// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');

var ldap = require('ldapjs');
var log4js = require('log4js');

var Validator = require('../lib/schema/validator');



///--- Globals

var log = log4js.getLogger('datacenter');


///--- API

function DataCenter() {
  Validator.call(this, {
    name: 'datacenter',
    required: {
      datacenter: 1,
    },
    optional: {
      company: 1,
      address: 1
    }
  });
}
util.inherits(DataCenter, Validator);


DataCenter.prototype.validate = function(entry, callback) {
  var attrs = entry.attributes;
  var i;
  var errors = [];

  if (attrs.datacenter[0].length > 255) {
    errors.push('datacenter name: ' + attrs.datacenter[0] + ' is invalid');
  }
  // Add validation for optional fields?

  if (errors.length)
    return callback(new ldap.ConstraintViolationError(errors.join('\n')));

  return callback();
};


///--- Exports

module.exports = {

  createInstance: function() {
    return new DataCenter();
  }

};
