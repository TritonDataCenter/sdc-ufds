/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

//
// A probe group for the Amon (SDC monitoring) system. An "amonprobegroup" is
// meant to be a child of an "sdcPerson".
//

var util = require('util');
var ldap = require('ldapjs');
var Validator = require('../lib/schema/validator');



///--- Globals

var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;



///--- API

function AmonProbeGroup() {
    Validator.call(this, {
        name: 'amonprobegroup',
        required: {
            uuid: 1
        },
        optional: {
            name: 1,
            disabled: 1,
            contact: 0  /* one or more (i.e. unbounded) */
        }
    });
}
util.inherits(AmonProbeGroup, Validator);


AmonProbeGroup.prototype.validate =
function validate(entry, config, changes, callback) {
    var attrs = entry.attributes;
    var errors = [];

    if (attrs.uuid) {
        var uuid = attrs.uuid[0];
        if (!UUID_RE.test(uuid)) {
            errors.push('uuid: ' + uuid + ' is invalid');
        }

        var dn = (typeof (entry.dn) === 'string') ?
            ldap.parseDN(entry.dn) : entry.dn;

        if (dn.rdns[0].amonprobegroup && dn.rdns[0].amonprobegroup !== uuid) {
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

exports.createInstance = function createInstance() {
    return new AmonProbeGroup();
};
