// Copyright 2013 Joyent, Inc.  All rights reserved.

var util = require('util');

var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');



///--- Globals

var ConstraintViolationError = ldap.ConstraintViolationError;



///--- API

function GroupOfUniqueNames() {
    Validator.call(this, {
        name: 'groupofuniquenames',
        optional: {
            uniquemember: 1000000,
            description: 1
        },
        strict: true
    });
}
util.inherits(GroupOfUniqueNames, Validator);


GroupOfUniqueNames.prototype.validate =
function validate(entry, config, callback) {
    var members = entry.attributes.uniquemember || [];

    members.sort();
    for (var i = 0; i < members.length; i++) {
        if (members.indexOf(members[i], i + 1) !== -1) {
            return callback(new ConstraintViolationError(members[i] +
                                                         ' is not unique'));
        }
    }

    return callback();
};



///--- Exports

module.exports = {
    createInstance: function createInstance() {
        return new GroupOfUniqueNames();
    }
};
