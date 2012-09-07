// Copyright 2012 Joyent, Inc.  All rights reserved.

var util = require('util');

var Validator = require('../lib/schema/validator');



///--- API

function SdcReplCheckpoint() {
    Validator.call(this, {
        name: 'sdcreplcheckpoint',
        required: {
            uid: 1,
            changenumber: 1,
            url: 1,
            query: 0
        },
        strict: true
    });
}
util.inherits(SdcReplCheckpoint, Validator);



///--- Exports

module.exports = {
    createInstance: function createInstance() {
        return new SdcReplCheckpoint();
    }
};
