// Copyright 2012 Joyent, Inc.  All rights reserved.
//
// You can set UFDS_URL to connect to a server, and LOG_LEVEL to turn on
// bunyan debug logs.
//

var sprintf = require('util').format;
var uuid = require('node-uuid');

if (require.cache[__dirname + '/helper.js'])
    delete require.cache[__dirname + '/helper.js'];
var helper = require('./helper.js');



///--- Globals

var CLIENT;
var SUFFIX = process.env.UFDS_SUFFIX || 'o=smartdc';
var DN_FMT = 'uuid=%s, ' + SUFFIX;

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


test('no suffix', function (t) {
    var entry = {
        o: uuid(),
        objectclass: 'organization'
    };
    CLIENT.add('o=' + uuid(), entry, function (err) {
        t.ok(err);
        t.equal(err.name, 'NoSuchObjectError');
        t.done();
    });
});


test('add suffix', function (t) {
    var entry = {
        o: 'smartdc',
        objectclass: 'organization'
    };
    CLIENT.add(SUFFIX, entry, function (err) {
        t.ifError(err);
        t.done();
    });
});


test('add child missing parent', function (t) {
    var entry = {
        cn: 'unit',
        objectClass: 'organization',
        o: 'test'
    };
    CLIENT.add('cn=fail, ou=fail, ' + SUFFIX, entry, function (err) {
        t.ok(err);
        t.equal(err.name, 'NoSuchObjectError');
        t.done();
    });
});


test('add child', function (t) {
    var dn = sprintf(DN_FMT, 'unit-test');
    var entry = {
        login: 'unit_test',
        email: 'unit_test@joyent.com',
        uuid: uuid(),
        userpassword: 'secret',
        objectclass: 'sdcperson'
    };
    CLIENT.add(dn, entry, function (err) {
        t.ifError(err);
        t.done();
    });
});


test('add child already exists', function (t) {
    var dn = sprintf(DN_FMT, 'unit-test');
    var entry = {
        login: 'foo',
        email: 'foo@joyent.com',
        uuid: uuid(),
        userpassword: 'secret',
        objectclass: 'sdcperson'
    };
    CLIENT.add(dn, entry, function (err) {
        t.ok(err);
        t.equal(err.name, 'EntryAlreadyExistsError');
        t.done();
    });
});


test('add child unique conflict', function (t) {
    var id = uuid();
    var dn = sprintf(DN_FMT, id);

    var entry = {
        login: 'a' + id.substr(0, 7),
        email: 'unit_test@joyent.com',
        uuid: id,
        userpassword: 'secret',
        objectclass: 'sdcperson'
    };
    CLIENT.add(dn, entry, function (err) {
        t.ok(err);
        t.equal(err.name, 'ConstraintViolationError');
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
