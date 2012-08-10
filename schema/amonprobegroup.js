// Copyright 2012 Joyent, Inc.  All rights reserved.
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


AmonProbeGroup.prototype.validate = function validate(entry, callback) {
    var errors = [];
    if (errors.length)
        return callback(new ldap.ConstraintViolationError(errors.join('\n')));
    return callback();
};



///--- Exports

exports.createInstance = function createInstance() {
    return new AmonProbeGroup();
};
