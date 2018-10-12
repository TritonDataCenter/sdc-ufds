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

function SDCKey() {
    Validator.call(this, {
        name: 'sdckey',
        required: {
            name: 1,
            openssh: 1,
            fingerprint: 1,
            pkcs: 1
        },
        optional: {
            attested: 1,
            attestation: 0,  /* zero or more */

            /* Specific to attested keys stored in Yubikeys. */
            ykserial: 1,
            ykpinrequired: 1,
            yktouchrequired: 1
        },
        strict: true
    });
}
util.inherits(SDCKey, Validator);



///--- Exports

module.exports = {
    createInstance: function createInstance() {
        return new SDCKey();
    }
};
