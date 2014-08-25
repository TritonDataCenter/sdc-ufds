/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

//
// An image in SDC IMGAPI.

var util = require('util'),
    format = util.format;
var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');

var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;



//---- API

function SDCImage() {
    Validator.call(this, {
        name: 'sdcimage',
        required: {
            v: 1,
            uuid: 1,
            name: 1,
            owner: 1,
            disabled: 1,
            type: 1,
            os: 1,
            activated: 1,
            state: 1
        },
        optional: {
            published_at: 1,
            expires_at: 1,
            files: 1,
            description: 1,
            requirements: 1,
            origin: 1,
            tag: 0,  /* zero or more */
            billingtag: 0,  /* zero or more */
            acl: 0,  /* zero or more */
            datacenter: 0,  /* one or more */
            urn: 1  /* DEPRECATED */
        }
    });
}
util.inherits(SDCImage, Validator);


///--- Exports

module.exports = {
    createInstance: function createInstance() {
        return new SDCImage();
    }
};
