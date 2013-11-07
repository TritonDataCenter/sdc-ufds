// Copyright 2012 Joyent, Inc.  All rights reserved.

var util = require('util');
var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');



///--- Globals

var KEY_RE = /^[a-zA-Z0-9\-\_]*$/;



///--- Validation helpers

function validKey(key) {
    return KEY_RE.test(key);
}



///--- API

function Tag() {
    Validator.call(this, {
        name: 'tag',
        required: {
            key: 1,
            value: 1
        },
        strict: true
    });
}
util.inherits(Tag, Validator);


Tag.prototype.validate = function validate(entry, config, changes, callback) {
    var errors = [];
    var attrs = entry.attributes;

    if (!validKey(attrs.key[0])) {
        errors.push('Tag key: \'' + attrs.key[0] +
                    '\' does not have a valid format');
    }

    if (errors.length)
        return callback(new ldap.ConstraintViolationError(errors.join('\n')));

    return callback();
};


///--- Exports

module.exports = {
    createInstance: function createInstance() {
        return new Tag();
    }
};
