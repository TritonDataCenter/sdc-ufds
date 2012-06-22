// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var fs = require('fs');

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

    if (!attributes.objectclass)
        return next(new ldap.ObjectclassViolationError('no objectclass'));

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
        req.schema[oc]._validate(entry, callback);
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
            if (!/\.js$/.test(f))
                return;

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
