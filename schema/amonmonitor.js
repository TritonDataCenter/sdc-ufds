// Copyright 2011 Joyent, Inc.  All rights reserved.
//
// A monitor for the Amon (SDC monitoring) system. An "amonmonitor" is meant
// to be a child of an "sdcperson".
//
// 

var util = require('util');

var ldap = require('ldapjs');
var log4js = require('log4js');

var Validator = require('../lib/schema/validator');



///--- Globals

var log = log4js.getLogger('amonmonitor');

// An amonmonitor name can be 1-32 chars, begins with alpha, rest are
// alphanumeric or '_', '.' or '-'.
var NAME_RE = /^[a-zA-Z][a-zA-Z0-9_\.-]{0,31}$/;




///--- API

function AmonMonitor() {
  Validator.call(this, {
    name: 'amonmonitor',
    required: {
      amonmonitor: 1,
      contact: 0  /* one or more (i.e. unbounded) */
    }
  });
}
util.inherits(AmonMonitor, Validator);


AmonMonitor.prototype.validate = function(entry, callback) {
  var attrs = entry.attributes;
  var i;
  var errors = [];

  if (!NAME_RE.test(attrs.amonmonitor[0])) {
    errors.push("monitor name: '" + attrs.amonmonitor[0]
      + "' is invalid (must be 1-32 chars, begin with alpha character "
      + "and include only alphanumeric '_', '.' and '-')");
  }

  if (errors.length)
    return callback(new ldap.ConstraintViolationError(errors.join('\n')));

  return callback();
};



///--- Exports

exports.createInstance = function() {
  return new AmonMonitor();
};
