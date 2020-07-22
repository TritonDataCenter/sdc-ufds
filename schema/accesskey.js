/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

const util = require('util');

const ldap = require('ldapjs');

const Validator = require('../lib/schema/validator');

var ID_RE = /^\w+$/;

// --- API

function AccessKey() {
    Validator.call(this, {
        name: 'accesskey',
        required: {
            accesskeyid: 1,
            accesskeysecret: 1
        },
        optional: {
            created: 1
        },
        strict: true
    });
}
util.inherits(AccessKey, Validator);


AccessKey.prototype.validate =
function validate(entry, config, changes, callback) {
    var attrs = entry.attributes;
    var errors = [];

    // Skip validation when importing legacy entries:
    if (!config.ufds_is_master) {
        callback();
        return;
    }

    const id = attrs.accesskeyid[0];

    if (!ID_RE.test(id) ||
        id.length < 16 ||
        id.length > 128) {
        errors.push('accesskeyid: ' + id + ' is invalid');
    }

    if (changes && changes.some(function (c) {
        const fixedAttrs = ['acceskeyid', 'accesskeysecret', 'created'];
        return (fixedAttrs.indexOf(c._modification.type) !== -1);
    })) {
        errors.push('only status can be modified');
    }


    if (errors.length) {
        callback(new ldap.ConstraintViolationError(errors.join('\n')));
        return;
    }

    callback();
};
// --- Exports

module.exports = {
    createInstance: function createInstance() {
        return new AccessKey();
    }
};
