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
        t.end();
    });
});


test('compare true', function (t) {
    CLIENT.compare(SUFFIX, 'o', O, function (err, matched) {
        t.ifError(err);
        t.ok(matched);
        t.end();
    });
});


test('compare false', function (t) {
    CLIENT.compare(SUFFIX, 'o', 'foo', function (err, matched) {
        t.ifError(err);
        t.equal(matched, false);
        t.end();
    });
});


test('compare non-existent attribute', function (t) {
    CLIENT.compare(SUFFIX, uuid(), 'foo', function (err) {
        t.ok(err);
        t.equal(err.name, 'NoSuchAttributeError');
        t.end();
    });
});


test('compare non-existent entry', function (t) {
    CLIENT.compare('cn=child,' + SUFFIX, 'foo', 'bar', function (err) {
        t.ok(err);
        t.ok(err.name, 'NoSuchObjectError');
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
