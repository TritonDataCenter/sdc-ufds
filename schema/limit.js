/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * CloudAPI Limits plugins require this object class.
 */

var util = require('util');

var Validator = require('../lib/schema/validator');



///--- API

function Limit() {
    Validator.call(this, {
        name: 'capilimit',
        required: {
            datacenter: 1000
        },
        strict: true
    });
}
util.inherits(Limit, Validator);



///--- Exports

module.exports = {
    createInstance: function createInstance() {
        return new Limit();
    }
};
