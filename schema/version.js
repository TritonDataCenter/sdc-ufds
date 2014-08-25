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

function Version() {
    Validator.call(this, {
        name: 'version',
        required: {
            o: 1,
            version: 1
        }
    });
}
util.inherits(Version, Validator);


Version.prototype.validate =
function validate(entry, config, changes, callback) {
    var attrs = entry.attributes;
    var errors = [];

    if (attrs.o[0].length > 255) {
        errors.push('o: ' + attrs.o[0] + ' is invalid');
    }
    if (isNaN(parseInt(attrs.version[0], 10))) {
        errors.push('version: ' + attrs.version[0] + ' is invalid');
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
        return new Version();
    }

};
