/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Test cases for everything related account sub-users, roles and policies.
 * See helper.js for customization options.
 */

var ldap = require('ldapjs');
var util = require('util'),
    sprintf = util.format;
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}

if (require.cache[__dirname + '/helper.js']) {
    delete require.cache[__dirname + '/helper.js'];
}
var helper = require('./helper.js');



// --- Globals

var CLIENT;
var SUFFIX = process.env.UFDS_SUFFIX || 'o=smartdc';
var DN_FMT = 'uuid=%s, ' + SUFFIX;

// Sub-users:
var SUB_DN_FMT = 'uuid=%s, uuid=%s, ' + SUFFIX;
var POLICY_DN_FMT = 'policy-uuid=%s, uuid=%s, ' + SUFFIX;
var ROLE_DN_FMT = 'role-uuid=%s, uuid=%s, ' + SUFFIX;
var RESOURCE_DN_FMT = 'resource-uuid=%s, uuid=%s, ' + SUFFIX;

var test = helper.test;

var DUP_ID = uuid();
var DUP_LOGIN = 'a' + DUP_ID.substr(0, 7);
var DUP_EMAIL = DUP_LOGIN + '_test@joyent.com';
var DUP_DN = sprintf(DN_FMT, DUP_ID);

var SUB_USER_DN, ANOTHER_SUB_USER_DN;
var _1ST_POLICY_DN, _2ND_POLICY_DN, _3RD_POLICY_DN;
var _1ST_GRP_DN, _2ND_GRP_DN, _3RD_GRP_DN;

// --- Tests

test('setup', function (t) {
    helper.createClient(function (err, client) {
        t.ifError(err);
        t.ok(client);
        CLIENT = client;
        t.done();
    });
});


