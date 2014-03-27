// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');

var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');



///--- API

function Config() {
    Validator.call(this, {
        name: 'config',
        required: {
            svc: 1
        },
        optional: {
            cfg: 0
        }
    });
}
util.inherits(Config, Validator);


Config.prototype.validate =
function validate(entry, config, changes, callback) {
    var errors = [];

    if (errors.length) {
        return callback(new ldap.ConstraintViolationError(errors.join('\n')));
    }

    return callback();
};


///--- Exports

module.exports = {

    createInstance: function createInstance() {
        return new Config();
    }

};
