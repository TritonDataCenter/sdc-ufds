// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var sprintf = require('util').format;

var ldap = require('ldapjs');
var restify = require('restify');
var uuid = require('node-uuid');

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
            if (done)
                return;
            done = true;
            if (err2 instanceof ldap.NoSuchObjectError) {
                if (notFoundOk)
                    return callback();

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
            if (done)
                return;
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

        log.debug('GetMetadataKeys %s/%s entered',
                  req.params.uuid, req.params.appkey);

        return loadMetadata(req, function (err, entry) {
            if (err)
                return next(err);

            var keys = Object.keys(entry);

            if (req.xml)
                keys = { keys: { key: keys } };

            log.debug('GetMetadataKeys %s/%s -> %j',
                      req.params.uuid, req.params.appkey, keys);
            res.send(200, keys);
            return next();
        });
    },

    put: function put(req, res, next) {
        assert.ok(req.ldap);

        var dn = sprintf(MD_DN, req.params.appkey, req.customer.dn.toString());
        var log = req.log;

        log.debug('PutMetadataKey %s/%s/%s entered',
                  req.params.uuid, req.params.appkey, req.params.key);
        return loadMetadata(req, true, function (err, entry) {
            if (err)
                return next(err);

            if (!entry) {
                log.debug('PutMetadataKey %s/%s/%s: need to add',
                          req.params.uuid, req.params.appkey, req.params.key);
                entry = {
                    cn: [req.params.appkey],
                    objectclass: ['capimetadata']
                };
                entry[req.params.key] = [req.body];
                return req.ldap.add(dn, entry, function (err2) {
                    if (err2)
                        return next(err2);

                    log.debug('PutMetadataKey %s/%s/%s: added', req.params.uuid,
                              req.params.appkey, req.params.key);
                    res.send(201);
                    return next();
                });
            }

            var mod = {};
            mod[req.params.key] = [req.body];
            var change = new Change({
                type: 'replace',
                modification: mod
            });

            log.debug('PutMetadataKey %s/%s/%s: updating', req.params.uuid,
                      req.params.appkey, req.params.key);
            return req.ldap.modify(dn, change, function (err2) {
                if (err2)
                    return next(err2);

                log.debug('PutMetadataKey %s/%s/%s: updated', req.params.uuid,
                          req.params.appkey, req.params.key);
                res.send(entry[req.params.key] ? 200 : 201);
                return next();
            });
        });
    },

    get: function get(req, res, next) {
        assert.ok(req.ldap);

        var log = req.log;

        log.debug('GetMetadataKey %s/%s/%s entered',
                  req.params.uuid, req.params.appkey, req.params.key);
        return loadMetadata(req, function (err, entry) {
            if (err)
                return next(err);

            if (!entry[req.params.key])
                return next(new restify.ResourceNotFoundError(req.params.key));

            // force this on the client, like a true CAPI would!
            res._accept = 'text/plain';
            var value = entry[req.params.key];
            log.debug('GetMetadataKey %s/%s/%s -> %s',
                      req.params.uuid, req.params.appkey, req.params.key,
                      value);
            res.send(200, value);
            return next();
        });
    },

    del: function del(req, res, next) {
        assert.ok(req.customer);
        assert.ok(req.ldap);

        var log = req.log;

        log.debug('DeleteMetadataKey %s/%s/%s entered',
                  req.params.uuid, req.params.appkey, req.params.key);

        return loadMetadata(req, function (err, entry) {
            if (err)
                return next(err);

            if (!entry[req.params.key])
                return next(new restify.ResourceNotFoundError(req.params.key));

            var mod = {};
            mod[req.params.key] = entry[req.params.key];
            var change = new Change({
                type: 'delete',
                modification: mod
            });

            var dn = sprintf(MD_DN, req.params.appkey,
                             req.customer.dn.toString());
            log.debug('DeletMetadataKey %s: deleting %s', dn, req.params.key);
            return req.ldap.modify(dn, change, function (err2) {
                if (err2)
                    return next(err2);

                log.debug('DeleteMetadataKey %s deleted %s', dn,
                          req.params.key);
                res.send(200);
                return next();
            });
        });
    }

};
