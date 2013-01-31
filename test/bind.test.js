// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// See helper.js for customization options.
//

var uuid = require('node-uuid');
var sprintf = require('util').format;

if (require.cache[__dirname + '/helper.js']) {
    delete require.cache[__dirname + '/helper.js'];
}
var helper = require('./helper.js');



///--- Globals

var CLIENT;
var SUFFIX = process.env.UFDS_SUFFIX || 'o=smartdc';

var DUP_ID = uuid();
var DUP_LOGIN = 'a' + DUP_ID.substr(0, 7);
var DUP_EMAIL = DUP_LOGIN + '_test@joyent.com';
var DN_FMT = 'login=%s, ' + SUFFIX;
var USER_DN = sprintf(DN_FMT, DUP_LOGIN);

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
    CLIENT.bind(USER_DN, 'secret123', function (err) {
        t.ifError(err);
        t.done();
    });
});


test('authorize ok', function (t) {
    CLIENT.compare(USER_DN, 'login', DUP_LOGIN, function (err, matched) {
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
