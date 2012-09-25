// Copyright 2012 Joyent, Inc.  All rights reserved.

var util = require('util');
var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');
var valid = require('../lib/validator');



///--- Validation helpers



function validVLAN(vlan) {
    if (isNaN(vlan) || (vlan < 0) || (vlan > 4094) || (vlan == 1)) {
        return false;
    }
    return true;
}


function validSubnetBits(bits) {
    if (isNaN(bits) || (bits < 8) || (bits > 32)) {
        return false;
    }
    return true;
}



///--- API



function Network() {
    Validator.call(this, {
        name: 'network',
        required: {
            uuid: 1,
            networkname: 1,
            vlan: 1,
            subnetstartip: 1,
            subnetbits: 1,
            provisionrangestartip: 1,
            provisionrangeendip: 1,
            nictagname: 1
        },
        optional: {
            gatewayip: 1,
            resolverips: 3
        }
    });
}
util.inherits(Network, Validator);


Network.prototype.validate = function validate(entry, callback) {
    var attrs = entry.attributes;
    var errors = [];
    var validBits = false;
    var validGateway = false;
    var validProvisionEnd = false;
    var validProvisionStart = false;
    var validStartIP = false;

    if (!valid.UUID(attrs.uuid)) {
        errors.push(util.format('network uuid "%s" is invalid', attrs.uuid));
    }

    if (valid.ipNumber(attrs.subnetstartip)) {
        validStartIP = true;
    } else {
        errors.push(util.format('Subnet start IP number "%d" is invalid',
            attrs.subnetstartip));
    }

    if (validSubnetBits(attrs.subnetbits)) {
        validBits = true;
    } else {
        errors.push(util.format('Invalid number of subnet bits: "%d"',
            attrs.subnetbits));
    }

    if (valid.ipNumber(attrs.provisionrangestartip)) {
        validProvisionStart = true;
    } else {
        errors.push(
            util.format('Provision range start IP number "%d" is invalid',
            attrs.provisionrangestartip));
    }

    if (valid.ipNumber(attrs.provisionrangeendip)) {
        validProvisionEnd = true;
    } else {
        errors.push(
            util.format('Provision range end IP number "%d" is invalid',
            attrs.provisionrangestartip));
    }

    if (!validVLAN(attrs.vlan)) {
        errors.push(
            util.format('VLAN ID "%d" is invalid',
            attrs.vlan));
    }

    if (attrs.gatewayip) {
        if (valid.ipNumber(attrs.gatewayip)) {
            validGateway = true;
        } else {
            errors.push(
                util.format('Gateway IP number "%d" is invalid',
                attrs.gatewayip));
        }
    }

    if (attrs.resolverips) {
        for (var i in attrs.resolverips) {
          if (!valid.ipNumber(attrs.resolverips[i])) {
              errors.push(
                  util.format('Resolver IP number "%d" is invalid',
                  attrs.resolverips[i]));
          }
        }
    }

    // IPs out of range
    if (validStartIP && validBits) {
        var subnetEndIP = Number(attrs.subnetstartip) +
            Math.pow(2, 32 - attrs.subnetbits) - 1;

        if (validProvisionStart) {
            if (attrs.provisionrangestartip < attrs.subnetstartip) {
                errors.push(
                    'Provision range start IP cannot be before the subnet '
                    + 'start IP');
                validProvisionStart = false;
            }
            if (subnetEndIP < attrs.provisionrangestartip) {
                errors.push(
                    'Provision range start IP cannot be after the subnet '
                    + 'end IP');
                validProvisionStart = false;
            }
        }

        if (validProvisionEnd) {
            if (attrs.provisionrangeendip < attrs.subnetstartip) {
                errors.push(
                    'Provision range end IP cannot be before the subnet '
                    + 'start IP');
                validProvisionEnd = false;
            }
            if (subnetEndIP < attrs.provisionrangeendip) {
                errors.push(
                    'Provision range end IP cannot be after the subnet '
                    + 'end IP');
                validProvisionEnd = false;
            }
        }

        if (validProvisionStart && validProvisionEnd) {
            if (attrs.provisionrangeendip < attrs.provisionrangestartip) {
                errors.push(
                    'Provision range start IP cannot be after the provision '
                    + 'range end IP');
            }
        }

        if (validGateway && ((attrs.gatewayip < attrs.subnetstartip) ||
            (subnetEndIP < attrs.gatewayip))) {
                errors.push('Gateway IP must be within the subnet');
        }
    }

    if (errors.length)
        return callback(new ldap.ConstraintViolationError(errors.join('\n')));

    return callback();
};



///--- Exports

module.exports = {
    createInstance: function createInstance() {
        return new Network();
    }
};
