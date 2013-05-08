// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// See helper.js for customization options.
//

var ldap = require('ldapjs');
var sprintf = require('util').format;
var uuid = require('node-uuid');

if (require.cache[__dirname + '/helper.js']) {
    delete require.cache[__dirname + '/helper.js'];
}
var helper = require('./helper.js');



///--- Globals

var CLIENT;
var SUFFIX = process.env.UFDS_SUFFIX || 'o=smartdc';
var DN_FMT = 'uuid=%s, ' + SUFFIX;

var test = helper.test;

var DUP_ID = uuid();
var DUP_LOGIN = 'a' + DUP_ID.substr(0, 7);
var DUP_EMAIL = DUP_LOGIN + '_test@joyent.com';
var DUP_DN = sprintf(DN_FMT, DUP_ID);

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
        if (err) {
            if (err.name !== 'EntryAlreadyExistsError') {
                t.ifError(err);
            }
        }
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
    var entry = {
        login: DUP_LOGIN,
        email: DUP_EMAIL,
        uuid: DUP_ID,
        userpassword: 'secret123',
        objectclass: 'sdcperson'
    };
    CLIENT.add(DUP_DN, entry, function (err) {
        t.ifError(err);
        t.done();
    });
});


test('add child already exists', function (t) {
    var entry = {
        login: 'foo',
        email: 'foo@joyent.com',
        uuid: uuid(),
        userpassword: 'secret123',
        objectclass: 'sdcperson'
    };
    CLIENT.add(DUP_DN, entry, function (err) {
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
        email: DUP_EMAIL,
        uuid: id,
        userpassword: 'secret123',
        objectclass: 'sdcperson'
    };
    CLIENT.add(dn, entry, function (err) {
        t.ok(err);
        if (err) {
            t.equal(err.name, 'ConstraintViolationError');
        }
        t.done();
    });
});


test('add child manage DSA', function (t) {
    var controls = [];
    controls.push(new ldap.Control({
        type: '2.16.840.1.113730.3.4.2',
        criticality: true
    }));
    var dn = sprintf(DN_FMT, uuid.v4());
    var entry = {
        login: 'a' + uuid().substr(0, 7),
        objectclass: 'sdcperson'
    };

    CLIENT.add(dn, entry, controls, function (err) {
        t.ifError(err);
        t.done();
    });
});


test('add blacklisted email', function (t) {
    var blacklist = {
        objectclass: 'emailblacklist',
        email: ['badguy@devnull.com', '*@disasterdrivendevelopment.com']
    };
    CLIENT.add('cn=blacklist, ' + SUFFIX, blacklist, function (err) {
        if (err) {
            if (err.name !== 'EntryAlreadyExistsError') {
                t.ifError(err);
            }
        }
        var id = uuid();
        var login = 'a' + id.substr(0, 7);
        var email = login + '@disasterdrivendevelopment.com';
        var dn = sprintf(DN_FMT, id);

        var entry = {
            login: login,
            email: email,
            uuid: id,
            userpassword: 'secret123',
            objectclass: 'sdcperson'
        };

        CLIENT.add(dn, entry, function (er1) {
            t.ok(er1);
            t.equal(er1.name, 'ConstraintViolationError');
            t.equal(er1.message, 'Email address is blacklisted.');
            entry.email = 'badguy@devnull.com';
            CLIENT.add(dn, entry, function (er2) {
                t.ok(er2);
                t.equal(er2.name, 'ConstraintViolationError');
                t.equal(er2.message, 'Email address is blacklisted.');
                t.done();
            });
        });
    });
});


test('Add case-only different login', function (t) {
    var ID = uuid();
    var EMAIL = 'a' + ID.substr(0, 7) + '_test@joyent.com';
    var DN = sprintf(DN_FMT, ID);
    var entry = {
        login: 'ADMIN',
        email: EMAIL,
        uuid: ID,
        userpassword: 'secret123',
        objectclass: 'sdcperson'
    };
    CLIENT.add(DN, entry, function (err) {
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
