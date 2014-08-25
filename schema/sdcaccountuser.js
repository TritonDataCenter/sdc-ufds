/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * This file defines schema for sdcAccountUser, objectclass added to all the
 * sub users of a given account. These entries will also have the sdcPerson
 * object class.
 */

var assert = require('assert');
var util = require('util');

var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');

var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;


///--- API

function SDCAccountUser() {
    Validator.call(this, {
        name: 'sdcaccountuser',
        required: {
            account: 1
        }
    });
}
util.inherits(SDCAccountUser, Validator);


SDCAccountUser.prototype.validate =
function validate(entry, config, changes, callback) {
    var attrs = entry.attributes;
    var errors = [];

    // Skip validation when importing legacy entries:
    if (attrs._imported || (attrs._replicated && !config.ufds_is_master)) {
        return callback();
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

    if (errors.length) {
        return callback(new ldap.ConstraintViolationError(errors.join('\n')));
    }

    return callback();
};


// --- Exports

module.exports = {

    createInstance: function createInstance() {
        return new SDCAccountUser();
    }

};
