// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// See helper.js for customization options.
//

var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}
var util = require('util');

if (require.cache[__dirname + '/helper.js']) {
    delete require.cache[__dirname + '/helper.js'];
}
var helper = require('./helper.js');



///--- Globals

var test = helper.test;

var CLIENT;
var SUFFIX = process.env.UFDS_SUFFIX || 'o=smartdc';
var ID = uuid();
var USER_DN = 'cn=child, ' + SUFFIX;
var USER = {
    email: 'modunittest@joyent.com',
    login: 'mod_unit_test',
    objectclass: 'sdcperson',
    userpassword: 'test123',
    uuid: ID
};

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
    uuid: uuid(),
    objectclass: 'sdcpackage'
};

///--- Helpers

function get(callback) {
    return CLIENT.search(USER_DN, '(objectclass=*)', function (err, res) {
        if (err) {
            return callback(err);
        }

        var obj;

        // Clean up the entry so it's easy to do deepEquals later
        res.on('searchEntry', function (entry) {
            obj = entry.object;
            obj.userpassword = 'test123';
            delete obj.dn;
            if (obj.controls) {
                delete obj.controls;
            }
            // FIXME: Need to review why attrs. _parent and _salt are being
            // retrieved now but they weren't by the non-streaming branch.
            /* BEGIN JSSTYLED */
            for (var p in obj) {
                if (/^_.*/.test(p)) {
                    delete obj[p];
                }
            }
            /* END JSSTYLED */
            if (obj.pwdchangedtime) {
                delete obj.pwdchangedtime;
            }

            if (obj.pwdendtime) {
                delete obj.pwdendtime;
            }
        });

        res.on('error', function (err2) {
            return callback(err2);
        });

        return res.on('end', function (result) {
            return callback(null, obj);
        });
    });
}



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

        CLIENT.add(USER_DN, USER, function (err2) {
            t.ifError(err2);

            CLIENT.add(PACKAGE_DN, PACKAGE, function (err3) {
                if (err3) {
                    if (err3.name !== 'EntryAlreadyExistsError') {
                        t.ifError(err3);
                    }
                }
                t.done();
            });
        });
    });
});


test('modify add ok', function (t) {
    var change = {
        type: 'add',
        modification: {
            pets: ['badger', 'bear']
        }
    };
    CLIENT.modify(USER_DN, change, function (err) {
        t.ifError(err);

        get(function (err2, entry) {
            t.ifError(err2);
            t.ok(entry);
            change.modification.pets.forEach(function (pet) {
                t.ok(entry.pets.indexOf(pet) !== -1);
            });
            t.done();
        });
    });
});


test('modify replace ok', function (t) {
    var change = {
        type: 'replace',
        modification: {
            pets: 'moose'
        }
    };
    CLIENT.modify(USER_DN, change, function (err) {
        t.ifError(err);

        get(function (err2, entry) {
            t.ifError(err2);
            t.ok(entry);
            t.equal(entry.pets, change.modification.pets);
            t.done();
        });
    });
});


test('modify delete ok', function (t) {
    var change = {
        type: 'delete',
        modification: {
            pets: []
        }
    };
    CLIENT.modify(USER_DN, change, function (err) {
        t.ifError(err);

        get(function (err2, entry) {
            t.ifError(err2);
            t.ok(entry);
            t.ok(!entry.pets);
            t.done();
        });
    });
});


test('modify non-existent entry', function (t) {
    var change = {
        type: 'delete',
        modification: {
            pets: false
        }
    };
    CLIENT.modify('cn=child1,' + SUFFIX, change, function (err) {
        t.ok(err);
        t.equal(err.name, 'NoSuchObjectError');
        t.done();
    });
});


test('modify mutable attribute of entry with immutable attributes',
        function (t) {
    var change = {
        type: 'replace',
        modification: {
            active: true
        }
    };
    CLIENT.modify(PACKAGE_DN, change, function (err) {
        t.ifError(err);
        t.done();
    });
});


test('modify immutable attribute', function (t) {
    var change = {
        type: 'replace',
        modification: {
            name: 'regular'
        }
    };
    CLIENT.modify(PACKAGE_DN, change, function (err) {
        t.ok(err);
        t.equal(err.name, 'ObjectclassModsProhibitedError');
        t.done();
    });
});


test('modify sub-user login', function (t) {
    var UUID = uuid();
    var login = 'a' + ID.substr(0, 7);
    var modified = 'b' + ID.substr(0, 7);
    var EMAIL = login + '_test@joyent.com';
    var entry = {
        login: login,
        email: EMAIL,
        uuid: UUID,
        userpassword: 'secret123',
        objectclass: 'sdcperson'
    };
    var change = {
        type: 'replace',
        modification: {
            login: modified
        }
    };
    var dn = util.format('uuid=%s, ' + USER_DN, UUID);

    CLIENT.add(dn, entry, function (err) {
        t.ifError(err, 'Add sub-user error');
        CLIENT.compare(dn, 'login', ID + '/' + login, function (err2, matches) {
            t.ifError(err2, 'Compare sub-user error');
            t.ok(matches, 'sub-user compare matches');
            CLIENT.modify(dn, change, function (err4) {
                t.ifError(err4, 'Modify sub-user error');
                CLIENT.compare(dn, 'login', ID + '/' + modified,
                    function (err5, matches2) {
                    t.ifError(err5, 'Compare sub-user error');
                    t.ok(matches2, 'sub-user compare matches');
                    CLIENT.del(dn, function (err3) {
                        t.ifError(err3, 'Delete sub-user error');
                        t.done();
                    });
                });
            });
        });
    });
});


test('teardown', function (t) {
    helper.cleanup(SUFFIX, function (err) {
        t.ifError(err);
        CLIENT.del(USER_DN, function (er1) {
            t.ifError(er1);
            CLIENT.unbind(function (err3) {
                t.ifError(err3);
                t.done();
            });
        });
    });
});
