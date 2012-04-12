// Copyright 2011 Joyent, Inc.  All rights reserved.

var util = require('util');
var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');

var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
var URN_RE = /^\w+:(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})?:.+:\d+\.\d+\.\d+$/;

///--- Validation helpers

function validUUID(uuid) {
  return UUID_RE.test(uuid);
}

function validUrn(urn) {
  return URN_RE.test(urn);
}

function validNumber(attr, min, max) {
  if (!min) min = 0;

  var number = parseInt(attr);

  if (max)
    return (number >= min && number <= max);
  else
    return (number >= min);
}

var MIN_RAM = 64;
var MIN_SWAP = 128;
var MIN_DISK = 1024;
var MIN_CPUCAP = 20;
var MIN_LWPS = 250;
var MIN_VCPUS = 1;

var MAX_ZFSIO = 1000;
var MAX_VCPUS = 16;


///--- API

function Package() {
  Validator.call(this, {
    name: 'sdcpackage',
    required: {
      uuid: 1,
      urn: 1,
      name: 1,
      version: 1,
      default: 1,
      ram: 1,
      disk: 1,
      swap: 1,
      cpucap: 1,
      lwps: 1,
      zfsiopriority: 1
    },
    optional: {
      vcpus: 1
    }
  });
}
util.inherits(Package, Validator);


Package.prototype.validate = function(entry, callback) {
  var attrs = entry.attributes;
  var i;
  var errors = [];

  if (!validUUID(attrs.uuid[0])) {
    errors.push("Package uuid: '" + attrs.uuid[0] + "' is invalid "
        + "(must be a UUID)");
  }

  if (!validUrn(attrs.urn[0])) {
    errors.push("Package URN: '" + attrs.urn[0] + "' is invalid "
        + "(must be a URN)");
  }

  if (!validNumber(attrs.ram[0], MIN_RAM)) {
    errors.push("RAM: '" + attrs.ram[0] + "' is invalid "
        + "(must be greater or equal than " + MIN_RAM + ")");
  }

  if (!validNumber(attrs.swap[0], MIN_SWAP)) {
    errors.push("Swap: '" + attrs.swap[0] + "' is invalid "
        + "(must be greater or equal than " + MIN_SWAP + ")");
  }

  if (parseInt(attrs.swap[0]) < parseInt(attrs.ram[0])) {
    errors.push("Swap: '" + attrs.swap[0] + "' is invalid "
        + "(cannot be less than RAM: " + attrs.ram[0] + ")");
  }

  if (!validNumber(attrs.disk[0], MIN_DISK)) {
    errors.push("Disk: '" + attrs.disk[0] + "' is invalid "
        + "(must be greater or equal than " + MIN_DISK + ")");
  }

  if (!validNumber(attrs.cpucap[0], MIN_CPUCAP)) {
    errors.push("CPU Cap: '" + attrs.cpucap[0] + "' is invalid "
        + "(must be greater or equal than " + MIN_CPUCAP + ")");
  }

  if (!validNumber(attrs.lwps[0], MIN_LWPS)) {
    errors.push("Lightweight Processes: '" + attrs.lwps[0] + "' is invalid "
        + "(must be greater or equal than " + MIN_LWPS + ")");
  }

  if (!validNumber(attrs.zfsiopriority[0], 0, MAX_ZFSIO)) {
    errors.push("ZFS IO Priority: '" + attrs.zfsiopriority[0] + "' is invalid "
        + "(must be greater or equal than 0 and less than " + MAX_ZFSIO + ")");
  }

  if (attrs.vcpus != undefined && !validNumber(attrs.vcpus[0], MIN_VCPUS, MAX_VCPUS)) {
    errors.push("Virtual CPUs: '" + attrs.vcpus[0] + "' is invalid "
        + "(must be greater or equal than " + MIN_VCPUS + " and less or equal than "
        + MAX_VCPUS +")");
  }


  if (errors.length)
    return callback(new ldap.ConstraintViolationError(errors.join('\n')));

  return callback();
}


///--- Exports

module.exports = {
  createInstance: function() {
    return new Package();
  }
};
