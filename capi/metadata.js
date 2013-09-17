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
var qs = require('querystring');
var util = require('./util');



///--- Globals

var MD_DN = 'metadata=%s, %s';

var Change = ldap.Change;



///--- Helpers

function loadMetadata(req, notFoundOk, callback) {
    if (typeof (notFoundOk) !== 'boolean') {
        callback = notFoundOk;
        notFoundOk = false;
    }
    var base = sprintf(MD_DN, req.params.appkey, req.customer.dn.toString());
    var opts = {
        filter: '(objectclass=capimetadata)',
        scope: 'base'
    };
    req.ldap.search(base, opts, function (err, _res) {
        var done = false;
        if (err) {
            done = true;
            return callback(err);
        }

        var entry = {};
        _res.on('error', function (err2) {
            if (done) {
                return;
            }
            done = true;
            if (err2 instanceof ldap.NoSuchObjectError) {
                if (notFoundOk) {
                    return callback();
                }

                return callback(new restify.ResourceNotFoundError(req.url));
            }

            return callback(err);
        });

        _res.on('searchEntry', function (_entry) {
            entry = _entry.toObject();
            // clear out the stuff we don't need
            delete entry.dn;
            delete entry.cn;
            delete entry.objectclass;
        });

        _res.on('end', function (result) {
            if (done) {
                return;
            }
            done = true;
            return callback(null, entry);
        });
    });
}


///--- API


module.exports = {

    list: function list(req, res, next) {
        assert.ok(req.customer);
        assert.ok(req.ldap);

        var log = req.log;

        log.debug({
            uuid: req.params.uuid,
            appkey: req.params.appkey
        }, 'GetMetadataKeys: entered');

        return loadMetadata(req, function (err, entry) {
            if (err) {
                return next(err);
            }

            var keys = Object.keys(entry).filter(function (k) {
                /* JSSTYLED */
                return (k !== 'datacenter' && !/^_.*/.test(k) && k !== 'controls');
            }).map(function (k) {
                return (k.toLowerCase());
            });

            if (req.accepts('application/xml')) {
                keys = { keys: { key: keys } };
            }
            log.debug({
                uuid: req.params.uuid,
                appkey: req.params.appkey,
                keys: keys
            }, 'GetMetadataKeys: done');
            res.send(200, keys);
            return next();
        });
    },

    put: function put(req, res, next) {
        assert.ok(req.ldap);

        var dn = sprintf(MD_DN, req.params.appkey, req.customer.dn.toString());
        var key = req.params.key.toLowerCase();
        var log = req.log;
        var v = (req.body.indexOf('=') !== -1) ? qs.parse(req.body) : req.body;
        var value = (typeof (v) === 'string') ? v : JSON.stringify(v);

        log.debug({
            uuid: req.params.uuid,
            appkey: req.params.appkey,
            key: key
        }, 'PutMetadataKey: entered');

        loadMetadata(req, true, function (err, entry) {
            if (err) {
                return next(err);
            }

            if (!entry) {
                log.debug({
                    uuid: req.params.uuid,
                    appkey: req.params.appkey,
                    key: key
                }, 'PutMetadataKey: need to add');

                entry = {
                    cn: [req.params.appkey],
                    objectclass: ['capimetadata']
                };
                entry[key] = [value];
                return req.ldap.add(dn, entry, function (err2) {
                    if (err2) {
                        return next(err2);
                    }
                    log.debug({
                        uuid: req.params.uuid,
                        appkey: req.params.appkey,
                        key: key
                    }, 'PutMetadataKey: added');

                    res.send(201);
                    return next();
                });
            }

            var mod = {};
            mod[key] = [value];
            var change = new Change({
                type: 'replace',
                modification: mod
            });
            log.debug({
                uuid: req.params.uuid,
                appkey: req.params.appkey,
                key: key
            }, 'PutMetadataKey: updating');

            return req.ldap.modify(dn, change, function (err2) {
                if (err2) {
                    return next(err2);
                }

                log.debug({
                    uuid: req.params.uuid,
                    appkey: req.params.appkey,
                    key: key
                }, 'PutMetadataKey: updated');
                res.send(entry[key] ? 200 : 201);
                return next();
            });
        });
    },

    get: function get(req, res, next) {
        assert.ok(req.ldap);

        var key = req.params.key.toLowerCase();
        var log = req.log;
        log.debug({
            uuid: req.params.uuid,
            appkey: req.params.appkey,
            key: key
        }, 'GetMetadataKey: updated');

        loadMetadata(req, function (err, entry) {
            if (err) {
                return next(err);
            }

            if (!entry[key]) {
                return next(new restify.ResourceNotFoundError(key));
            }

            // force this on the client, like a true CAPI would!
            res._accept = 'text/plain';
            var value = entry[key];
            try {
                value = JSON.parse(value);
            } catch (e) {
                // At this point, we may have some values like
                // secretkey=OFRVW3Z6HJ6XXXXXXXXXXXXXXXX due to import. We want
                // those being returned as objects too:
                if (value.indexOf('=') !== -1) {
                    value = qs.parse(value);
                }
                // Otherwise, just a plain text string, return "as is".
            }
            log.debug({
                uuid: req.params.uuid,
                appkey: req.params.appkey,
                key: key,
                value: value
            }, 'GetMetadataKey: done');
            res.send(200, value);
            return next();
        });
    },

    del: function del(req, res, next) {
        assert.ok(req.customer);
        assert.ok(req.ldap);

        var key = req.params.key.toLowerCase();
        var log = req.log;
        log.debug({
            uuid: req.params.uuid,
            appkey: req.params.appkey,
            key: key
        }, 'DeleteMetadataKey: updated');

        return loadMetadata(req, function (err, entry) {
            if (err) {
                return next(err);
            }

            if (!entry[key]) {
                return next(new restify.ResourceNotFoundError(key));
            }

            var mod = {};
            mod[key] = entry[key];
            var change = new Change({
                type: 'delete',
                modification: mod
            });

            var dn = sprintf(MD_DN, req.params.appkey,
                             req.customer.dn.toString());
            log.debug({
                dn: dn,
                key: key
            }, 'DeleteMetadataKey: deleting');

            log.debug('DeletMetadataKey %s: deleting %s', dn, key);
            return req.ldap.modify(dn, change, function (err2) {
                if (err2) {
                    return next(err2);
                }
                log.debug({
                    dn: dn,
                    key: key
                }, 'DeleteMetadataKey: deleted');
                res.send(200);
                return next();
            });
        });
    }

};
