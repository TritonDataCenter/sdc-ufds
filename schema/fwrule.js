// Copyright 2012 Joyent, Inc.  All rights reserved.
//
// A firewall rule for the firewall API
//

var util = require('util');
var net = require('net');

var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');



///--- Globals

var uuidRE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
var protocolRE = /^(tcp|udp|icmp)$/;
var actionRE = /^(allow|block)$/;



///--- Validation helpers (keep these in sync with the originals in fwapi)

function validateIPv4address(ip) {
  if (!net.isIPv4(ip) || (ip == "255.255.255.255") || (ip == "0.0.0.0")) {
    return false;
  }
  return true;
}

// Ensure subnet is in valid CIDR form
function validateIPv4subnet(subnet) {
  var parts = subnet.split('/');
  if (!validateIPv4address(parts[0])) {
    return false;
  }
  if (!parseInt(parts[1]) || (parts[1] < 1) || (parts[1] > 32)) {
    return false;
  }
  return true;
}



///--- API

function FWRule() {
  Validator.call(this, {
    name: 'fwrule',
    required: {
      fwrule: 1,
      protocol: 1,
      port: 10,
      action: 1,
      enabled: 1
    },
    optional: {
      fromtag: 0,
      totag: 0,
      frommachine: 0,
      tomachine: 0,
      fromip: 0,
      toip: 0,
      fromsubnet: 0,
      tosubnet: 0,
      fromwildcard: 0,
      towildcard: 0
    }
  });
}

util.inherits(FWRule, Validator);

FWRule.prototype.validate = function(entry, callback) {
  var attrs = entry.attributes;
  var i;
  var errors = [];
  var directions = ['from', 'to'];

  if (!uuidRE.test(attrs.fwrule)) {
    errors.push("fwrule uuid: '" + attrs.fwrule + "' is invalid "
        + "(must be a UUID)");
  }

  for (var d in directions) {
    var dir = directions[d];

    for (var i in attrs[dir + 'ip']) {
      var ip = attrs[dir + 'ip'][i];
      if (!validateIPv4address(ip)) {
        errors.push("IP address: '" + ip + "' is invalid");
      }
    }

    for (var i in attrs[dir + 'machine']) {
      var machine = attrs[dir + 'machine'][i];
      if (!uuidRE.test(machine)) {
        errors.push("machine: '" + machine + "' is invalid "
            + "(must be a UUID)");
      }
    }

    for (var i in attrs[dir + 'subnet']) {
      var subnet = attrs[dir + 'subnet'][i];
      if (!validateIPv4subnet(subnet)) {
        errors.push("subnet: '" + subnet + "' is invalid "
            + "(must be in CIDR format)");
      }
    }
  }

  if (!actionRE.test(attrs.action)) {
    errors.push("action: '" + attrs.action + "' is invalid "
        + "(must be one of: allow,block)");
  }

  if (attrs.enabled != 'true' && attrs.enabled != 'false') {
    errors.push("enabled: '" + attrs.enabled + "' is invalid "
        + "(must be one of: true,false)");
  }

  if (!protocolRE.test(attrs.protocol)) {
    errors.push("protocol: '" + attrs.protocol + "' is invalid "
        + "(must be one of: tcp,udp,icmp)");
  }

  for (var i in attrs.port) {
    var port = attrs.port[i];
    if (!parseInt(port) || port < 1 || port > 25536) {
        errors.push("port: '" + port + "' is invalid");
    }
  }

  if (errors.length)
    return callback(new ldap.ConstraintViolationError(errors.join('\n')));

  return callback();
};



///--- Exports

exports.createInstance = function() {
  return new FWRule();
};
