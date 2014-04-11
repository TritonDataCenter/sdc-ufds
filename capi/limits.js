// Copyright 2013 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var mod_util = require('util');
var sprintf = mod_util.format;


var ldap = require('ldapjs');
var restify = require('restify');
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}



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
    return req.ufds.client.search(base, opts, function (err, res) {
        var done = false;
        if (err) {
            done = true;
            return callback(err);
        }

        var entries = [];
        res.on('error', function (err2) {
            if (done) {
                return;
            }
            done = true;
            if (err2 instanceof ldap.NoSuchObjectError) {
                return callback(new restify.ResourceNotFoundError(req.url));
            }

            return callback(err2);
        });

        res.on('searchEntry', function (entry) {
            var e = entry.toObject();

            delete e.dn;
            delete e.objectclass;
            Object.keys(e).forEach(function (k) {
                /* JSSTYLED */
                if (k === 'datacenter' || /^_.*/.test(k) || k === 'controls') {
                    return;
                }

                entries.push({
                    data_center: e.datacenter,
                    zone_type: k,
                    limit: parseInt(e[k], 10),
                    value: parseInt(e[k], 10)
                });
            });
        });
        res.on('end', function (result) {
            if (done) {
                return;
            }
            done = true;
            return callback(null, entries);
        });
    });
}



///--- API


module.exports = {

    list: function list(req, res, next) {
        assert.ok(req.customer);
        assert.ok(req.ufds);

        var log = req.log;

        log.debug({uuid: req.params.uuid}, 'ListLimits: entered');

        return loadLimits(req, function (err, entries) {
            if (err) {
                return next(err);
            }

            if (req.accepts('application/xml')) {
                entries = { limits: { limit: entries } };
            }

            log.debug({
                uuid: req.params.uuid,
                entries: entries
            }, 'ListLimits: ok');
            res.send(200, entries);
            return next();
        });
    },

    put: function put(req, res, next) {
        assert.ok(req.customer);
        assert.ok(req.ufds);

        var log = req.log;

        log.debug({
            uuid: req.params.uuid,
            dc: req.params.dc,
            dataset: req.params.dataset
        }, 'PutLimit: entered');

        var dn = sprintf(LIMIT_DN, req.params.dc, req.customer.dn.toString());
        return loadLimits(req, function (err, entries) {
            if (err) {
                return next(err);
            }

            var exists = false;
            entries.forEach(function (e) {
                if (e.data_center === req.params.dc) {
                    exists = e;
                }
            });

            if (exists) {
                var mod = {};
                mod[req.params.dataset] = req.body;
                var change = new Change({
                    type: 'replace',
                    modification: mod
                });
                return req.ufds.client.modify(dn, change, function (err2) {
                    if (err2) {
                        return next(err2);
                    }

                    log.debug({
                        dn: dn,
                        body: req.body
                    }, 'PutLimit: modified');
                    res.send(200);
                    return next();
                });
            }

            var entry = {
                datacenter: req.params.dc,
                objectclass: 'capilimit'
            };
            entry[req.params.dataset] = req.body;
            return req.ufds.client.add(dn, entry, function (err2) {
                if (err2) {
                    return next(err2);
                }

                log.debug({
                    dn: dn,
                    body: req.body
                }, 'PutLimit: created');

                res.send(201);
                return next();
            });
        });
    },


    del: function del(req, res, next) {
        assert.ok(req.customer);
        assert.ok(req.ufds);

        var log = req.log;

        log.debug({
            uuid: req.params.uuid,
            dc: req.params.dc,
            dataset: req.params.dataset
        }, 'DeleteLimit: entered');

        var dn = sprintf(LIMIT_DN, req.params.dc, req.customer.dn.toString());
        return loadLimits(req, function (err, entries) {
            if (err) {
                return next(err);
            }

            var exists = false;
            entries.forEach(function (e) {
                if (e.data_center === req.params.dc &&
                    e.zone_type === req.params.dataset) {
                    exists = e;
                    }
            });

            if (!exists) {
                return next(new restify.ResourceNotFoundError(dn));
            }

            var mod = {};
            mod[req.params.dataset] = exists.limit;
            var change = new Change({
                type: 'delete',
                modification: mod
            });
            return req.ufds.client.modify(dn, change, function (err2) {
                if (err2) {
                    return next(err2);
                }

                log.debug({
                    dn: dn,
                    dataset: req.params.dataset
                }, 'DeleteLimit: deleted');
                res.send(200);
                return next();
            });
        });
    }

};
