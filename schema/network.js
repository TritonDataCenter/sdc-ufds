// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');

var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');



///--- Globals

var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;



///--- Helpers

function ip(s) {
    var valid = true;
    var parts = s.split(/\./);
    parts.forEach(function (part) {
        valid = valid && /^\d+$/.test(part);
        var d = parseInt(part, 10);
        valid = valid && d >= 0 && d <= 255;
    });
    return (valid && parts.length === 4);
}


function subnet(s) {
    var parts = s.split(/\//);
    return (parts.length === 2 && ip(parts[0]) &&
            /^\d+$/.test(parts[1]) &&
            !isNaN(parseInt(parts[1], 10)));
}


///--- API

function Network() {
    Validator.call(this, {
        name: 'network',
        required: {
            o: 1,
            region: 1,
            datacenter: 1,
            network: 1,
            uuid: 1,
            vlanid: 1,
            subnet: 1,
            netmask: 1,
            provisionstartip: 1,
            provisionendip: 1,
            nictag: 10,
            defaultgateway: 1
        }
    });
}
util.inherits(Network, Validator);


Network.prototype.validate =
function validate(entry, config, changes, callback) {
    var attrs = entry.attributes;
    var errors = [];

    if (attrs.o[0].length > 255) {
        errors.push('o: ' + attrs.o[0] + ' is invalid');
    }
    if (attrs.region[0].length > 255) {
        errors.push('region name: ' + attrs.region[0] + ' is invalid');
    }
    if (attrs.datacenter[0].length > 255) {
        errors.push('datacenter name: ' + attrs.datacenter[0] + ' is invalid');
    }
    if (attrs.network[0].length > 255) {
        errors.push('network name: ' + attrs.network[0] + ' is invalid');
    }
    var uuid = attrs.uuid;
    if (!UUID_RE.test(uuid)) {
        errors.push('uuid: ' + uuid + ' is invalid');
    }
    if (isNaN(parseInt(attrs.vlanid[0], 10)) ||
        !(/^\d+$/.test(attrs.vlanid[0]))) {
        errors.push('vlan id: ' + attrs.vlanid[0] + ' is invalid');
    }
    if (!subnet(attrs.subnet[0])) {
        errors.push('subnet: ' + attrs.subnet[0] + ' is invalid');
    }
    if (!ip(attrs.netmask[0])) {
        errors.push('netmask: ' + attrs.netmask[0] + ' is invalid');
    }
    if (!ip(attrs.provisionstartip[0])) {
        errors.push('provision start ip: ' + attrs.provisionstartip[0] +
                    ' is invalid');
    }
    if (!ip(attrs.provisionendip[0])) {
        errors.push('provision end ip: ' + attrs.provisionendip[0] +
                    ' is invalid');
    }
    for (var i = 0; i < attrs.nictag.length; ++i) {
        if (attrs.nictag[i].length > 255) {
            errors.push('nictag ' +  attrs.nictag[i] + ' is invalid');
        }
    }
    if (!ip(attrs.defaultgateway[0])) {
        errors.push('default gateway: ' + attrs.defaultgateway[0] +
                    ' is invalid');
    }

    // Add validation for optional fields?

    if (errors.length) {
        return callback(new ldap.ConstraintViolationError(errors.join('\n')));
    }

    return callback();
};


///--- Exports

module.exports = {

    createInstance: function createInstance() {
        return new Network();
    }

};
