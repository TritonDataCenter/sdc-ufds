// Copyright 2012 Joyent, Inc.  All rights reserved.
//
// A probe for the Amon (SDC monitoring) system. An "amonprobe" is meant
// to be a child of an "amonmonitor".
//
//

var util = require('util');
var ldap = require('ldapjs');
var Validator = require('../lib/schema/validator');



///--- Globals

// An amonprobe name can be 1-512 chars, begins with alphanumeric, rest are
// alphanumeric or '_', '.' or '-'.
var NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_\.-]{0,511}$/;
var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;



///--- API

function AmonProbe() {
    Validator.call(this, {
        name: 'amonprobe',
        required: {
            amonprobe: 1,
            type: 1,
            agent: 1
        },
        optional: {
            machine: 1
        }
    });
}
util.inherits(AmonProbe, Validator);


AmonProbe.prototype.validate = function validate(entry, callback) {
    var attrs = entry.attributes;
    var errors = [];

    if (!NAME_RE.test(attrs.amonprobe[0])) {
        errors.push('probe name: \'' + attrs.amonprobe[0] +
                    '\' is invalid (must be 1-512 chars, begin with ' +
                    ' alphanumeric character and include only alphanumeric, ' +
                    ' \'_\', \'.\' and \'-\')');
    }
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
