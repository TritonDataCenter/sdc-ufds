// Copyright 2012 Joyent, Inc.  All rights reserved.

var util = require('util');

var Validator = require('../lib/schema/validator');



///--- API

function Organization() {
    Validator.call(this, {
        name: 'organization',
        required: {
            o: 1
        },
        strict: true
    });
}
util.inherits(Organization, Validator);



///--- Exports

module.exports = {
    createInstance: function createInstance() {
        return new Organization();
    }
};
