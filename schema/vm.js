// Copyright 2014 Joyent, Inc.  All rights reserved.

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



///--- API

function VM() {
    Validator.call(this, {
        name: 'vm',
        required: {
            o: 1,
            region: 1,
            datacenter: 1,
            uuid: 1,
            adminipaddress: 1,
            role: 1
        }
    });
}
util.inherits(VM, Validator);


VM.prototype.validate =
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
    if (!UUID_RE.test(attrs.uuid[0])) {
        errors.push('uuid: ' + attrs.uuid[0] + ' is invalid');
    }
    if (!ip(attrs.adminipaddress[0])) {
        errors.push('admin ip address: ' + attrs.adminipaddress[0] +
                    ' is invalid');
    }
    if (attrs.role[0].length > 255) {
        errors.push('o: ' + attrs.role[0] + ' is invalid');
    }

    if (errors.length) {
        return callback(new ldap.ConstraintViolationError(errors.join('\n')));
    }

    return callback();
};


///--- Exports

module.exports = {

    createInstance: function createInstance() {
        return new VM();
    }

};
