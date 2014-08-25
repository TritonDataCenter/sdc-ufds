/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * This file makes sure every entry we try to add to UFDS contains a known
 * object class and, then, runs validation against the proper object class
 * defined schema by calling "lib/schema/validator.js".
 *
 * See "lib/index.js" for the exact moment where validations are being called
 * depending on the LDAP operation.
 */

var assert = require('assert');
var fs = require('fs');
var util = require('util');
var ldap = require('ldapjs');



///--- Helpers

function runValidations(req, entry, next) {
    assert.ok(req);
    assert.ok(entry);
    if (!req._immutableAttrs) {
        req._immutableAttrs = {};
    }

    var attributes = entry.attributes;
    var done = false;
    var finished = 0;
    var log = req.log;

    // Total hack on ManageDSAIT, but we use it to turn off
    // schema validation so we can "force load" entries that
    // would fail, but we have to take (CAPI-155)
    if (req.controls.some(function (c) {
        return c.type === '2.16.840.1.113730.3.4.2';
    })) {
        return next();
    }

    if (!attributes.objectclass) {
        return next(new ldap.ObjectclassViolationError('no objectclass'));
    }

    function callback(err) {
        if (err && !done) {
            done = true;
            return next(err);
        }

        if (++finished === attributes.objectclass.length && !done) {
            done = true;
            log.debug('%s successfully validated %s', req.logId, req.dn);
            return next();
        }

        return false;
    }


    for (var i = 0; i < attributes.objectclass.length; i++) {
        var oc = attributes.objectclass[i].toLowerCase();

        if (!req.schema[oc] && !done) {
            done = true;
            var msg = oc + ' not a known objectclass';
            return next(new ldap.UndefinedAttributeTypeError(msg));
        }

        req._immutableAttrs[oc] = req.schema[oc].immutableAttrs;
        req.schema[oc]._validate(entry, req.config, req.changes, callback);
    }

    return false;
}



///--- Exports

module.exports = {

    load: function load(directory, log) {
        assert.ok(directory);

        var validators = {};
        var files = fs.readdirSync(directory);
        files.forEach(function (f) {
            if (!/\.js$/.test(f)) {
                return;
            }

            if (log) {
                log.debug({
                    directory: directory,
                    file: f}, 'Loading schema plugin');
            }

            var file = directory + '/' + f.replace(/\.js$/, '');
            var v = require(file).createInstance();
            validators[v.name] = v;
        });

        return validators;
    },


    add: function (req, res, next) {
        assert.ok(req.schema);

        var entry = req.toObject();
        req.log.debug('add: validating %j', entry);
        return runValidations(req, entry, next);
    },


    modify: function (req, res, next) {
        assert.ok(req.entry);
        assert.ok(req.schema);

        req.log.debug('modify: validating %j', req.entry);
        return runValidations(req, {dn: req.dn, attributes: req.entry}, next);
    },

    del: function (req, res, next) {
        assert.ok(req._entry);
        assert.ok(req.schema);

        req.log.debug('del: validating %j', req._entry);
        return runValidations(req, {dn: req.dn, attributes: req._entry}, next);
    }

};
