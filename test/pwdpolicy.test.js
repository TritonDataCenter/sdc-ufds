// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// You can set UFDS_URL to connect to a server, and LOG_LEVEL to turn on
// bunyan debug logs.
//

var ldap = require('ldapjs');
var util = require('util');
var sprintf = util.format;
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
var IMPORTED, NOT_IMPORTED;

var pwdPolicy = {
    objectclass: 'pwdPolicy',
    pwdattribute: 'userpassword',
    pwdinhistory: 4,
    pwdcheckquality: 'function checkPassword(pwd, cb) {' +
        'if (!/[a-zA-Z]+/.test(pwd) || !/[0-9]+/.test(pwd)) {' +
            'return cb(\'insufficientPasswordQuality\');' +
         '} else {' +
             'return cb(null);' +
         '}' +
    '}',
    pwdminlength: 7,
    pwdmaxfailure: 6,
    pwdlockoutduration: 1800,
    pwdmaxage: 7776000
};


function getUser(login, callback) {
    var opts = {
        scope: 'one',
        filter: sprintf('(&(objectclass=sdcperson)(|(login=%s)(uuid=%s)))',
                        login, login)
    };

    var entries;

    return CLIENT.search(SUFFIX, opts, function (err, res) {
        if (err) {
            return callback(err);
        }

        res.on('searchEntry', function (entry) {
            if (!entries) {
                entries = [];
            }

            if (util.isArray(entries)) {
                entries.push(entry.object);
            }
        });

        res.on('error', function (er2) {
            return callback(er2);
        });

        res.on('end', function () {
            return callback(null, entries ? entries[0] : null);
        });

        return false;
    });

}


///--- Tests

test('setup', function (t) {
    helper.createClient(function (err, client) {
        t.ifError(err);
        t.ok(client);
        CLIENT = client;
        var entry = {
            o: 'o=smartdc',
            objectclass: 'organization'
        };
        CLIENT.add(SUFFIX, entry, function (er1) {
            if (er1) {
                if (er1.name !== 'EntryAlreadyExistsError') {
                    t.ifError(er1);
                }
            }
            CLIENT.add('cn=pwdpolicy, ' + SUFFIX, pwdPolicy, function (er2) {
                if (er2) {
                    if (er2.name !== 'EntryAlreadyExistsError') {
                        t.ifError(er2);
                    }
                }
                t.done();
            });
        });
    });
});


test('CAPI Imported sdcPerson entry', function (t) {
    // SDC 6.5 like imported entry, including SHA1 encrypted password,
    // 'joypass123', with salt length of 39 chars.
    var id = uuid();
    var login = 'a' + id.substr(0, 7);
    var email = login + '_test@joyent.com';

    var entry = {
        login: login,
        email: email,
        uuid: id,
        userpassword: 'cce3af1d9eab80fbca78a2795919cdc7cbab3136',
        _salt: '73e4f8488ac85ab542bc54f12ef55a0a429edb1',
        objectclass: 'sdcperson'
    };

    var dn = sprintf(DN_FMT, entry.uuid);
    CLIENT.add(dn, entry, function (err) {
        t.ifError(err, 'Imported entry error');
        getUser(entry.uuid, function (er1, user) {
            t.ifError(er1);
            t.equal(39, user._salt.length);
            IMPORTED = user;
            t.ok(user.pwdchangedtime);
            console.log(util.inspect(user, false, 8));
            t.done();
        });
    });
});


test('Authenticate imported sdcPerson entry', function (t) {
    var dn = sprintf(DN_FMT, IMPORTED.uuid);
    CLIENT.compare(dn, 'userpassword', 'joypass123', function (err, ok) {
        t.ifError(err);
        t.ok(ok);
        t.done();
    });
});


test('UFDS new sdcPerson entry', function (t) {
    // New entry to be added straight to UFDS, not imported from SDC 6.5 CAPI:
    var id = uuid();
    var login = 'a' + id.substr(0, 7);
    var email = login + '_test@joyent.com';

    var entry = {
        login: login,
        email: email,
        uuid: id,
        userpassword: 'joypass123',
        objectclass: 'sdcperson'
    };

    var dn = sprintf(DN_FMT, entry.uuid);
    CLIENT.add(dn, entry, function (err) {
        t.ifError(err, 'New sdcPerson entry error');
        getUser(entry.uuid, function (er1, user) {
            t.ifError(er1);
            t.equal(29, user._salt.length);
            t.ok(user.pwdchangedtime);
            NOT_IMPORTED = user;
            console.log(util.inspect(user, false, 8));
            t.done();
        });
    });
});