test('add user', function (t) {
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


test('add sub-user', function (t) {
    var ID = uuid();
    var login = 'a' + ID.substr(0, 7);
    var EMAIL = login + '_test@joyent.com';
    var entry = {
        login: login,
        email: EMAIL,
        uuid: ID,
        userpassword: 'secret123',
        objectclass: 'sdcperson'
    };
    SUB_USER_DN = sprintf(SUB_DN_FMT, ID, DUP_ID);

    CLIENT.add(SUB_USER_DN, entry, function (err) {
        t.ifError(err);
        helper.get(CLIENT, SUB_USER_DN, function (err2, obj) {
            t.ifError(err2);
            t.equal(obj.account, DUP_ID);
            t.equal(obj.login, login);
            t.notEqual(-1, obj.objectclass.indexOf('sdcaccountuser'));
            t.done();
        });
    });
});


test('add sub-user (duplicated login outside account)', function (t) {
    // Should be perfectly valid
    var ID = uuid();
    var EMAIL = 'a' + ID.substr(0, 7) + '_test@joyent.com';
    var entry = {
        login: DUP_LOGIN,
        email: EMAIL,
        uuid: ID,
        userpassword: 'secret123',
        objectclass: 'sdcperson'
    };
    ANOTHER_SUB_USER_DN = sprintf(SUB_DN_FMT, ID, DUP_ID);

    CLIENT.add(ANOTHER_SUB_USER_DN, entry, function (err) {
        t.ifError(err);
        CLIENT.compare(ANOTHER_SUB_USER_DN, 'login', DUP_LOGIN,
            function (err2, matches) {
            t.ifError(err2);
            t.ok(matches, 'sub-user compare matches');
            t.done();
        });
    });
});


test('add sub-user (duplicated login within account)', function (t) {
    // Should not be valid
    var ID = uuid();
    var EMAIL = 'a' + ID.substr(0, 7) + '_test@joyent.com';
    var entry = {
        login: DUP_LOGIN,
        email: EMAIL,
        uuid: ID,
        userpassword: 'secret123',
        objectclass: 'sdcperson'
    };
    var dn = sprintf(SUB_DN_FMT, ID, DUP_ID);

    CLIENT.add(dn, entry, function (err) {
        t.ok(err);
        t.equal(err.name, 'ConstraintViolationError');
        t.done();
    });
});


test('add policy', function (t) {
    var policy_uuid = uuid();
    var policy = 'a' + policy_uuid.substr(0, 7);
    var entry = {
        name: policy,
        rule: 'Any string would be OK here',
        account: DUP_ID,
        description: 'This is completely optional',
        objectclass: 'sdcaccountpolicy',
        uuid: policy_uuid
    };

    _1ST_POLICY_DN = sprintf(POLICY_DN_FMT, policy_uuid, DUP_ID);

    CLIENT.add(_1ST_POLICY_DN, entry, function (err) {
        t.ifError(err);
        helper.get(CLIENT, _1ST_POLICY_DN, function (err2, obj) {
            t.ifError(err2);
            t.ok(obj);
            t.done();
        });
    });
});


test('add role with policy', function (t) {
    var role_uuid =  uuid();
    var role = 'a' + role_uuid.substr(0, 7);
    var entry = {
        name: role,
        uniquemember: SUB_USER_DN,
        account: DUP_ID,
        memberpolicy: _1ST_POLICY_DN,
        uuid: role_uuid,
        objectclass: 'sdcaccountrole'
    };

    _1ST_GRP_DN = sprintf(ROLE_DN_FMT, role_uuid, DUP_ID);

    CLIENT.add(_1ST_GRP_DN, entry, function (err) {
        t.ifError(err);
        helper.get(CLIENT, _1ST_GRP_DN, function (err2, obj) {
            t.ifError(err2);
            t.ok(obj);
            // Test reverseIndex has been added
            helper.get(CLIENT, _1ST_POLICY_DN, function (err3, obj3) {
                t.ifError(err3);
                t.ok(obj3);
                t.equal(obj3.memberrole, _1ST_GRP_DN);
                t.done();
            });
        });
    });
});

var _RESOURCE_DN;

test('add resource', function (t) {
    var res_uuid =  uuid();
    var res = '/abcd/' + res_uuid.substr(0, 7);
    var entry = {
        name: res,
        memberrole: _1ST_GRP_DN,
        account: DUP_ID,
        uuid: res_uuid,
        objectclass: 'sdcaccountresource'
    };

    _RESOURCE_DN = sprintf(RESOURCE_DN_FMT, res_uuid, DUP_ID);

    CLIENT.add(_RESOURCE_DN, entry, function (err) {
        t.ifError(err);
        helper.get(CLIENT, _RESOURCE_DN, function (err2, obj) {
            t.ifError(err2);
            t.ok(obj);
            t.done();
        });
    });
});


test('delete resource', function (t) {
    CLIENT.del(_RESOURCE_DN, function (err) {
        t.ifError(err);
        t.done();
    });
});


test('add role w/o policy', function (t) {
    var role_uuid =  uuid();
    var role = 'a' + role_uuid.substr(0, 7);
    var entry = {
        name: role,
        uniquemember: SUB_USER_DN,
        account: DUP_ID,
        uuid: role_uuid,
        objectclass: 'sdcaccountrole'
    };

    _2ND_GRP_DN = sprintf(ROLE_DN_FMT, role_uuid, DUP_ID);

    CLIENT.add(_2ND_GRP_DN, entry, function (err) {
        t.ifError(err);
        helper.get(CLIENT, _2ND_GRP_DN, function (err2, obj) {
            t.ifError(err2);
            t.ok(obj);
            t.done();
        });
    });
});


test('add member to role', function (t) {
    var change = {
        operation: 'add',
        modification: {
            uniquemember: ANOTHER_SUB_USER_DN
        }
    };

    CLIENT.modify(_2ND_GRP_DN, change, function (err) {
        t.ifError(err);
        helper.get(CLIENT, _2ND_GRP_DN, function (err2, obj) {
            t.ifError(err2);
            t.equal(2, obj.uniquemember.length);
            t.done();
        });
    });
});


test('add policy with role', function (t) {
    var policy_uuid = uuid();
    var policy = 'a' + policy_uuid.substr(0, 7);
    var entry = {
        name: policy,
        rule: 'Any string would be OK here',
        account: DUP_ID,
        description: 'This is completely optional',
        objectclass: 'sdcaccountpolicy',
        memberrole: _2ND_GRP_DN,
        uuid: policy_uuid
    };

    _2ND_POLICY_DN = sprintf(POLICY_DN_FMT, policy_uuid, DUP_ID);

    CLIENT.add(_2ND_POLICY_DN, entry, function (err) {
        t.ifError(err);
        helper.get(CLIENT, _2ND_POLICY_DN, function (err2, obj) {
            t.ifError(err2);
            t.ok(obj);
            // Test reverseIndex has been added
            helper.get(CLIENT, _2ND_GRP_DN, function (err3, obj3) {
                t.ifError(err3);
                t.ok(obj3);
                t.equal(obj3.memberpolicy, _2ND_POLICY_DN);
                t.done();
            });
        });
    });
});


test('prepare modifications', function (t) {
    var policy_uuid = uuid();
    var policy = 'a' + policy_uuid.substr(0, 7);
    var entry = {
        name: policy,
        rule: 'Any string would be OK here',
        account: DUP_ID,
        description: 'This is completely optional',
        objectclass: 'sdcaccountpolicy',
        uuid: policy_uuid
    };

    _3RD_POLICY_DN = sprintf(POLICY_DN_FMT, policy_uuid, DUP_ID);
    CLIENT.add(_3RD_POLICY_DN, entry, function (err) {
        t.ifError(err);
        helper.get(CLIENT, _3RD_POLICY_DN, function (err2, obj) {
            t.ifError(err2);
            t.ok(obj);
            var role_uuid =  uuid();
            var role = 'a' + role_uuid.substr(0, 7);
            entry = {
                name: role,
                uniquemember: SUB_USER_DN,
                account: DUP_ID,
                uuid: role_uuid,
                objectclass: 'sdcaccountrole'
            };

            _3RD_GRP_DN = sprintf(ROLE_DN_FMT, role_uuid, DUP_ID);

            CLIENT.add(_3RD_GRP_DN, entry, function (err3) {
                t.ifError(err3);
                helper.get(CLIENT, _3RD_GRP_DN, function (err4, obj2) {
                    t.ifError(err4);
                    t.ok(obj2);
                    t.done();
                });
            });
        });
    });
});


test('mod policy (changetype add)', function (t) {
    var change = {
        type: 'add',
        modification: {
            memberrole: [_1ST_GRP_DN, _2ND_GRP_DN]
        }
    };
    CLIENT.modify(_3RD_POLICY_DN, change, function (err) {
        t.ifError(err);
        helper.get(CLIENT, _3RD_POLICY_DN, function (err2, obj2) {
            t.ifError(err2);
            t.ok(obj2.memberrole.indexOf(_1ST_GRP_DN) !== -1);
            t.ok(obj2.memberrole.indexOf(_2ND_GRP_DN) !== -1);
            helper.get(CLIENT, _1ST_GRP_DN, function (err3, obj3) {
                t.ifError(err3);
                t.ok(obj3.memberpolicy.indexOf(_3RD_POLICY_DN) !== -1);
                helper.get(CLIENT, _2ND_GRP_DN, function (err4, obj4) {
                    t.ifError(err4);
                    t.ok(obj4.memberpolicy.indexOf(_3RD_POLICY_DN) !== -1);
                    t.done();
                });
            });
        });
    });
});


test('mod policy (changetype replace keep one, replace other)', function (t) {
    var change = {
        type: 'replace',
        modification: {
            memberrole: [_1ST_GRP_DN, _3RD_GRP_DN]
        }
    };
    CLIENT.modify(_3RD_POLICY_DN, change, function (err) {
        t.ifError(err);
        helper.get(CLIENT, _3RD_POLICY_DN, function (err2, obj2) {
            t.ifError(err2);
            t.ok(obj2.memberrole.indexOf(_1ST_GRP_DN) !== -1);
            t.ok(obj2.memberrole.indexOf(_2ND_GRP_DN) === -1);
            t.ok(obj2.memberrole.indexOf(_3RD_GRP_DN) !== -1);
            helper.get(CLIENT, _1ST_GRP_DN, function (err3, obj3) {
                t.ifError(err3);
                t.ok(obj3.memberpolicy.indexOf(_3RD_POLICY_DN) !== -1);
                helper.get(CLIENT, _3RD_GRP_DN, function (err4, obj4) {
                    t.ifError(err4);
                    t.ok(obj4.memberpolicy.indexOf(_3RD_POLICY_DN) !== -1);
                    helper.get(CLIENT, _2ND_GRP_DN, function (err5, obj5) {
                        t.ifError(err5);
                        t.ok(obj5.memberpolicy.indexOf(_3RD_POLICY_DN) === -1);
                        t.done();
                    });
                });
            });
        });
    });
});


test('mod policy (changetype delete with values)', function (t) {
    var change = {
        type: 'delete',
        modification: {
            memberrole: [_3RD_GRP_DN]
        }
    };
    CLIENT.modify(_3RD_POLICY_DN, change, function (err) {
        t.ifError(err);
        helper.get(CLIENT, _3RD_POLICY_DN, function (err2, obj2) {
            t.ifError(err2);
            t.ok(obj2.memberrole.indexOf(_1ST_GRP_DN) !== -1);
            t.ok(obj2.memberrole.indexOf(_3RD_GRP_DN) === -1);
            helper.get(CLIENT, _1ST_GRP_DN, function (err3, obj3) {
                t.ifError(err3);
                t.ok(obj3.memberpolicy.indexOf(_3RD_POLICY_DN) !== -1);
                helper.get(CLIENT, _3RD_GRP_DN, function (err4, obj4) {
                    t.ifError(err4);
                    t.ok(obj4.memberpolicy.indexOf(_3RD_POLICY_DN) === -1);
                    t.done();
                });
            });
        });
    });
});


test('mod policy (changetype delete w/o values)', function (t) {
    var change = {
        type: 'delete',
        modification: {
            memberrole: []
        }
    };
    CLIENT.modify(_3RD_POLICY_DN, change, function (err) {
        t.ifError(err);
        helper.get(CLIENT, _3RD_POLICY_DN, function (err2, obj2) {
            t.ifError(err2);
            t.ok(!obj2.memberrole);
            helper.get(CLIENT, _1ST_GRP_DN, function (err3, obj3) {
                t.ifError(err3);
                t.ok(obj3.memberpolicy.indexOf(_3RD_POLICY_DN) === -1);
                t.done();
            });
        });
    });
});


test('mod policy (changetype delete entry has no values)', function (t) {
    var change = {
        type: 'delete',
        modification: {
            memberrole: []
        }
    };
    CLIENT.modify(_3RD_POLICY_DN, change, function (err) {
        t.ifError(err);
        helper.get(CLIENT, _3RD_POLICY_DN, function (err2, obj2) {
            t.ifError(err2);
            t.ok(!obj2.memberrole);
            t.done();
        });
    });
});


test('mod policy (changetype replace w/o values)', function (t) {
    var change = {
        type: 'add',
        modification: {
            memberrole: [_1ST_GRP_DN, _2ND_GRP_DN]
        }
    };
    CLIENT.modify(_3RD_POLICY_DN, change, function (err) {
        t.ifError(err);
        helper.get(CLIENT, _3RD_POLICY_DN, function (err2, obj2) {
            t.ifError(err2);
            t.ok(obj2.memberrole.indexOf(_1ST_GRP_DN) !== -1);
            t.ok(obj2.memberrole.indexOf(_2ND_GRP_DN) !== -1);
            helper.get(CLIENT, _1ST_GRP_DN, function (err3, obj3) {
                t.ifError(err3);
                t.ok(obj3.memberpolicy.indexOf(_3RD_POLICY_DN) !== -1);
                helper.get(CLIENT, _2ND_GRP_DN, function (err4, obj4) {
                    t.ifError(err4);
                    t.ok(obj4.memberpolicy.indexOf(_3RD_POLICY_DN) !== -1);
                    change = {
                        type: 'replace',
                        modification: {
                            memberrole: []
                        }
                    };
                    CLIENT.modify(_3RD_POLICY_DN, change, function (err5) {
                        t.ifError(err5);
                        helper.get(CLIENT, _3RD_POLICY_DN,
                            function (err6, obj6) {
                            t.ifError(err6);
                            t.ok(!obj6.memberrole);
                            helper.get(CLIENT, _1ST_GRP_DN,
                                function (err7, obj7) {
                                t.ifError(err7);
                                t.ok(obj7.memberpolicy.indexOf(
                                        _3RD_POLICY_DN) === -1);
                                helper.get(CLIENT, _2ND_GRP_DN,
                                    function (err8, obj8) {
                                    t.ifError(err8);
                                    t.ok(obj8.memberpolicy.indexOf(
                                            _3RD_POLICY_DN) === -1);
                                    t.done();
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});


test('delete policy with roles', function (t) {
    CLIENT.del(_2ND_POLICY_DN, function (err) {
        t.ifError(err);
        // Test reverseIndex has been removed
        helper.get(CLIENT, _2ND_GRP_DN, function (err3, obj3) {
            t.ifError(err3);
            t.ok(obj3);
            t.ok(obj3.memberpolicy.indexOf(_2ND_POLICY_DN) === -1);
            t.done();
        });
    });
});


test('mod policy (with fake role)', function (t) {
    var FAKE_DN = util.format(ROLE_DN_FMT, libuuid.create(), libuuid.create());
    var change = {
        type: 'add',
        modification: {
            memberrole: [_1ST_GRP_DN, _2ND_GRP_DN, FAKE_DN]
        }
    };
    CLIENT.modify(_1ST_POLICY_DN, change, function (err) {
        t.ok(err);
        t.equal(err.name, 'NoSuchObjectError');
        t.equal(err.message, FAKE_DN);
        t.done();
    });
});


test('delete role with policies', function (t) {
    CLIENT.del(_1ST_GRP_DN, function (err) {
        t.ifError(err);
        // Test reverseIndex has been removed
        helper.get(CLIENT, _1ST_POLICY_DN, function (err3, obj3) {
            t.ifError(err3);
            t.ok(obj3);
            t.ok(obj3.memberrole.indexOf(_2ND_GRP_DN) === -1);
            t.done();
        });
    });
});


test('cleanup db', function (t) {
    CLIENT.del(_2ND_GRP_DN, function (err) {
        t.ifError(err);
        CLIENT.del(_3RD_GRP_DN, function (err1) {
            t.ifError(err1);
            CLIENT.del(_1ST_POLICY_DN, function (err2) {
                t.ifError(err2);
                CLIENT.del(_3RD_POLICY_DN, function (err3) {
                    t.ifError(err3);
                    t.done();
                });
            });
        });
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
