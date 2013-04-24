// Copyright 2012 Joyent, Inc.  All rights reserved.

var util = require('util');

var Validator = require('../lib/schema/validator');



///--- API

function KeyAPIPrivKey() {
    Validator.call(this, {
        name: 'keyapiprivkey',
        required: {
            uuid: 1,
            key: 1,
            timestamp: 1
        },
        strict: true
    });
}
util.inherits(KeyAPIPrivKey, Validator);



///--- Exports

module.exports = {
    createInstance: function createInstance() {
        return new KeyAPIPrivKey();
    }
};
