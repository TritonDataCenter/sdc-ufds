/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * This file defines schema for sdcAccountGroup, objectclass added to all the
 * groups of a given account. These entries are simmilar to GroupOfUniqueNames
 * object class.
 *
 * Purpose of this class is to ensure an account group has both, an
 * account attribute and one or more unique members and referenced roles.
 */

var assert = require('assert');
var util = require('util');

var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');

var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;


// --- API

function SDCAccountGroup() {
    Validator.call(this, {
        name: 'sdcaccountgroup',
        required: {
            cn: 1,
            account: 1
        },
        optional: {
            uniquemember: 1000000,
            memberrole: 1000000
        }
    });
}
util.inherits(SDCAccountGroup, Validator);

SDCAccountGroup.prototype.validate =
function validate(entry, config, callback) {
    var attrs = entry.attributes;
    var errors = [];
    var members = attrs.uniquemember || [];
    var roles = attrs.memberrole || [];
    var i, j;

    members.sort();
    for (i = 0; i < members.length; i++) {
        if (members.indexOf(members[i], i + 1) !== -1) {
            return callback(new ldap.ConstraintViolationError(members[i] +
                                                         ' is not unique'));
        }
    }

    roles.sort();
    for (j = 0; j < roles.length; j++) {
        if (roles.indexOf(roles[j], j + 1) !== -1) {
            return callback(new ldap.ConstraintViolationError(roles[j] +
                                                         ' is not unique'));
        }
    }

    if (!UUID_RE.test(attrs.account[0])) {
        errors.push('account: ' + attrs.account[0] + ' is invalid');
    }

    if (errors.length) {
        return callback(new ldap.ConstraintViolationError(errors.join('\n')));
    }

    return callback();
};


// --- Exports

module.exports = {

    createInstance: function createInstance() {
        return new SDCAccountGroup();
    }

};
