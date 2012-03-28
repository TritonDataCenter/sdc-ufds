// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');

var ldap = require('ldapjs');
var log4js = require('log4js');

var Validator = require('../lib/schema/validator');



///--- Globals

var log = log4js.getLogger('config');

///--- API

function Config() {
  Validator.call(this, {
    name: 'config',
    required: {
      svc: 1
    },
    optional: {
      cfg: 0
    }
  });
}
util.inherits(Config, Validator);


Config.prototype.validate = function(entry, callback) {
  var attrs = entry.attributes;
  var i;
  var errors = [];

  if (errors.length)
    return callback(new ldap.ConstraintViolationError(errors.join('\n')));

  return callback();
};


///--- Exports

module.exports = {

  createInstance: function() {
    return new Config();
  }

};
