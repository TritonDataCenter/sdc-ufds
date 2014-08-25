/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * This file defines schema for sdcAccountResource objectclass.
 *
 * Purpose of this class is to be used by CloudAPI in order to store
 * acls for those resources that doesn't have a real existence, like
 * a list of things or the creation of a machine.
 *
 * It is account specific.
 */

var assert = require('assert');
var util = require('util');

var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');

var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

// --- API

function SDCAccountResource() {
    Validator.call(this, {
        name: 'sdcaccountresource',
        required: {
            name: 1,
            account: 1,
            uuid: 1
        },
        optional: {
            memberrole: 1000000
        }
    });
}
util.inherits(SDCAccountResource, Validator);

SDCAccountResource.prototype.validate =
function validate(entry, config, changes, callback) {
    var attrs = entry.attributes;
    var errors = [];
    var groups = attrs.memberrole || [];
    var j;

    groups.sort();
    for (j = 0; j < groups.length; j++) {
        if (groups.indexOf(groups[j], j + 1) !== -1) {
            return callback(new ldap.ConstraintViolationError(groups[j] +
                                                         ' is not unique'));
        }
    }

    var account = attrs.account[0];
    if (!UUID_RE.test(account)) {
        errors.push('account: ' + account + ' is invalid');
    }

    var dn = (typeof (entry.dn) === 'string') ?
        ldap.parseDN(entry.dn) : entry.dn;

    if (dn.rdns[1].uuid && dn.rdns[1].uuid !== account) {
        errors.push('dn: ' + entry.dn + ' is invalid');
    }

    if (attrs.uuid) {
        var uuid = attrs.uuid[0];
        if (!UUID_RE.test(uuid)) {
            errors.push('uuid: ' + uuid + ' is invalid');
        }

        if (dn.rdns[0]['resource-uuid'] &&
                dn.rdns[0]['resource-uuid'] !== uuid) {
            errors.push('dn: ' + entry.dn + ' is invalid');
        }

        if (changes && changes.some(function (c) {
            return (c._modification.type === 'uuid');
        })) {
            errors.push('uuid cannot be modified');
        }
    }


    if (errors.length) {
        return callback(new ldap.ConstraintViolationError(errors.join('\n')));
    }

    return callback();
};


// --- Exports

module.exports = {

    createInstance: function createInstance() {
        return new SDCAccountResource();
    }

};
