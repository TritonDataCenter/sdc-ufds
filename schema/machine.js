// Copyright 2011 Joyent, Inc.  All rights reserved.

var util = require('util');
var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');


var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
var ALIAS_RE = /^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$/;
var MAX_ZFS_IO = 1000;

///--- Validation helpers

function validUUID(uuid) {
  return UUID_RE.test(uuid);
}

function validAlias(alias) {
  return ALIAS_RE.test(alias);
}

function validNumber(attr) {
  var number = parseInt(attr);
  return (number > 0 ? true : false);
}

function validBrand(brand) {
  return (brand == "joyent" || brand == "kvm");
}


var NUMBER_ATTRS = {
  ram: "RAM",
  swap: "Swap",
  disk: "Disk",
  lwps: "Lightweight Processes",
  cpushares: "CPU Shares",
  zfsiopriority: "ZFS IO Priority"
};

///--- API

function Machine() {
  Validator.call(this, {
    name: 'machine',
    required: {
      uuid: 1,
      brand: 1,
      ram: 1,
      disk: 1,
      swap: 1,
      lwps: 1,
      cpushares: 1,
      zfsiopriority: 1,
    },
    optional: {
      alias: 1,
      zonepath: 1,
      datasetuuid: 1,
      serveruuid: 1,
      autoboot: 1,
      datasets: 0,
      nics: 0,
      internalmetadata: 1,
      customermetadata: 1,
      delegatedataset: 1,
      disks: 0,
      vcpus: 1,
      cpucap: 1,
      status: 1,
      setup: 1,
      destroyed: 1
    }
  });
}
util.inherits(Machine, Validator);


Machine.prototype.validate = function(entry, callback) {
  var keys = Object.keys(NUMBER_ATTRS);
  var attrs = entry.attributes;
  var i;
  var errors = [];

  if (!validUUID(attrs.uuid[0])) {
    errors.push("Machine uuid: '" + attrs.uuid[0] + "' is invalid "
        + "(must be a UUID)");
  }

  for (i = 0; i < keys.length; i++) {
    var key = keys[i];

    if (!validNumber(attrs[key][0])) {
      errors.push(NUMBER_ATTRS[key] + ": '" + attrs[key][0] + "' is invalid "
          + "(must be a positive number)");
    }
  }

  if (attrs.brand != undefined && typeof(attrs.brand[0]) == "string"
        && !validBrand(attrs.brand[0])) {
    errors.push("Machine brand: '" + attrs.alias[0] + "' is invalid, "
      + "must be either 'joyent' or 'kvm'");
  }


  if (parseInt(attrs.swap[0]) < parseInt(attrs.ram[0])) {
    errors.push("Swap: '" + attrs.swap[0] + "' is invalid "
        + "(cannot be less than RAM: " + attrs.ram[0] + ")");
  }

  if (attrs.zfsiopriority[0] > MAX_ZFS_IO) {
    errors.push("ZFS IO Priority: '" + attrs.zfsiopriority[0] + "' is invalid "
        + "(cannot be greater than " + MAX_ZFS_IO + ")");
  }

  if (attrs.alias != undefined && typeof(attrs.alias[0]) == "string"
        && !validAlias(attrs.alias[0])) {
    errors.push("Machine alias: '" + attrs.alias[0] + "' is invalid");
  }

  if (attrs.vcpus != undefined && !validNumber(attrs.vcpus[0])) {
    errors.push("Virtual CPUs: '" + attrs.vcpus[0] + "' is invalid "
        + "(must be a positive number)");
  }

  if (attrs.cpucap != undefined && !validNumber(attrs.cpucap[0])) {
    errors.push("CPU Cap: '" + attrs.cpucap[0] + "' is invalid "
        + "(must be a positive number)");
  }


  if (errors.length)
    return callback(new ldap.ConstraintViolationError(errors.join('\n')));

  return callback();
};



///--- Exports

module.exports = {
  createInstance: function() {
    return new Machine();
  }
};
