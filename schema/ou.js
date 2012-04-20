// Copyright 2012 Joyent, Inc.  All rights reserved.

var util = require('util');

var Validator = require('../lib/schema/validator');



///--- API

function OrganizationalUnit() {
    Validator.call(this, {
        name: 'organizationalunit',
        required: {
            ou: 1
        },
        strict: true
    });
}
util.inherits(OrganizationalUnit, Validator);



///--- Exports

module.exports = {
    createInstance: function createInstance() {
        return new OrganizationalUnit();
    }
};
