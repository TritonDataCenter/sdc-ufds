/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 * Copyright 2025 Edgecast Cloud LLC.
 */

const util = require('util');

const ldap = require('ldapjs');
const accesskey = require('ufds/lib/accesskey');

const Validator = require('../lib/schema/validator');

const ID_RE = /^\w+$/;
const KEY_RE = /^[A-Za-z0-9_-]+$/;

const READONLY_ATTRS = [
    'acceskeyid',
    'accesskeysecret',
    'created'
];

const STATUS_VALUES = [
    'Active',
    'Inactive',
    'Expired'
]

// --- API

function AccessKey() {
    Validator.call(this, {
        name: 'accesskey',
        required: {
            accesskeyid: 1,
            accesskeysecret: 1
        },
        optional: {
            created: 1,
            updated: 1,
            description: 1,
            status: 1
        },
        strict: true
    });
}
util.inherits(AccessKey, Validator);


AccessKey.prototype.validate =
function validate(entry, config, changes, callback) {
    const errors = [];

    // Skip validation when importing legacy entries:
    if (!config.ufds_is_master) {
        callback();
        return;
    }

    const id = entry.attributes.accesskeyid[0];
    const key = entry.attributes.accesskeysecret[0];

    if (!ID_RE.test(id) ||
        id.length < 16 ||
        id.length > 128) {
        errors.push('accesskeyid: ' + id + ' is invalid');
    }

    if (!KEY_RE.test(key) || !accesskey.validate('tdc_', 32, key)) {
        errors.push('accesskeysecret is invalid');
    }

    if (entry.attributes.status &&
        STATUS_VALUES.indexOf(entry.attributes.status[0]) === -1) {
        errors.push('status must be one of: ' + STATUS_VALUES.join(', '));
    }

    if (entry.attributes.description && entry.attributes.description[0] &&
        entry.attributes.description[0].length > 150) {
        errors.push('description must be 150 characters in length or less');
    }

    if (changes && changes.some(function (c) {
        return (READONLY_ATTRS.indexOf(c._modification.type) !== -1);
    })) {
        errors.push(READONLY_ATTRS.join(', ') +
            'attributes can not be modified');
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