test('Authenticate new sdcPerson entry', function (t) {
    var dn = sprintf(DN_FMT, NOT_IMPORTED.uuid);
    CLIENT.compare(dn, 'userpassword', 'joypass123', function (err, ok) {
        t.ifError(err);
        t.ok(ok);
        t.done();
    });
});


// New salt must be generated, given the entry salt was generated using SHA1
test('Update CAPI imported entry', function (t) {
    var dn = sprintf(DN_FMT, IMPORTED.uuid);
    var change = {
        type: 'replace',
        modification: {
            userpassword: '123joyent'
        }
    };

    CLIENT.modify(dn, change, function (er1) {
        t.ifError(er1);
        getUser(IMPORTED.uuid, function (er2, user) {
            t.ifError(er2);
            t.ok(user._sha1_salt);
            t.equal(29, user._salt.length);
            t.ok(user.pwdchangedtime);
            t.ok(user.pwdchangedtime > IMPORTED.pwdchangedtime);
            t.ok(user.pwdendtime);
            t.done();
        });
    });
});


test('Authenticate imported sdcPerson entry after update', function (t) {
    var dn = sprintf(DN_FMT, IMPORTED.uuid);
    CLIENT.compare(dn, 'userpassword', '123joyent', function (err, ok) {
        t.ifError(err);
        t.ok(ok);
        t.done();
    });
});


// New salt must not be generated
test('Update not imported entry', function (t) {
    var dn = sprintf(DN_FMT, NOT_IMPORTED.uuid);
    var change = {
        type: 'replace',
        modification: {
            userpassword: '123joyent'
        }
    };

    CLIENT.modify(dn, change, function (er1) {
        t.ifError(er1);
        getUser(NOT_IMPORTED.uuid, function (er2, user) {
            t.ifError(er2);
            t.ok(!user._sha1_salt);
            t.equal(29, user._salt.length);
            t.equal(user._salt, NOT_IMPORTED._salt);
            t.ok(user.pwdchangedtime);
            t.ok(user.pwdchangedtime > IMPORTED.pwdchangedtime);
            t.ok(user.pwdendtime);
            t.done();
        });
    });
});


test('Authenticate not imported sdcPerson entry after update', function (t) {
    var dn = sprintf(DN_FMT, IMPORTED.uuid);
    CLIENT.compare(dn, 'userpassword', '123joyent', function (err, ok) {
        t.ifError(err);
        t.ok(ok);
        t.done();
    });
});


test('Password too short not allowed', function (t) {
    var id = uuid();
    var login = 'a' + id.substr(0, 7);
    var email = login + '_test@joyent.com';

    var entry = {
        login: login,
        email: email,
        uuid: id,
        userpassword: 'joy123',
        objectclass: 'sdcperson'
    };

    var dn = sprintf(DN_FMT, entry.uuid);
    CLIENT.add(dn, entry, function (err) {
        t.ok(err);
        t.equal(err.name, 'OperationsError');
        t.equal(err.message, 'passwordTooShort');
        t.done();
    });
});


test('Passwords must contain alphanumeric chars', function (t) {
    var id = uuid();
    var login = 'a' + id.substr(0, 7);
    var email = login + '_test@joyent.com';

    var entry = {
        login: login,
        email: email,
        uuid: id,
        userpassword: 'withoutnumbers',
        objectclass: 'sdcperson'
    };

    var dn = sprintf(DN_FMT, entry.uuid);
    CLIENT.add(dn, entry, function (err) {
        t.ok(err);
        t.equal(err.name, 'OperationsError');
        t.equal(err.message, 'insufficientPasswordQuality');
        entry.userpassword = '1234567890';
        CLIENT.add(dn, entry, function (er2) {
            t.ok(er2);
            t.equal(er2.name, 'OperationsError');
            t.equal(er2.message, 'insufficientPasswordQuality');
            t.done();
        });
    });
});


test('Updated passwords quality', function (t) {
    var dn = sprintf(DN_FMT, NOT_IMPORTED.uuid);
    var change = {
        type: 'replace',
        modification: {
            userpassword: 'joy123'
        }
    };
    CLIENT.modify(dn, change, function (er1) {
        t.ok(er1);
        t.equal(er1.name, 'OperationsError');
        t.equal(er1.message, 'passwordTooShort');
        change.modification.userpassword = 'withoutnumbers';
        CLIENT.modify(dn, change, function (er2) {
            t.ok(er2);
            t.equal(er2.name, 'OperationsError');
            t.equal(er2.message, 'insufficientPasswordQuality');
            change.modification.userpassword = '1234567890';
            CLIENT.modify(dn, change, function (er3) {
                t.ok(er3);
                t.equal(er3.name, 'OperationsError');
                t.equal(er3.message, 'insufficientPasswordQuality');
                t.done();
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
