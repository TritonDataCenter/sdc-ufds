// Copyright 2014 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');

var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');



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

function Resolver() {
    Validator.call(this, {
        name: 'resolver',
        required: {
            o: 1,
            region: 1,
            datacenter: 1,
            network: 1,
            ip: 1
        }
    });
}
util.inherits(Resolver, Validator);


Resolver.prototype.validate =
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
        errors.push('network: ' + attrs.network[0] + ' is invalid');
    }
    if (!ip(attrs.ip[0])) {
        errors.push('ip address: ' + attrs.ip[0] + ' is invalid');
    }

    if (errors.length) {
        return callback(new ldap.ConstraintViolationError(errors.join('\n')));
    }

    return callback();
};


///--- Exports

module.exports = {

    createInstance: function createInstance() {
        return new Resolver();
    }

};
