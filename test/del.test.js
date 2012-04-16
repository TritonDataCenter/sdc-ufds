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

        var finished = 0;
        for (var i = 0; i < 2; i++) {
            var entry = {
                ou: 'child' + i,
                objectclass: 'organizationalunit',
            };
            CLIENT.add('ou=child' + i + ',' + SUFFIX, entry, function (err) {
                t.ifError(err);

                if (++finished === 2)
                    t.done();
            });
        }
    });
});


test('delete ok', function (t) {
    CLIENT.del('ou=child1,' + SUFFIX, function (err) {
        t.ifError(err);
        t.done();
    });
});


test('delete non-existent entry', function (t) {
    CLIENT.del('cn=child1,' + SUFFIX, function (err) {
        t.ok(err);
        t.equal(err.name, 'NoSuchObjectError');
        t.done();
    });
});


test('delete non-leaf entry', function (t) {
    CLIENT.del(SUFFIX, function (err) {
        t.ok(err);
        t.equal(err.name, 'NotAllowedOnNonLeafError');
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
