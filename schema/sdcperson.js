// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');

var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');



///--- Globals

// Adapted from <www.regular-expressions.info/email.html> to allow, e.g.
// "root@localhost". The effective result is an RFC2822-compliant check
// before the "@", then more loose checking after: to allow "@localhost",
// "@foo.museum", "@foo.example.com", "@127.0.0.1".
var EMAIL_RE = /^[a-z0-9!#$%&'*+\/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+\/=?^_`{|}~-]+)*@[a-z0-9.]+$/i;
var LOGIN_RE = /^[a-zA-Z][a-zA-Z0-9_\.@]+$/;

var RESERVED_LOGINS = [
  // Special 'local' user for Dataset.cloud_name for a dataset added to MAPI
  //that did not originate from a DSAPI.
  // See <https://datasets.joyent.com/docs#manifest-specification>.
  'local'
];



///--- API

function SDCPerson() {
  Validator.call(this, {
    name: 'sdcperson',
    required: {
      login: 1,
      uuid: 1,
      email: 5,
      userpassword: 2
    },
    optional: {
      cn: 5,
      sn: 5,
      company: 5,
      address: 10,
      city: 5,
      state: 1,
      postalcode: 1,
      country: 1,
      phone: 5
    }
  });
}
util.inherits(SDCPerson, Validator);


SDCPerson.prototype.validate = function(entry, callback) {
  var attrs = entry.attributes;
  var i;
  var errors = [];

  if (!LOGIN_RE.test(attrs.login[0]) ||
      attrs.login[0].length < 3 ||
      attrs.login[0].length > 32 ||
      RESERVED_LOGINS.indexOf(attrs.login[0]) !== -1) {
    errors.push('login: ' + attrs.login[0] + ' is invalid');
  }

  for (i = 0; i < attrs.email.length; i++) {
    if (!EMAIL_RE.test(attrs.email[i]))
      errors.push(attrs.email[i] + ' is invalid');
  }

  if (errors.length)
    return callback(new ldap.ConstraintViolationError(errors.join('\n')));

  return callback();
};


///--- Exports

module.exports = {

  createInstance: function() {
    return new SDCPerson();
  }

};
