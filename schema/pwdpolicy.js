// Copyright 2013 Joyent, Inc.  All rights reserved.

var util = require('util');

var Validator = require('../lib/schema/validator');



///--- API

// See the IETF spec for detailed information on attributes meaning:
// http://tools.ietf.org/html/draft-behera-ldap-password-policy-10#section-5.2

function pwdPolicy() {
    Validator.call(this, {
        name: 'pwdpolicy',
        required: {
            pwdattribute: 1
        },
        optional: {
            pwdinhistory: 1,
            pwdcheckquality: 1,
            pwdminlength: 1,
            pwdlockoutduration: 1,
            pwdmaxfailure: 1,
            pwdmaxage: 1
        },
        strict: true
    });
}
util.inherits(pwdPolicy, Validator);



///--- Exports

module.exports = {
    createInstance: function createInstance() {
        return new pwdPolicy();
    }
};
