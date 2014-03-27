/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * KeyAPI was originally using this file. While it's deprecated now, we still
 * have some setups using it.
 */

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
