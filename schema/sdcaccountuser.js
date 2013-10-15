/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
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


SDCAccountUser.prototype.validate = function validate(entry, config, callback) {
    var attrs = entry.attributes;
    var errors = [];

    // Skip validation when importing legacy entries:
    if (attrs._imported || (attrs._replicated && !config.ufds_is_master)) {
        return callback();
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
        return new SDCAccountUser();
    }

};
