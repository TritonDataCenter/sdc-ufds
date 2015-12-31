/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

//
// A firewall rule for the firewall API
//

var assert = require('assert');
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


// Check that a port is a valid number and within the appropriate range
function invalidPort(p) {
    return !parseInt(p, 10) || p < 1 || p > 65535;
}


///--- API

function FWRule() {
    Validator.call(this, {
        name: 'fwrule',
        required: {
            uuid: 1,
            protocol: 1,
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
            towildcard: 0,
            ports: 10,
            types: 10
        }
    });
}

util.inherits(FWRule, Validator);

FWRule.prototype.validate =
function validate(entry, config, changes, callback) {
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

    if (attrs.hasOwnProperty('enabled')) {
        assert.ok(attrs.enabled.length === 1,
            util.format('fwrule %s neither enabled nor disabled', attrs.uuid));
        var enabled = attrs.enabled[0];

        if (enabled !== 'true' && enabled !== 'false') {
            errors.push(util.format('enabled value "%s" is invalid '
                + '(must be one of: true,false)', attrs.enabled));
        }
    }

    if (!protocolRE.test(attrs.protocol)) {
        errors.push(util.format('protocol "%s" is invalid '
            + '(must be one of: tcp,udp,icmp)', attrs.protocol));
    }

    for (i in attrs.ports) {
        var matched;
        var port = attrs.ports[i];
        if (port === 'all') {
            continue;
        }

        matched = /^(\d+)-(\d+)$/.exec(port);
        if (matched != null) {
            if (invalidPort(matched[1])) {
                errors.push(util.format('start of port range "%s" is invalid',
                    matched[1]));
            }
            if (invalidPort(matched[2])) {
                errors.push(util.format('end of port range "%s" is invalid',
                    matched[2]));
            }
            if (Number(matched[1]) >= Number(matched[2])) {
                errors.push(util.format('beginning of port range (%s) should ' +
                    'come before the end of the range (%s)',
                    matched[1], matched[2]));
            }
        } else if (invalidPort(port)) {
            errors.push(util.format('port "%s" is invalid', port));
        }
    }

    if (attrs.hasOwnProperty('owner') && !valid.UUID(attrs.owner)) {
        errors.push(util.format('owner UUID "%s" is invalid', attrs.owner));
    }

    if (errors.length) {
        return callback(new ldap.ConstraintViolationError(errors.join('\n')));
    }

    return callback();
};



///--- Exports

exports.createInstance = function createInstance() {
    return new FWRule();
};
