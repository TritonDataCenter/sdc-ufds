// Copyright 2012 Joyent, Inc.  All rights reserved.

var util = require('util');
var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');

var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;


///--- Validation helpers

function validUUID(uuid) {
    return UUID_RE.test(uuid);
}

function validNumber(attr, gezero) {
    var number = parseInt(attr, 10);

    if (gezero === true) {
        return (number >= 0 ? true : false);
    } else {
        return (number > 0 ? true : false);
    }
}

///--- API

function VM() {
    Validator.call(this, {
        name: 'vmusage',
        required: {
            uuid: 1,
            image_uuid: 1,
            ram: 1,
            quota: 1
        },
        optional: {
            image_os: 1,
            image_name: 1,
            billing_id: 1
        }
    });
}
util.inherits(VM, Validator);


VM.prototype.validate = function validate(entry, config, callback) {
    var attrs = entry.attributes;
    var errors = [];

    if (!validUUID(attrs.uuid[0])) {
        errors.push('VM uuid: \'' + attrs.uuid[0] + '\' is invalid ' +
            '(must be a UUID)');
    }

    if (!validUUID(attrs.image_uuid[0])) {
        errors.push('Image uuid: \'' + attrs.image_uuid[0] + '\' is invalid ' +
            '(must be a UUID)');
    }

    if (attrs.billing_id !== undefined && !validUUID(attrs.billing_id[0])) {
        errors.push('Billing uuid: \'' + attrs.image_uuid[0] +
            '\' is invalid ' + '(must be a UUID)');
    }

    if (attrs.ram !== undefined && !validNumber(attrs.ram[0])) {
        errors.push('RAM: \'' + attrs.ram[0] +
                    '\' is invalid (must be a positive number)');
    }

    if (attrs.quota !== undefined && !validNumber(attrs.quota[0], true)) {
        errors.push('Quota: \'' + attrs.quota[0] +
                    '\' is invalid (must be a number greater or equal than 0)');
    }

    if (errors.length) {
        return callback(new ldap.ConstraintViolationError(errors.join('\n')));
    }

    return callback();
};



///--- Exports

module.exports = {
    createInstance: function createInstance() {
        return new VM();
    }
};
