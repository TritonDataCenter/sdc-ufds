/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * This file includes the definition of the handler used by Smartlogin for
 * instance SSH access, mounted as:
 *      POST /customers/:uuid/ssh_sessions
 */

var assert = require('assert');
var util = require('util');
var sprintf = util.format;

var sshpk = require('sshpk');
var ldap = require('ldapjs');
var restify = require('restify');
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}


// --- Globals

var KEY_DN = 'fingerprint=%s, %s';

var HIDDEN = [new ldap.Control({
    type: '1.3.6.1.4.1.38678.1',
    criticality: true
})];

var Change = ldap.Change;

///--- Helpers

function idToFingerprint(id) {
    var fp = '';
    var i;
    for (i = 0; i < id.length; i++) {
        if (i && i % 2 === 0) {
            fp += ':';
        }
        fp += id[i];
    }

    return fp;
}


function fingerprintToId(fp) {
    if (!fp) {
        return '';
    }

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
    assert.ok(req.ufds);
    assert.ok(req.params.uuid);

    req.ufds.listKeys(req.params.uuid, function (err, keys) {
        if (err) {
            return callback(err);
        }

        keys = keys.map(function (key) {
            return translateKey(key, req.params.uuid);
        });

        return callback(null, keys);
    });
}


function loadKey(req, callback) {
    assert.ok(req.ufds);
    assert.ok(req.params.uuid);
    assert.ok(req.params.id);

    req.ufds.getKey(req.params.uuid,
            idToFingerprint(req.params.id), function (err, key) {
        if (err) {
            return callback(err);
        }
        return callback(null, translateKey(key, req.params.uuid));
    });
}



///--- API

module.exports = {


    // curl -is --data-urlencode key@/tmp/id_rsa.pub -d name=foo \
    // http://localhost:8080/customers/:uuid/keys
    post: function post(req, res, next) {
        assert.ok(req.ufds);

        var log = req.log;

        log.debug({
            uuid: req.params.uuid,
            params: req.params
        }, 'CreateKey: entered');

        if (!req.params.name) {
            return next(new restify.MissingParameterError('name is required'));
        }
        if (!req.params.key) {
            return next(new restify.MissingParameterError('key is required'));
        }

        var entry = {
            name: req.params.name,
            openssh: req.params.key
        };

        return req.ufds.addKey(req.params.uuid, entry, function (err, key) {
            if (err) {
                return next(err);
            }

            key = translateKey(key, req.params.uuid);

            if (req.accepts('application/xml')) {
                key = { key: key };
            }

            log.debug({
                key: key,
                uuid: req.params.uuid
            }, 'CreateKey: done');
            res.send(201, key);
            return next();


        });
    },


    list: function list(req, res, next) {
        assert.ok(req.ufds);
        var log = req.log;

        log.debug({uuid: req.params.uuid}, 'ListKeys: entered');

        return loadKeys(req, function (err, keys) {
            if (err) {
                return next(err);
            }

            if (req.accepts('application/xml')) {
                keys = { keys: { key: keys } };
            }

            log.debug({
                uuid: req.params.uuid,
                keys: keys
            }, 'ListKeys: done');
            res.send(200, keys);
            return next();
        });
    },


    get: function get(req, res, next) {
        assert.ok(req.ufds);

        var log = req.log;

        log.debug({
            customer_uuid: req.params.uuid,
            key_id: req.params.id
        }, 'GetKey: entered');

        return loadKey(req, function (err, key) {
            if (err) {
                return next(err);
            }

            if (req.accepts('application/xml')) {
                key = { key: key };
            }

            log.debug({
                customer_uuid: req.params.uuid,
                key_id: req.params.id,
                key: key
            }, 'GetKey: done');

            res.send(200, key);
            return next();
        });
    },


    put: function put(req, res, next) {
        assert.ok(req.ufds);

        var log = req.log;

        log.debug({
            customer_uuid: req.params.uuid,
            key_id: req.params.id,
            params: req.params
        }, 'PutKey: entered');

        return loadKey(req, function (err, key) {
            if (err) {
                return next(err);
            }

            function done() {
                log.debug({
                    customer_uuid: req.params.uuid,
                    key_id: req.params.id
                }, 'PutKey: ok');

                res.send(200);
                return next();
            }

            var dn = sprintf(KEY_DN,
                             key.fingerprint,
                             req.customer.dn.toString());

            function modName() {
                var change = new Change({
                    type: 'replace',
                    modification: {
                        name: [req.params.name]
                    }
                });

                return req.ufds.client.modify(dn, change, function (err2) {
                    if (err2) {
                        return next(err2);
                    }

                    return done();
                });
            }



            if (req.params.key) {
                log.debug({
                    customer_uuid: req.params.uuid,
                    key_id: req.params.id
                }, 'PutKey: rename');


                var k = sshpk.parseKey(req.params.key, 'ssh');
                var _fp = k.fingerprint('md5').toString('hex');
                var dn2 = sprintf(KEY_DN, _fp, req.customer.dn.toString());
                return req.ufds.client.modifyDN(dn, dn2, function (err2) {
                    if (err2) {
                        return next(err2);
                    }

                    if (req.params.name) {
                        return modName();
                    }

                    return done();
                });
            }

            if (req.params.name) {
                return modName();
            }

            return done();
        });
    },


    del: function del(req, res, next) {
        assert.ok(req.ufds);

        var log = req.log;
        log.debug({
            customer_uuid: req.params.uuid,
            key_id: req.params.id
        }, 'DeleteKey: entered');

        req.ufds.deleteKey(req.params.uuid,
                idToFingerprint(req.params.id), function (err) {
            if (err) {
                return next(err);
            }

            log.debug({
                customer_uuid: req.params.uuid,
                key_id: req.params.id
            }, 'DeleteKey: ok');

            res.send(200);
            return next();
        });
    },

    smartlogin: function smartlogin(req, res, next) {
        assert.ok(req.customer);
        assert.ok(req.ufds);

        var log = req.log;
        log.debug({
            customer_uuid: req.params.uuid,
            key_fingerprint: req.params.fingerprint
        }, 'SmartLogin: entered');

        return loadKeys(req, function (err, keys) {
            if (err) {
                return next(new restify.InternalError(err.message));
            }

            var k = false;
            var i;
            for (i = 0; i < keys.length; i++) {
                if (keys[i].fingerprint === req.params.fingerprint) {
                    k = keys[i];
                    break;
                }
            }

            if (!k) {
                return next(new restify.InvalidArgumentError('Invalid Key'));
            }

            res.send(201);
            return next();
        });
    }

};
