/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * The 'config' objectclass is being used by CloudAPI to load specific
 * plugins configuration. See CloudAPI admin docs for the details.
 *
 * This is never more related to the "once existed config service".
 */

var assert = require('assert');
var util = require('util');

var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');



///--- API

function Config() {
    Validator.call(this, {
        name: 'config',
        optional: {
            cfg: 1,
            svc: 4
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
