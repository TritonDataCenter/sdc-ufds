// Copyright 2011 Joyent, Inc.  All rights reserved.
//
// A probe for the Amon (SDC monitoring) system. An "amonprobe" is meant
// to be a child of an "amonmonitor".
//
// 

var util = require('util');

var ldap = require('ldapjs');
var log4js = require('log4js');

var Validator = require('../lib/schema/validator');



///--- Globals

var log = log4js.getLogger('amonprobe');

// An amonprobe name can be 1-32 chars, begins with alpha, rest are
// alphanumeric or '_', '.' or '-'.
var NAME_RE = /^[a-zA-Z][a-zA-Z0-9_\.-]{0,31}$/;
var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;



///--- API

function AmonProbe() {
  Validator.call(this, {
    name: 'amonprobe',
    required: {
      amonprobe: 1,
      type: 1,
      config: 1
    },
    optional: {
      // Must have exactly one machine or one server value.
      machine: 1,
      server: 1
    }
  });
}
util.inherits(AmonProbe, Validator);


AmonProbe.prototype.validate = function(entry, callback) {
  var attrs = entry.attributes;
  var i;
  var errors = [];

  if (!NAME_RE.test(attrs.amonprobe[0])) {
    errors.push("probe name: '" + attrs.amonprobe[0]
      + "' is invalid (must be 1-32 chars, begin with alpha character "
      + "and include only alphanumeric '_', '.' and '-')");
  }

  var all = (attrs.machine || []).concat(attrs.server || []);
  if (all.length !== 1) {
    errors.push("probe must have exactly one 'machine' or 'server': "
      + "probe=" + attrs.amonprobe[0]
      + ", machine=" + attrs.machine
      + ", server=" + attrs.server)
  }

  if (errors.length)
    return callback(new ldap.ConstraintViolationError(errors.join('\n')));

  return callback();
};



///--- Exports

exports.createInstance = function() {
  return new AmonProbe();
};
