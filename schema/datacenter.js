// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');

var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');



///--- API

function DataCenter() {
    Validator.call(this, {
        name: 'datacenter',
        required: {
            datacenter: 1
        },
        optional: {
            company: 1,
            address: 1
        }
    });
}
util.inherits(DataCenter, Validator);


DataCenter.prototype.validate =
function validate(entry, config, changes, callback) {
    var attrs = entry.attributes;
    var errors = [];

    if (attrs.datacenter[0].length > 255) {
        errors.push('datacenter name: ' + attrs.datacenter[0] + ' is invalid');
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
        return new DataCenter();
    }

};
