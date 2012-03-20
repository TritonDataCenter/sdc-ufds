// Copyright 2011 Joyent, Inc.  All rights reserved.

var util = require('util');
var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');


var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
var HOST_RE = /^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$/;

///--- Validation helpers

function validUUID(uuid) {
  return UUID_RE.test(uuid);
}

function validHost(host) {
  return HOST_RE.test(host);
}

function validNumber(attr) {
  var number = parseInt(attr);
  return (number > 0 ? true : false);
}


///--- API

function Server() {
  Validator.call(this, {
    name: 'server',
    required: {
      serverid: 1,
      hostname: 1,
      ram: 1,
      reserved: 1,
      cpucores: 1,
      os: 1,
      cpuvirtualization: 1,
      status: 1,
      vendornumber: 1,
      vendormodel: 1,
      manufacturer: 1,
      headnode: 1,
      lastboot: 1,
      bootargs: 1,
    },
    optional: {
      swap: 1,
      hardwareuuid: 1,
      setup: 1
    }
  });
}
util.inherits(Server, Validator);


Server.prototype.validate = function(entry, callback) {
  var attrs = entry.attributes;
  var i;
  var errors = [];

  if (!validUUID(attrs.serverid[0])) {
    errors.push("Server UUID: '" + attrs.serverid[0] + "' is invalid "
        + "(must be a UUID)");
  }

  if (!validHost(attrs.hostname[0])) {
    errors.push("Hostname: '" + attrs.serverid[0] + "' is invalid");
  }

  if (!validNumber(attrs.ram[0])) {
    errors.push("RAM: '" + attrs.ram[0] + "' is invalid "
        + "(must be a positive number)");
  }

  if (!validNumber(attrs.cpucores[0])) {
    errors.push("CPU cores: '" + attrs.cpucores[0] + "' is invalid "
        + "(must be a positive number)");
  }


  if (errors.length)
    return callback(new ldap.ConstraintViolationError(errors.join('\n')));

  return callback();
};



///--- Exports

module.exports = {
  createInstance: function() {
    return new Server();
  }
};
