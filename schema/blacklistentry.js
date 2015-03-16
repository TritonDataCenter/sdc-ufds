/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

var util = require('util');

var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');


///--- Globals

var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;


///--- API

function BlacklistEntry() {
    Validator.call(this, {
        name: 'emailblacklistentry',
        required: {
            uuid: 1
        },
        optional: {
            denyemail: 1,
            denydomain: 1
        },
        strict: true
    });
}

util.inherits(BlacklistEntry, Validator);

BlacklistEntry.prototype.validate =
function validate(entry, config, changes, callback) {
    var attrs = entry.attributes;
    var errors = [];

    if (attrs.uuid) {
        var uuid = attrs.uuid[0];
        if (!UUID_RE.test(uuid)) {
            errors.push('uuid: ' + uuid + ' is invalid');
        }

        var dn = (typeof (entry.dn) === 'string') ?
            ldap.parseDN(entry.dn) : entry.dn;

        if (dn.rdns[0].uuid && dn.rdns[0].uuid !== uuid) {
            errors.push('dn: ' + entry.dn + ' is invalid');
        }

        if (changes && changes.some(function (c) {
            return (c._modification.type === 'uuid');
        })) {
            errors.push('uuid cannot be modified');
        }
    }
    if (!attrs.denyemail && !attrs.denydomain) {
        errors.push('denyemail or denydomain attribute must be present');
    }

    if (errors.length > 0) {
        return callback(new ldap.ConstraintViolationError(errors.join('\n')));
    }

    return callback();
};



///--- Exports

module.exports = {
    createInstance: function createInstance() {
        return new BlacklistEntry();
    }
};
