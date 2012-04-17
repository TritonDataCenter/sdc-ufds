// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');

var httpSignature = require('http-signature');
var ldap = require('ldapjs');
var restify = require('restify');
var sprintf = require('sprintf').sprintf;
var uuid = require('node-uuid');

var util = require('./util');



///--- Globals

var KEY_DN = 'fingerprint=%s, %s';

var HIDDEN = [new ldap.Control({
    type: '1.3.6.1.4.1.38678.1',
    criticality: true
})];

var Change = ldap.Change;
var fingerprint = httpSignature.sshKeyFingerprint;



///--- Helpers

function idToFingerprint(id) {
    var fp = '';
    for (var i = 0; i < id.length; i++) {
        if (i && i % 2 === 0)
            fp += ':';
        fp += id[i];
    }

    return fp;
}


function fingerprintToId(fp) {
    if (!fp)
        return '';

    return fp.replace(/:/g, '');
}


function translateKey(key, _uuid) {
    assert.ok(key);

    return {
        id: fingerprintToId(key.fingerprint),
        customer_id: _uuid,
        customer_uuid: _uuid,
        name: key.name,
        body: key.openssh,
        fingerprint: key.fingerprint,
        standard: key.pkcs,
        created_at: key._ctime,
        updated_at: key._mtime
    };
}


function loadKeys(req, callback) {
    var dn = req.customer.dn.toString();
    var opts = {
        scope: 'one',
        filter: '(objectclass=sdckey)'
    };
    req.ldap.search(dn, opts, HIDDEN, function (err, _res) {
        if (err) {
            if (err instanceof ldap.NoSuchObjectError)
                return callback(new restify.ResourceNotFoundError(
                    req.params.uuid));

            return callback(err);
        }

        var entries = [];
        var done = false;
        _res.on('error', function (err2) {
            if (done)
                return;
            done = true;
            if (err2 instanceof ldap.NoSuchObjectError)
                return callback(new restify.ResourceNotFoundError(req.url));

            return callback(new restify.InternalError(err2.toString()));
        });
        _res.on('searchEntry', function (_entry) {
            entries.push(translateKey(_entry.toObject(), req.params.uuid));
        });
        _res.on('end', function (result) {
            if (done)
                return;
            done = true;

            return callback(null, entries);
        });
    });
}


function loadKey(req, callback) {
    return loadKeys(req, function (err, keys) {
        if (err)
            return callback(err);

        var key;
        for (var i = 0; i < keys.length; i++) {
            if (keys[i].id === req.params.id) {
                key = keys[i];
                break;
            }
        }

        if (!key)
            return callback(new restify.ResourceNotFoundError(req.params.id));


        return callback(null, key);
    });
}



///--- API

