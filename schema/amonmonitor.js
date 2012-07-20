// Copyright 2012 Joyent, Inc.  All rights reserved.
//
// A monitor for the Amon (SDC monitoring) system. An "amonmonitor" is meant
// to be a child of an "sdcperson".
//
//

var util = require('util');

var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');



///--- Globals

// An amonmonitor name can be 1-512 chars, begins with alphanumeric, rest are
// alphanumeric or '_', '.' or '-'.
var NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_\.-]{0,511}$/;




///--- API

function AmonMonitor() {
    Validator.call(this, {
        name: 'amonmonitor',
        required: {
            amonmonitor: 1,
            contact: 0  /* one or more (i.e. unbounded) */
        }
    });
}
util.inherits(AmonMonitor, Validator);


AmonMonitor.prototype.validate = function validate(entry, callback) {
    var attrs = entry.attributes;
    var errors = [];

    if (!NAME_RE.test(attrs.amonmonitor[0])) {
        errors.push('monitor name: \'' + attrs.amonmonitor[0] +
                    '\' is invalid (must be 1-512 chars, begin with ' +
                    ' alphanumeric character and include only alphanumeric, ' +
                    '\'_\', \'.\' and \'-\')');
    }

    if (errors.length)
        return callback(new ldap.ConstraintViolationError(errors.join('\n')));

    return callback();
};



///--- Exports

exports.createInstance = function createInstance() {
    return new AmonMonitor();
};
