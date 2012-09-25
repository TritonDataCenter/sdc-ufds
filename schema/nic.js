// Copyright 2012 Joyent, Inc.  All rights reserved.

var util = require('util');
var ldap = require('ldapjs');

var valid = require('../lib/validator');
var Validator = require('../lib/schema/validator');



///--- Validation helpers



function validMACnumber(num) {
    if (isNaN(num) || (num <= 0) || (num > 281474976710655)) {
        return false;
    }
    return true;
}



///--- API



function Nic() {
    Validator.call(this, {
        name: 'nic',
        required: {
            belongstotype: 1,
            belongstouuid: 1,
            mac: 1
        },
        optional: {
            ip: 1,
            networkuuid: 1,
            nictagname: 1,
            nictagsprovided: 1,
            owneruuid: 1,
            primary: 1
        }
    });
}
util.inherits(Nic, Validator);


Nic.prototype.validate = function validate(entry, callback) {
    var attrs = entry.attributes;
    var errors = [];

    if (!valid.UUID(attrs.belongstouuid)) {
        errors.push(util.format('nic belongs_to_uuid "%s" is invalid',
            attrs.belongstouuid));
    }

    if (!validMACnumber(attrs.mac)) {
        errors.push(util.format('MAC number "%s" is invalid', attrs.mac));
    }

    if (attrs.networkuuid && !valid.UUID(attrs.networkuuid)) {
        errors.push(util.format('nic network_uuid "%s" is invalid',
            attrs.networkuuid));
    }

    if (attrs.owneruuid && !valid.UUID(attrs.owneruuid)) {
        errors.push(util.format('nic owner_uuid "%s" is invalid',
            attrs.owneruuid));
    }

    if (attrs.hasOwnProperty('ip') && !valid.ipNumber(attrs.ip)) {
        errors.push(util.format('IP number "%s" is invalid', attrs.ip));
    }

    if (attrs.hasOwnProperty('primary') && !valid.bool(attrs.primary)) {
        errors.push('nic primary value must be true or false');
    }

    if (errors.length)
        return callback(new ldap.ConstraintViolationError(errors.join('\n')));

    return callback();
};



///--- Exports

module.exports = {
    createInstance: function createInstance() {
        return new Nic();
    }
};