module.exports = {


    // curl -is --data-urlencode key@/tmp/id_rsa.pub -d name=foo \
    // http://localhost:8080/customers/:uuid/keys
    post: function post(req, res, next) {
        assert.ok(req.ldap);

        var log = req.log;

        log.debug('CreateKey(%s) entered: %o', req.params.uuid, req.params);

        if (!req.params.name)
            return next(new restify.MissingParameterError('name is required'));
        if (!req.params.key)
            return next(new restify.MissingParameterError('key is required'));


        var fp = fingerprint(req.params.key);
        var dn = sprintf(KEY_DN, fp, req.customer.dn.toString());
        var entry = {
            name: [req.params.name],
            openssh: [req.params.key],
            fingerprint: [fp],
            objectclass: ['sdckey']
        };
        return req.ldap.add(dn, entry, function (err) {
            if (err) {
                if (err instanceof ldap.EntryAlreadyExistsError) {
                    return next(new restify.InvalidArgumentError(
                        req.params.name + ' already exists'));
                } else if (err instanceof ldap.ConstraintViolationError) {
                    return next(new restify.InvalidArgumentError(
                        'ssh key is in use'));
                } else if (err instanceof ldap.NoSuchObjectError) {
                    return next(new restify.ResourceNotFoundError(
                        req.params.uuid));
                }
                return next(new restify.InternalError(err.message));
            }

            // Need to reload so we can get all the generated params
            req.params.id = fingerprintToId(fp);
            return loadKey(req, function (err2, key) {
                if (err2)
                    return next(err2);

                if (req.xml)
                    key = { key: key };

                log.debug('CreateKey(%s) -> %o', req.params.uuid, key);
                res.send(201, key);
                return next();
            });
        });
    },


    list: function list(req, res, next) {
        assert.ok(req.ldap);

        var log = req.log;

        log.debug('ListKeys(%s) entered', req.params.uuid);

        return loadKeys(req, function (err, keys) {
            if (err)
                return next(err);

            if (req.xml)
                keys = { keys: { key: keys } };

            log.debug('ListKeys(%s) -> %o', req.params.uuid, keys);
            res.send(200, keys);
            return next();
        });
    },


    get: function get(req, res, next) {
        assert.ok(req.ldap);

        var log = req.log;

        log.debug('GetKey(%s/%s) entered', req.params.uuid, req.params.id);

        return loadKey(req, function (err, key) {
            if (err)
                return next(err);

            if (req.xml)
                key = { key: key };

            log.debug('GetKey(%s/%s) -> %o',
                      req.params.uuid, req.params.id, key);
            res.send(200, key);
            return next();
        });
    },


    put: function put(req, res, next) {
        assert.ok(req.ldap);

        var log = req.log;

        log.debug('PutKey(%s/%s) entered %o', req.params.uuid, req.params.id,
                  req.params);

        return loadKey(req, function (err, key) {
            if (err)
                return next(err);

            function done() {
                log.debug('PutKey(%s/%s) ok', req.params.uuid, req.params.id);
                res.send(200);
                return next();
            }

            function modName() {
                var change = new Change({
                    type: 'replace',
                    modification: {
                        name: [req.params.name]
                    }
                });

                return req.ldap.modify(dn, change, function (err2) {
                    if (err2)
                        return next(err2);

                    return done();
                });
            }


            var dn = sprintf(KEY_DN,
                             key.fingerprint,
                             req.customer.dn.toString());
            if (req.params.key) {
                log.debug('PutKey(%s/%s) rename',
                          req.params.uuid, req.params.id);

                var _fp = fingerprint(req.params.key);
                var dn2 = sprintf(KEY_DN, _fp, req.customer.dn.toString());
                return req.ldap.modifyDN(dn, dn2, function (err2) {
                    if (err2)
                        return next(err2);

                    if (req.params.name)
                        return modName();

                    return done();
                });
            }

            if (req.params.name)
                return modName();

            return done();
        });
    },


    del: function del(req, res, next) {
        assert.ok(req.ldap);

        var log = req.log;

        log.debug('DeleteKey(%s/%s) entered', req.params.uuid, req.params.id);

        return loadKey(req, function (err, key) {
            if (err)
                return next(err);


            var dn = sprintf(KEY_DN,
                             key.fingerprint,
                             req.customer.dn.toString());
            return req.ldap.del(dn, function (err2) {
                if (err2)
                    return next(err2);

                log.debug('DeleteKey(%s/%s) ok',
                          req.params.uuid, req.params.id);
                res.send(200);
                return next();
            });
        });
    },

    smartlogin: function smartlogin(req, res, next) {
        assert.ok(req.customer);
        assert.ok(req.ldap);

        var log = req.log;

        log.debug('SmartLogin(%s/%s) entered',
                  req.params.uuid, req.params.fp);

        return loadKeys(req, function (err, keys) {
            if (err)
                return next(new restify.InternalError(err.message));

            var k = false;
            for (var i = 0; i < keys.length; i++) {
                if (keys[i].fingerprint === req.params.fingerprint) {
                    k = keys[i];
                    break;
                }
            }

            if (!k)
                return next(new restify.InvalidArgumentError('Invalid Key'));

            res.send(201);
            return next();
        });
    }

};
