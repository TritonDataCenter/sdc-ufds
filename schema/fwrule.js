// Copyright 2012 Joyent, Inc.  All rights reserved.
//
// A firewall rule for the firewall API
//

var ldap = require('ldapjs');
var net = require('net');
var util = require('util');
var valid = require('../lib/validator');
var Validator = require('../lib/schema/validator');




///--- Globals

var uuidRE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
var protocolRE = /^(tcp|udp|icmp)$/;
var actionRE = /^(allow|block)$/;



///--- Validation helpers (keep these in sync with the originals in fwapi)

// Ensure subnet is in valid CIDR form
function validateIPv4subnetNumber(subnet) {
    var parts = subnet.split('/');
    if (!valid.ipNumber(parts[0])) {
        return false;
    }
    if (!parseInt(parts[1], 10) || (parts[1] < 1) || (parts[1] > 32)) {
        return false;
    }
    return true;

}

/*
function validateIPv4subnet(subnet) {
    var parts = subnet.split('/');
    if (!validateIPv4address(parts[0])) {
        return false;
    }
    if (!parseInt(parts[1], 10) || (parts[1] < 1) || (parts[1] > 32)) {
        return false;
    }
    return true;
}
*/




///--- API

function FWRule() {
    Validator.call(this, {
        name: 'fwrule',
        required: {
            uuid: 1,
            protocol: 1,
            ports: 10,
            action: 1,
            enabled: 1
        },
        optional: {
            fromtag: 0,
            totag: 0,
            fromvm: 0,
            tovm: 0,
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

FWRule.prototype.validate = function validate(entry, callback) {
    var attrs = entry.attributes;
    var errors = [];
    var i;
    var directions = ['from', 'to'];

    if (!valid.UUID(attrs.uuid)) {
        errors.push(util.format('UUID "%s" is invalid', attrs.uuid));
    }

    for (var d in directions) {
        var dir = directions[d];

        for (i in attrs[dir + 'ip']) {
            var ip = attrs[dir + 'ip'][i];
            if (!valid.ipNumber(ip)) {
                errors.push(util.format('IP number "%s" is invalid', ip));
            }
        }

        for (i in attrs[dir + 'vm']) {
            var vm = attrs[dir + 'vm'][i];
            if (!valid.UUID(vm)) {
                errors.push(util.format('VM UUID "%s" is invalid', vm));
            }
        }

        for (i in attrs[dir + 'subnet']) {
            var subnet = attrs[dir + 'subnet'][i];
            if (!validateIPv4subnetNumber(subnet)) {
                errors.push(util.format('subnet "%s" is invalid '
                    + '(must be in CIDR format)', subnet));
            }
        }
    }

    if (!actionRE.test(attrs.action)) {
        errors.push(util.format('action "%s" is invalid '
            + '(must be one of: allow,block)', attrs.action));
    }

    if (attrs.enabled != 'true' && attrs.enabled != 'false') {
        errors.push(util.format('enabled value "%s" is invalid '
            + '(must be one of: true,false)', attrs.enabled));
    }

    if (!protocolRE.test(attrs.protocol)) {
        errors.push(util.format('protocol "%s" is invalid '
            + '(must be one of: tcp,udp,icmp)', attrs.protocol));
    }

    for (i in attrs.ports) {
        var port = attrs.ports[i];
        if (!parseInt(port, 10) || port < 1 || port > 65535) {
            errors.push(util.format('port "%s" is invalid', port));
        }
    }

    if (attrs.hasOwnProperty('owner') && !valid.UUID(attrs.owner)) {
        errors.push(util.format('owner UUID "%s" is invalid', attrs.owner));
    }

    if (errors.length)
        return callback(new ldap.ConstraintViolationError(errors.join('\n')));

    return callback();
};



///--- Exports

exports.createInstance = function createInstance() {
    return new FWRule();
};
