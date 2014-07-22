// Copyright 2012 Joyent, Inc.  All rights reserved.

var util = require('util');

var Validator = require('../lib/schema/validator');



///--- API

function SdcReplCheckpoint() {
    Validator.call(this, {
        name: 'sdcreplcheckpoint',
        required: {
            changenumber: 1,
            url: 1,
            query: 0
        },
        optional: {
            uid: 1,
            uuid: 1
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
