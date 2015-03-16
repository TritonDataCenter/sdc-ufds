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
var util = require('util');

var helper = require('./helper.js');



///--- Globals

var CLIENT;
var SERVER;
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
            t.end();
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
            t.end();
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
            t.end();
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
            t.end();
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
        t.end();
    });
});


test('modify sdcPerson UUID', function (t) {
    var change = {
        type: 'replace',
        modification: {
            uuid: uuid()
        }
    };
    CLIENT.modify(USER_DN, change, function (err) {
        t.ok(err);
        t.equal(err.name, 'ConstraintViolationError');
        t.end();
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
        CLIENT.compare(dn, 'login', login, function (err2, matches) {
            t.ifError(err2, 'Compare sub-user error');
            t.ok(matches, 'sub-user compare matches');
            CLIENT.modify(dn, change, function (err4) {
                t.ifError(err4, 'Modify sub-user error');
                CLIENT.compare(dn, 'login', modified,
                    function (err5, matches2) {
                    t.ifError(err5, 'Compare sub-user error');
                    t.ok(matches2, 'sub-user compare matches');
                    CLIENT.del(dn, function (err3) {
                        t.ifError(err3, 'Delete sub-user error');
                        t.end();
                    });
                });
            });
        });
    });
});

test('modify dclocalconfig', function (t) {
    var dn = 'dclocalconfig=coal, ' + USER_DN;
    var entry = {
        dclocalconfig: 'coal',
        defaultFabricSetup: false,
        objectclass: 'dclocalconfig'
    };
    var defaultNetwork = uuid();
    var change = {
        type: 'add',
        modification: {
            defaultNetwork: defaultNetwork
        }
    };

    CLIENT.add(dn, entry, function (err) {
        t.ifError(err, 'add dclocalconfig object');
        CLIENT.modify(dn, change, function (err2) {
            t.ifError(err2, 'dclocalconfig object modification err');
            CLIENT.compare(dn, 'defaultNetwork', defaultNetwork,
                function (err3, matches) {
                t.ifError(err3, 'dclocalconfig object comparison err');
                t.ok(matches,
                    'dclocalconfig defaultNetwork matches modification');
                CLIENT.del(dn, function (err4) {
                    t.ifError(err4, util.format('delete %s', dn));
                    t.end();
                });
            });
        });
    });
});


test('modify dclocalconfig dclocalconfig property', function (t) {
    var dn = 'dclocalconfig=coal, ' + USER_DN;
    var entry = {
        dclocalconfig: 'coal',
        defaultFabricSetup: false,
        objectclass: 'dclocalconfig'
    };
    var change = {
        type: 'replace',
        modification: {
            dclocalconfig: 'fail'
        }
    };
    CLIENT.add(dn, entry, function (err) {
        t.ifError(err, 'add dclocalconfig err');
        CLIENT.modify(dn, change, function (err2) {
            t.ok(err2, 'received err');
            if (err2) {
                t.equal(err2.name, 'ConstraintViolationError');
                CLIENT.del(dn, function (err3) {
                    t.ifError(err3, 'delete dclocalconfig err');
                    t.end();
                });
            } else {
                t.end();
            }
        });
    });
});

test('modify dclocalconfig with identical entry', function (t) {
    var dn = 'dclocalconfig=coal, ' + USER_DN;
    var entry = {
        dclocalconfig: 'coal',
        defaultFabricSetup: false,
        objectclass: 'dclocalconfig'
    };
    var change = {
        type: 'replace',
        modification: {
            dclocalconfig: 'coal'
        }
    };

    CLIENT.add(dn, entry, function (err) {
        t.ifError(err, 'add dclocalconfig object');
        CLIENT.modify(dn, change, function (err2) {
            t.ifError(err2, 'dclocalconfig object modification err');
            CLIENT.compare(dn, 'dclocalconfig', entry.dclocalconfig,
                function (err3, matches) {
                t.ifError(err3, 'dclocalconfig object comparison err');
                t.ok(matches,
                    'dclocalconfig matches modification');
                CLIENT.del(dn, function (err4) {
                    t.ifError(err4, util.format('delete %s', dn));
                    t.end();
                });
            });
        });
    });
});

test('remove fixture', function (t) {
    CLIENT.del(USER_DN, function (err) {
        t.ifError(err);
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
