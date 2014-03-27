/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 * CloudAPI DataCenters list may optionally include JPC DCs.
 *
 * This file is required by that functionality. See PUBAPI-516 for the details.
 */

var assert = require('assert');
var util = require('util');

var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');



///--- API

function Foreigndc() {
    Validator.call(this, {
        name: 'foreigndc',
        required: {
            foreigndc: 1,
            url: 1,
            token: 1
        },
        optional: {
            company: 1,
            address: 1
        }
    });
}
util.inherits(Foreigndc, Validator);


Foreigndc.prototype.validate =
function validate(entry, config, changes, callback) {
    var attrs = entry.attributes;
    var errors = [];

    if (attrs.foreigndc[0].length > 255) {
        errors.push('foreigndc name: ' + attrs.foreigndc[0] + ' is invalid');
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
        return new Foreigndc();
    }

};
