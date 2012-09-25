// Copyright 2012 Joyent, Inc.  All rights reserved.

var util = require('util');
var ldap = require('ldapjs');

var valid = require('../lib/validator');
var Validator = require('../lib/schema/validator');



///--- API



function NicTag() {
    Validator.call(this, {
        name: 'nictag',
        required: {
            uuid: 1,
            nictag: 1
        }
    });
}
util.inherits(NicTag, Validator);


NicTag.prototype.validate = function validate(entry, callback) {
    var attrs = entry.attributes;
    var errors = [];

    if (!valid.UUID(attrs.uuid)) {
        errors.push(util.format('nic tag uuid "%s" is invalid', attrs.uuid));
    }

    if (errors.length)
        return callback(new ldap.ConstraintViolationError(errors.join('\n')));

    return callback();
};



///--- Exports

module.exports = {
    createInstance: function createInstance() {
        return new NicTag();
    }
};
