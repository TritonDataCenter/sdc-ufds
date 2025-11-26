/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * This file contains the general validation rules applied to all the
 * object classes defined under "schema/" and calls the individual
 * validators defined on those files when they define a "validate"
 * method.
 *
 * The file is called by "lib/schema/index.js#runValidations". See
 * "lib/index.js" for the exact moment where validations are called
 * depending on the LDAP operation.
 */

var assert = require('assert');
var util = require('util');

var ldap = require('ldapjs');



///--- API

function Validator(options) {
    assert.equal(typeof (options), 'object');
    assert.equal(typeof (options.name), 'string');

    if (options.required) {
        assert.equal(typeof (options.required), 'object');
        this.required = options.required;
    } else {
        this.required = {};
    }

    if (options.optional) {
        assert.equal(typeof (options.optional), 'object');
        this.optional = options.optional;
    } else {
        this.optional = {};
    }

    if (options.strict) {
        this.strict = options.strict;
    }

    if (options.immutable) {
        assert.ok(util.isArray(options.immutable));
        this._immutableKeys = options.immutable;
    } else {
        this._immutableKeys = [];
    }

    this._optionalKeys = Object.keys(this.optional);
    this._requiredKeys = Object.keys(this.required);

    this.__defineGetter__('name', function () {
        return options.name;
    });

    this.__defineGetter__('immutableAttrs', function () {
        return this._immutableKeys;
    });
}
module.exports = Validator;


Validator.prototype._validate =
function _validate(entry, config, changes, callback, operation) {
    if (typeof (changes) === 'function') {
        callback = changes;
        changes = false;
    }

    var i;
    var errors = [];

    var attrs = Object.keys(entry.attributes);
    var attrName;

    for (i = 0; i < this._requiredKeys.length; i++) {
        attrName = this._requiredKeys[i];
        /* JSSTYLED */
        if (attrName === 'objectclass' || /^_.*/.test(attrName)) {
            continue;
        }
        if (attrs.indexOf(attrName) === -1) {
            errors.push(attrName + ' is required');
            continue;
        }

        if (this.required[attrName] &&
            entry.attributes[attrName].length > this.required[attrName]) {
            errors.push(attrName +
                        ' can only have ' +
                        this.required[attrName] +
                        ' values');
        }
    }

    for (i = 0; i < attrs; i++) {
        attrName = attrs[i];
        /* JSSTYLED */
        if (attrName === 'objectclass' || /^_.*/.test(attrName)) {
            continue;
        }

        if (this._requiredKeys.indexOf(attrName) !== -1) {
            continue; // already processed
        }

        if (this._optionalKeys.indexOf(attrName) === -1 && this.strict) {
            errors.push(attrs[i] + ' not allowed');
        }

        if (this.optional[attrName] &&
            entry.attributes[attrName].length > this.optional[attrName]) {
            errors.push(attrName +
                        ' can only have ' +
                        this.optional[attrName] +
                        ' values');
        }
    }

    if (errors.length > 0) {
        return callback(new ldap.ObjectclassViolationError(errors.join('\n')));
    }

    if (typeof (this.validate) === 'function') {
        return this.validate(entry, config, changes, callback, operation);
    }

    return callback();
};
