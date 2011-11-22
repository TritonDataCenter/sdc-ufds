// Copyright 2011 Joyent, Inc.  All rights reserved.
//
// A contact for the Amon (SDC monitoring) system. An "amoncontact" is meant
// to be a child of an "sdcperson".
//
// 

var assert = require('assert');
var util = require('util');

var ldap = require('ldapjs');
var log4js = require('log4js');

var Validator = require('../lib/schema/validator');



///--- Globals

var log = log4js.getLogger('amoncontact');

// An amoncontact name can be 1-32 chars, begins with alpha, rest are
// alphanumeric or '_', '.' or '-'.
var NAME_RE = /^[a-zA-Z][a-zA-Z0-9_\.-]{0,31}$/;




///--- API

function AmonContact() {
  Validator.call(this, {
    name: 'amoncontact',
    required: {
      amoncontactname: 1,
      medium: 1,
      data: 1
    }
  });
}
util.inherits(AmonContact, Validator);


AmonContact.prototype.validate = function(entry, callback) {
  var attrs = entry.attributes;
  var i;
  var errors = [];

  if (!NAME_RE.test(attrs.amoncontactname[0])) {
    errors.push("contact name: '" + attrs.amoncontactname[0]
      + "' is invalid (must be 1-32 chars, begin with alpha character "
      + "and include only alphanumeric '_', '.' and '-')");
  }

  if (errors.length)
    return callback(new ldap.ConstraintViolationError(errors.join('\n')));

  return callback();
};



///--- Exports

exports.createInstance = function() {
  return new AmonContact();
};
