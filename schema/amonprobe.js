// Copyright 2012 Joyent, Inc.  All rights reserved.
//
// A probe for the Amon (SDC monitoring) system. An "amonprobe" is meant
// to be a child of an "sdcPerson".
//
//

var util = require('util');
var ldap = require('ldapjs');
var Validator = require('../lib/schema/validator');



///--- Globals

var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;



///--- API

function AmonProbe() {
    Validator.call(this, {
        name: 'amonprobe',
        required: {
            uuid: 1,
            type: 1,
            agent: 1
        },
        optional: {
            group: 1,
            name: 1,
            machine: 1,
            config: 1,
            disabled: 1,
            contact: 0  /* one or more (i.e. unbounded) */
        }
    });
}
util.inherits(AmonProbe, Validator);


AmonProbe.prototype.validate = function validate(entry, callback) {
    var attrs = entry.attributes;
    var errors = [];

    if (!UUID_RE.test(attrs.agent[0])) {
        errors.push('probe agent: \'' + attrs.agent[0] +
                    '\' is invalid (must be a UUID)');
    }
    if (attrs.machine.length && !UUID_RE.test(attrs.machine[0])) {
        errors.push('probe machine: \'' + attrs.machine[0] +
                    '\' is invalid (must be a UUID)');
    }

    if (errors.length)
        return callback(new ldap.ConstraintViolationError(errors.join('\n')));
    return callback();
};



///--- Exports

exports.createInstance = function createInstance() {
    return new AmonProbe();
};
