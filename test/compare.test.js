// Copyright 2012 Joyent, Inc.  All rights reserved.
//
// You can set UFDS_URL to connect to a server, and LOG_LEVEL to turn on
// bunyan debug logs.
//

var uuid = require('node-uuid');

if (require.cache[__dirname + '/helper.js'])
    delete require.cache[__dirname + '/helper.js'];
var helper = require('./helper.js');



///--- Globals

var CLIENT;
var SUFFIX = process.env.UFDS_SUFFIX || 'o=smartdc';
var DN_FMT = 'login=%s, ' + SUFFIX;
var O = SUFFIX.split('=')[1];

var test = helper.test;



///--- Tests

test('setup', function (t) {
    helper.createClient(function (err, client) {
        t.ifError(err);
        t.ok(client);
        CLIENT = client;
        t.done();
    });
});


test('add fixtures', function (t) {
    var suffix = {
        objectclass: 'organization',
        o: O
    };
    CLIENT.add(SUFFIX, suffix, function (err) {
        t.ifError(err);
        t.done();
    });
});


test('compare true', function (t) {
    CLIENT.compare(SUFFIX, 'o', O, function (err, matched) {
        t.ifError(err);
        t.ok(matched);
        t.done();
    });
});


test('compare false', function (t) {
    CLIENT.compare(SUFFIX, 'o', 'foo', function (err, matched) {
        t.ifError(err);
        t.equal(matched, false);
        t.done();
    });
});


test('compare non-existent attribute', function (t) {
    CLIENT.compare(SUFFIX, uuid(), 'foo', function (err) {
        t.ok(err);
        t.equal(err.name, 'NoSuchAttributeError');
        t.done();
    });
});


test('compare non-existent entry', function (t) {
    CLIENT.compare('cn=child,' + SUFFIX, 'foo', 'bar', function (err) {
        t.ok(err);
        t.ok(err.name, 'NoSuchObjectError');
        t.done();
    });
});


test('teardown', function (t) {
    helper.cleanup(SUFFIX, function (err) {
        t.ifError(err);
        CLIENT.unbind(function (err2) {
            t.ifError(err2);
            t.done();
        });
    });
});
