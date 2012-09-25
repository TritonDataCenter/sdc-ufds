// Copyright 2012 Joyent, Inc.  All rights reserved.

var util = require('util');
var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');
var valid = require('../lib/validator');



///--- API



function Ip() {
    Validator.call(this, {
        name: 'ip',
        required: {
            ip: 1
        },
        optional: {
            belongstouuid: 1,
            belongstotype: 1,
            owneruuid: 1,
            reserved: 1
        }
    });
}
util.inherits(Ip, Validator);


Ip.prototype.validate = function validate(entry, callback) {
    var attrs = entry.attributes;
    var errors = [];

    if (!valid.ipNumber(attrs.ip)) {
        errors.push(util.format('IP number "%d" is invalid', attrs.ip));
    }

    if (attrs.belongstouuid && !valid.UUID(attrs.belongstouuid)) {
        errors.push(util.format('IP belongs_to_uuid "%s" is invalid',
            attrs.belongstouuid));
    }

    if (attrs.owneruuid && !valid.UUID(attrs.owneruuid)) {
        errors.push(util.format('IP owner_uuid "%s" is invalid',
            attrs.owneruuid));
    }

    if (attrs.hasOwnProperty('reserved') && !valid.bool(attrs.reserved)) {
        errors.push('IP reserved value must be true or false');
    }

    if (errors.length)
        return callback(new ldap.ConstraintViolationError(errors.join('\n')));

    return callback();
};



///--- Exports

module.exports = {
    createInstance: function createInstance() {
        return new Ip();
    }
};
