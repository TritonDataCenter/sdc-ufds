// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');


var ldap = require('ldapjs');
var restify = require('restify');
var sprintf = require('sprintf').sprintf;
var uuid = require('node-uuid');



///--- Globals

var LIMIT_DN = 'dclimit=%s, %s';

var Change = ldap.Change;



///--- Helpers

function loadLimits(req, callback) {
    var opts = {
        filter: '(objectclass=capilimit)',
        scope: 'one'
    };
    var base = req.customer.dn.toString();
    return req.ldap.search(base, opts, function (err, res) {
        var done = false;
        if (err) {
            done = true;
            return callback(err);
        }

        var entries = [];
        res.on('error', function (err2) {
            if (done)
                return;
            done = true;
            if (err2 instanceof ldap.NoSuchObjectError)
                return callback(new restify.ResourceNotFoundError(req.url));

            return callback(err2);
        });

        res.on('searchEntry', function (entry) {
            var e = entry.toObject();

            delete e.dn;
            delete e.objectclass;
            Object.keys(e).forEach(function (k) {
                /* JSSTYLED */
                if (k === 'datacenter' || /^_.*/.test(k))
                    return;

                entries.push({
                    data_center: e.datacenter,
                    zone_type: k,
                    limit: parseInt(e[k], 10)
                });
            });
        });
        res.on('end', function (result) {
            if (done)
                return;
            done = true;
            return callback(null, entries);
        });
    });
}



///--- API


module.exports = {

    list: function list(req, res, next) {
        assert.ok(req.customer);
        assert.ok(req.ldap);

        var log = req.log;

        log.debug('ListLimits %s/%s entered', req.params.uuid);

        return loadLimits(req, function (err, entries) {
            if (err)
                return next(err);

            if (req.xml)
                entries = { limits: { limit: entries } };

            log.debug('ListLimits %s/%s -> %o', req.params.uuid, entries);
            res.send(200, entries);
            return next();
        });
    },

    put: function put(req, res, next) {
        assert.ok(req.customer);
        assert.ok(req.ldap);

        var log = req.log;

        log.debug('PutLimit /%s/%s/%s entered', req.params.uuid,
                  req.params.dc, req.params.dataset);

        var dn = sprintf(LIMIT_DN, req.params.dc, req.customer.dn.toString());
        return loadLimits(req, function (err, entries) {
            if (err)
                return next(err);

            var exists = false;
            entries.forEach(function (e) {
                if (e.data_center === req.params.dc)
                    exists = e;
            });

            if (exists) {
                var mod = {};
                mod[req.params.dataset] = req.body;
                var change = new Change({
                    type: 'replace',
                    modification: mod
                });
                return req.ldap.modify(dn, change, function (err2) {
                    if (err2)
                        return next(err2);

                    log.debug('PutLimit %s modified -> %s', dn, req.body);
                    res.send(200);
                    return next();
                });
            }

            var entry = {
                datacenter: req.params.dc,
                objectclass: 'capilimit'
            };
            entry[req.params.dataset] = req.body;
            return req.ldap.add(dn, entry, function (err2) {
                if (err2)
                    return next(err2);

                log.debug('PutLimit %s created -> %s', dn, req.body);
                res.send(201);
                return next();
            });
        });
    },


    del: function del(req, res, next) {
        assert.ok(req.customer);
        assert.ok(req.ldap);

        var log = req.log;

        log.debug('DeleteLimit %s/%s/%s entered',
                  req.params.uuid, req.params.dc, req.params.dataset);

        var dn = sprintf(LIMIT_DN, req.params.dc, req.customer.dn.toString());
        return loadLimits(req, function (err, entries) {
            if (err)
                return next(err);

            var exists = false;
            entries.forEach(function (e) {
                if (e.data_center === req.params.dc &&
                    e.zone_type === req.params.dataset)
                    exists = e;
            });

            if (!exists)
                return next(new restify.ResourceNotFoundError(dn));

            console.log(exists);
            var mod = {};
            mod[req.params.dataset] = exists.limit;
            var change = new Change({
                type: 'delete',
                modification: mod
            });
            return req.ldap.modify(dn, change, function (err2) {
                if (err2)
                    return next(err2);

                log.debug('DeleteLimit %s: %s deleted', dn, req.params.dataset);
                res.send(200);
                return next();
            });
        });
    }

};
