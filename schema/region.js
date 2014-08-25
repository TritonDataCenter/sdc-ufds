/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var assert = require('assert');
var util = require('util');

var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');



///--- API

function Region() {
    Validator.call(this, {
        name: 'region',
        required: {
            o: 1,
            region: 1
        },
        optional: {
            manta: 1,
            mantaInternal: 1
        }
    });
}
util.inherits(Region, Validator);


Region.prototype.validate =
function validate(entry, config, changes, callback) {
    var attrs = entry.attributes;
    var errors = [];

    if (attrs.o[0].length > 255) {
        errors.push('o: ' + attrs.o[0] + ' is invalid');
    }
    if (attrs.region[0].length > 255) {
        errors.push('region name: ' + attrs.region[0] + ' is invalid');
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
        return new Region();
    }

};
