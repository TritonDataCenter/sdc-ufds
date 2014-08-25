/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var test = require('tape');
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}

var helper = require('./helper.js');



///--- Globals

var CLIENT;
var SERVER;
var SUFFIX = process.env.UFDS_SUFFIX || 'o=smartdc';
var DN_FMT = 'login=%s, ' + SUFFIX;
var O = SUFFIX.split('=')[1];

///--- Tests

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
        o: O
    };
    CLIENT.add(SUFFIX, suffix, function (err) {
        if (err) {
            if (err.name !== 'EntryAlreadyExistsError') {
                t.ifError(err);
            }
        }

        var finished = 0;
        for (var i = 0; i < 2; i++) {
            var entry = {
                ou: 'child' + i,
                objectclass: 'organizationalunit'
            };
            CLIENT.add('ou=child' + i + ',' + SUFFIX, entry, function (err2) {
                if (err2) {
                    if (err2.name !== 'EntryAlreadyExistsError') {
                        t.ifError(err2);
                    }
                }

                if (++finished === 2) {
                    t.end();
                }
            });
        }
    });
});


test('delete ok', function (t) {
    CLIENT.del('ou=child1,' + SUFFIX, function (err) {
        t.ifError(err);
        t.end();
    });
});


test('delete non-existent entry', function (t) {
    CLIENT.del('cn=child1,' + SUFFIX, function (err) {
        t.ok(err);
        t.equal(err.name, 'NoSuchObjectError');
        t.end();
    });
});


test('delete non-leaf entry', function (t) {
    CLIENT.del(SUFFIX, function (err) {
        t.ok(err);
        t.equal(err.name, 'NotAllowedOnNonLeafError');
        t.end();
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
