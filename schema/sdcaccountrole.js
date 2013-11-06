/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * This file defines schema for sdcAccountRole, objectclass added to all the
 * roles of a given account. These entries are simmilar to GroupOfUniqueNames
 * object class.
 *
 * Purpose of this class is to ensure an account role has both, an
 * account attribute and one or more policy documents.
 *
 * Roles can directly have one or more unique members, or can link account
 * groups through "memberGroup" attribute.
 */

var assert = require('assert');
var util = require('util');

var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');

var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;


// --- API

function SDCAccountRole() {
    Validator.call(this, {
        name: 'sdcaccountrole',
        required: {
            role: 1,
            account: 1,
            policydocument: 100000
        },
        optional: {
            uniquemember: 1000000,
            membergroup: 1000000,
            description: 1
        }
    });
}
util.inherits(SDCAccountRole, Validator);

SDCAccountRole.prototype.validate = function validate(entry, config, callback) {
    var attrs = entry.attributes;
    var errors = [];
    var members = attrs.uniquemember || [];
    var groups = attrs.membergroup || [];
    var i, j;

    members.sort();
    for (i = 0; i < members.length; i++) {
        if (members.indexOf(members[i], i + 1) !== -1) {
            return callback(new ldap.ConstraintViolationError(members[i] +
                                                         ' is not unique'));
        }
    }

    groups.sort();
    for (j = 0; j < groups.length; j++) {
        if (groups.indexOf(groups[j], j + 1) !== -1) {
            return callback(new ldap.ConstraintViolationError(groups[j] +
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
        return new SDCAccountRole();
    }

};
