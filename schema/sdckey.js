// Copyright 2012 Joyent, Inc.  All rights reserved.

var util = require('util');

var Validator = require('../lib/schema/validator');



///--- API

function SDCKey() {
    Validator.call(this, {
        name: 'sdckey',
        required: {
            name: 1,
            openssh: 1,
            fingerprint: 1,
            pkcs: 1
        },
        strict: true
    });
}
util.inherits(SDCKey, Validator);



///--- Exports

module.exports = {
    createInstance: function createInstance() {
        return new SDCKey();
    }
};
