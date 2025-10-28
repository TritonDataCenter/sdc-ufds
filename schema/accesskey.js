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
const { DEFAULT_PREFIX, DEFAULT_BYTE_LENGTH } = accesskey;

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
            accesskeysecret: 1,
            status: 1,
            created: 1,
            updated: 1,
        },
        optional: {
            description: 1,
        },
        strict: true
    });
}
util.inherits(AccessKey, Validator);

/**
 * AccessKeys created before v7.5.0 will be missing required properties, have an
 * invalid accesskeysecret, and are unable to be used for authentication.
 * These AccessKeys weren't yet used anywhere within Triton but the undocumented
 * CloudAPI endpoints existed and its possible that some installations may have
 * some of these older entries. node-ufds and cloud-api will return
 * such keys as 'Inactive' but will need to be manually deleted from Moray as
 * UFDS's validation prevents updating or deleting these records:
 *
 * delobject ufds_o_smartdc \
 *   "accesskeyid=$ACCESSKEYID, uuid=$USER_UUID, ou=users, o=smartdc"
 *
 */
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

    if (!id ||
        !ID_RE.test(id) ||
        id.length < 16 ||
        id.length > 128) {
        errors.push('accesskeyid: ' + id + ' is invalid');
    }

    if (!key ||
        !KEY_RE.test(key) ||
        !accesskey.validate(DEFAULT_PREFIX, DEFAULT_BYTE_LENGTH, key)) {
        errors.push('accesskeysecret is invalid');
    }

    if (entry.attributes.status &&
        STATUS_VALUES.indexOf(entry.attributes.status[0]) === -1) {
        errors.push('status must be one of: ' + STATUS_VALUES.join(', '));
    }

    if (entry.attributes.description &&
        entry.attributes.description[0] &&
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
