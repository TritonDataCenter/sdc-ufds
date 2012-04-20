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
var USER_DN = 'login=unit_test, ' + SUFFIX;

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
        o: SUFFIX.split('=')[1]
    };
    CLIENT.add(SUFFIX, suffix, function (err) {
        t.ifError(err);

        var user = {
            login: 'unit_test',
            email: 'unit_test@joyent.com',
            uuid: uuid(),
            userpassword: 'secret',
            objectclass: 'sdcperson'
        };
        CLIENT.add(USER_DN, user, function (err2) {
            t.ifError(err2);
            t.done();
        });
    });
});


test('bind invalid password', function (t) {
    CLIENT.bind(USER_DN, 'secre', function (err) {
        t.ok(err);
        t.equal(err.name, 'InvalidCredentialsError');
        t.done();
    });
});


test('bind non-existent entry', function (t) {
    CLIENT.bind('cn=child, ' + SUFFIX, 'foo', function (err) {
        t.ok(err);
        t.equal(err.name, 'NoSuchObjectError');
        t.done();
    });
});


test('bind success', function (t) {
    CLIENT.bind(USER_DN, 'secret', function (err) {
        t.ifError(err);
        t.done();
    });
});


test('authorize ok', function (t) {
    CLIENT.compare(USER_DN, 'login', 'unit_test', function (err, matched) {
        t.ifError(err);
        t.ok(matched);
        t.done();
    });
});


test('authorization denied', function (t) {
    CLIENT.compare(SUFFIX, 'o', 'smartdc', function (err, matched) {
        t.ok(err);
        t.equal(err.name, 'InsufficientAccessRightsError');
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
