// Copyright 2012 Joyent, Inc.  All rights reserved.

var util = require('util');

var Validator = require('../lib/schema/validator');



///--- API

function Blacklist() {
    Validator.call(this, {
        name: 'emailblacklist',
        optional: {
            email: 0,
            description: 1
        },
        strict: true
    });
}
util.inherits(Blacklist, Validator);



///--- Exports

module.exports = {
    createInstance: function createInstance() {
        return new Blacklist();
    }
};
