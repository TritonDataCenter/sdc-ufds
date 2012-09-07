// Copyright 2012 Joyent, Inc.  All rights reserved.

var util = require('util');

var Validator = require('../lib/schema/validator');



///--- API

function SdcReplicator() {
    Validator.call(this, {
        name: 'sdcreplicator',
        required: {
            cn: 1
        },
        strict: true
    });
}
util.inherits(SdcReplicator, Validator);



///--- Exports

module.exports = {
    createInstance: function createInstance() {
        return new SdcReplicator();
    }
};
