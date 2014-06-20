// Copyright 2013 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');

var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');



///--- Globals

var LOGIN_RE = /^[a-zA-Z][a-zA-Z0-9_\.@]+$/;
var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

var RESERVED_LOGINS = [
    // Special 'local' user for Dataset.cloud_name for a dataset added to MAPI
    // that did not originate from a DSAPI.
    // See <https://datasets.joyent.com/docs#manifest-specification>.
    'local'
];



///--- API

// Attributes prefixed with 'pwd' come from pwdPolicy spec. See:
// http://tools.ietf.org/html/draft-behera-ldap-password-policy-10#section-5.3

function SDCPerson() {
    Validator.call(this, {
        name: 'sdcperson',
        required: {
            login: 1,
            uuid: 1,
            email: 5,
            userpassword: 2
        },
        optional: {
            cn: 5,
            sn: 5,
            givenname: 5,
            company: 5,
            address: 10,
            city: 5,
            state: 1,
            postalcode: 1,
            country: 1,
            phone: 5,
            pwdchangedtime: 1,
            pwdaccountlockedtime: 1,
            pwdfailuretime: 6,
            pwdhistory: 4,
            pwdpolicysubentry: 1,
            pwdendtime: 1,
            _imported: 1,
            _replicated: 1,
            approved_for_provisioning: 1,
            created_at: 1,
            updated_at: 1,
            tenant: 1
        }
    });
}
util.inherits(SDCPerson, Validator);


SDCPerson.prototype.validate =
function validate(entry, config, changes, callback) {
    var attrs = entry.attributes;
    var errors = [];

    // Skip validation when importing legacy entries:
    if (attrs._imported || (attrs._replicated && !config.ufds_is_master)) {
        return callback();
    }
    // Account sub-users: If we find a pattern "UUID/<something>" for login,
    // we'll extract '<something>' as login and run validations against it,
    // not the whole thing.
    var login = attrs.login[0];

    if (login.indexOf('/') === 36 && UUID_RE.test(login.substr(0, 36))) {
        login = login.substr(37);
    }

    if (!LOGIN_RE.test(login) ||
        login.length < 3 ||
        login.length > 32 ||
        RESERVED_LOGINS.indexOf(login) !== -1) {
        errors.push('login: ' + login + ' is invalid');
    }

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

    if (errors.length) {
        return callback(new ldap.ConstraintViolationError(errors.join('\n')));
    }

    return callback();
};


///--- Exports

module.exports = {

    createInstance: function createInstance() {
        return new SDCPerson();
    }

};
