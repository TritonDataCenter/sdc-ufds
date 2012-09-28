/**
 * Copyright 2012 Joyent, Inc.  All rights reserved.
 *
 * An image in SDC IMGAPI.
 */

var util = require('util'),
    format = util.format;
var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');

var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;



//---- API

function SDCImage() {
    Validator.call(this, {
        name: 'sdcimage',
        required: {
            uuid: 1,
            name: 1,
            disabled: 1
        },
        optional: {
            description: 1,
            dc: 0,      /* one or more */
            tag: 0,     /* one or more */
            urn: 1      /* DEPRECATED */
        }
    });
}
util.inherits(SDCImage, Validator);


SDCImage.prototype.validate = function validate(entry, callback) {
    var attrs = entry.attributes,
        errors = [];

    if (!UUID_RE.test(attrs.uuid[0])) {
        errors.push(format('Image uuid: "%s" is invalid (must be a UUID)',
            attrs.uuid[0]));
    }

    //TODO: max length on name and description

    if (errors.length)
        return callback(new ldap.ConstraintViolationError(errors.join('\n')));

    return callback();
};



///--- Exports

module.exports = {
    createInstance: function createInstance() {
        return new SDCImage();
    }
};
