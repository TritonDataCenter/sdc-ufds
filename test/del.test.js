// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// See helper.js for customization options.
//

var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}

if (require.cache[__dirname + '/helper.js']) {
    delete require.cache[__dirname + '/helper.js'];
}
var helper = require('./helper.js');



///--- Globals

var CLIENT;
var SUFFIX = process.env.UFDS_SUFFIX || 'o=smartdc';
var DN_FMT = 'login=%s, ' + SUFFIX;
var O = SUFFIX.split('=')[1];

var test = helper.test;

// Different than the real DN, which uses 'ou=packages':
var PACKAGE_DN = 'ou=pkg, ' + SUFFIX;
var PACKAGE = {
    name: 'regular_128',
    version: '1.0.0',
    max_physical_memory: 128,
    quota: 5120,
    max_swap: 256,
    cpu_cap: 350,
    max_lwps: 2000,
    zfs_io_priority: 1,
    'default': true,
    active: false,
    vcpus: 1,
    urn: 'sdc::regular_128:1.0.0',
    uuid: uuid(),
    objectclass: 'sdcpackage'
};

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
                    CLIENT.add(PACKAGE_DN, PACKAGE, function (err3, pkg) {
                        if (err3) {
                            if (err3.name !== 'EntryAlreadyExistsError') {
                                t.ifError(err3);
                            }
                        }
                        t.done();
                    });
                }
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


test('delete immutable entity', function (t) {
    CLIENT.del(PACKAGE_DN, function (err) {
        t.ok(err);
        t.equal(err.name, 'NotAllowedOnRdnError');
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
