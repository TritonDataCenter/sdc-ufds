/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

var test = require('tape');
var uuidv4 = require('uuid/v4');
function uuid() {
    return uuidv4();
}
var util = require('util'),
    sprintf = util.format;

var helper = require('./helper.js');



// --- Globals

var CLIENT;
var SERVER;
var SUFFIX = process.env.UFDS_SUFFIX || 'o=smartdc';

var DUP_ID = uuid();
var DUP_LOGIN = 'a' + DUP_ID.substr(0, 7);
var DUP_EMAIL = DUP_LOGIN + '_test@joyent.com';
var DN_FMT = 'login=%s, ' + SUFFIX;
var USER_DN = sprintf(DN_FMT, DUP_LOGIN);



// --- Tests

test('setup', function (t) {
    helper.createServer(function (err, server) {
        t.ifError(err);
        t.ok(server);
        SERVER = server;
        helper.createClient(function (err2, client) {
            t.ifError(err2);
            t.ok(client);
            CLIENT = client;
            t.end();
        });
    });
});


test('add fixtures', function (t) {
    var suffix = {
        objectclass: 'organization',
        o: SUFFIX.split('=')[1]
    };
    CLIENT.add(SUFFIX, suffix, function (err) {
        if (err) {
            if (err.name !== 'EntryAlreadyExistsError') {
                t.ifError(err);
            }
        }
        var user = {
            login: DUP_LOGIN,
            email: DUP_EMAIL,
            uuid: DUP_ID,
            userpassword: 'secret123',
            objectclass: 'sdcperson'
        };
        CLIENT.add(USER_DN, user, function (err2) {
            if (err2) {
                if (err2.name !== 'EntryAlreadyExistsError') {
                    t.ifError(err2);
                }
            }
            t.end();
        });
    });
});


test('bind invalid password', function (t) {
    CLIENT.bind(USER_DN, 'secre', function (err) {
        t.ok(err);
        t.equal(err.name, 'InvalidCredentialsError');
        t.end();
    });
});


test('bind non-existent entry', function (t) {
    CLIENT.bind('cn=child, ' + SUFFIX, 'foo', function (err) {
        t.ok(err);
        t.equal(err.name, 'NoSuchObjectError');
        t.end();
    });
});


test('bind success', function (t) {
    CLIENT.bind(USER_DN, 'secret123', function (err) {
        t.ifError(err);
        t.end();
    });
});


test('authorize ok', function (t) {
    CLIENT.compare(USER_DN, 'login', DUP_LOGIN, function (err, matched) {
        t.ifError(err);
        t.ok(matched);
        t.end();
    });
});


test('authorization denied', function (t) {
    CLIENT.compare(SUFFIX, 'o', 'smartdc', function (err, _matched) {
        t.ok(err);
        t.equal(err.name, 'InsufficientAccessRightsError');
        t.end();
    });
});


test('unbound client should not throw exceptions', function (t) {
    helper.createClient(true, function (err, unboundClient) {
        t.ifError(err, 'Unbound client error');
        unboundClient.compare(USER_DN, 'login', DUP_LOGIN,
            function (er2, _match) {
            t.ok(er2);
            t.equal(er2.name, 'InsufficientAccessRightsError');
            var opts = {
                scope: 'sub',
                filter: '(objectclass=*)',
                sizeLimit: 2
            };

            unboundClient.search('cn=changelog', opts, function (er3, res) {
                t.ifError(er3);
                res.on('searchEntry', function (_entry) {
                    return;
                });

                res.on('error', function (error) {
                    t.ok(error);
                    t.equal(error.name, 'InsufficientAccessRightsError');
                    unboundClient.socket.destroy();
                    t.end();
                });

                res.on('end', function (result) {
                    t.end();
                });
            });
        });
    });
});

test('teardown', function (t) {
    helper.cleanup(SUFFIX, function (err) {
        t.ifError(err);
        CLIENT.unbind(function (err2) {
            t.ifError(err2);
            helper.destroyServer(SERVER, function (err3) {
                t.ifError(err3);
                t.end();
            });
        });
    });
});
