/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

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
