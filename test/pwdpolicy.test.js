// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// See helper.js for customization options.
//

var ldap = require('ldapjs');
var util = require('util');
var sprintf = util.format;
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
            t.ok(user._salt.length !== 29);
            IMPORTED = user;
            t.ok(user.pwdchangedtime);
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
            if (helper.config.use_bcrypt === false) {
                t.ok(user._salt.length !== 29);
            } else {
                t.equal(29, user._salt.length);
            }
            t.ok(user.pwdchangedtime);
            NOT_IMPORTED = user;
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
            if (helper.config.use_bcrypt === false) {
                t.ok(user._salt.length !== 29);
            } else {
                t.equal(29, user._salt.length);
                t.ok(user._sha1_salt);
            }
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
            if (helper.config.use_bcrypt === false) {
                t.ok(user._salt.length !== 29);
            } else {
                t.equal(29, user._salt.length);
            }
            t.ok(user.pwdchangedtime);
            t.ok(user.pwdchangedtime > IMPORTED.pwdchangedtime);
            t.ok(user.pwdendtime);
            t.done();
        });
    });
});


test('Authenticate not imported sdcPerson entry after update', function (t) {
    var dn = sprintf(DN_FMT, NOT_IMPORTED.uuid);
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
        t.equal(err.name, 'ConstraintViolationError');
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
        t.equal(err.name, 'ConstraintViolationError');
        t.equal(err.message, 'insufficientPasswordQuality');
        entry.userpassword = '1234567890';
        CLIENT.add(dn, entry, function (er2) {
            t.ok(er2);
            t.equal(er2.name, 'ConstraintViolationError');
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
        t.equal(er1.name, 'ConstraintViolationError');
        t.equal(er1.message, 'passwordTooShort');
        change.modification.userpassword = 'withoutnumbers';
        CLIENT.modify(dn, change, function (er2) {
            t.ok(er2);
            t.equal(er2.name, 'ConstraintViolationError');
            t.equal(er2.message, 'insufficientPasswordQuality');
            change.modification.userpassword = '1234567890';
            CLIENT.modify(dn, change, function (er3) {
                t.ok(er3);
                t.equal(er3.name, 'ConstraintViolationError');
                t.equal(er3.message, 'insufficientPasswordQuality');
                t.done();
            });
        });
    });
});


test('Password history', function (t) {
    var dn = sprintf(DN_FMT, IMPORTED.uuid);
    var change = {
        type: 'replace',
        modification: {
            userpassword: 'joypass123'
        }
    };
    CLIENT.modify(dn, change, function (er1) {
        t.ok(er1);
        t.equal(er1.name, 'ConstraintViolationError');
        t.equal(er1.message, 'passwordInHistory');
        change.modification.userpassword = '123joyent';
        CLIENT.modify(dn, change, function (er2) {
            t.ok(er2);
            t.equal(er2.name, 'ConstraintViolationError');
            t.equal(er2.message, 'passwordInHistory');
            change.modification.userpassword = 'joyent123';
            CLIENT.modify(dn, change, function (er3) {
                t.ifError(er3);
                change.modification.userpassword = '123joypass';
                CLIENT.modify(dn, change, function (er4) {
                    t.ifError(er4);
                    change.modification.userpassword = 'foobar123';
                    CLIENT.modify(dn, change, function (er6) {
                        t.ifError(er6);
                        getUser(IMPORTED.uuid, function (er8, user1) {
                            // At this point, we do have exactly 4 pwd in
                            // history and the new one. We should keep the 1st
                            if (helper.config.use_bcrypt !== false) {
                                t.ok(user1._sha1_salt);
                            }
                            t.equal(pwdPolicy.pwdinhistory,
                                user1.pwdhistory.length);
                            change.modification.userpassword = '123foobar';
                            CLIENT.modify(dn, change, function (er7) {
                                t.ifError(er7);
                                getUser(IMPORTED.uuid, function (er5, user) {
                                    // And now, given we got rid of the orig.
                                    // pwd, we should also get rid of old salt:
                                    if (helper.config.use_bcrypt !== false) {
                                        t.ok(!user._sha1_salt);
                                    }
                                    t.equal(pwdPolicy.pwdinhistory,
                                        user.pwdhistory.length);
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


test('Expired password', function (t) {
    var dn = sprintf(DN_FMT, NOT_IMPORTED.uuid);
    var now = Date.now();
    var change = {
        type: 'replace',
        modification: {
            pwdendtime: [now]
        }
    };

    // Reset pwdendtime to lock account
    CLIENT.modify(dn, change, function (er1) {
        t.ifError(er1);
        CLIENT.compare(dn, 'userpassword', '123joyent', function (e2, ok, res) {
            t.ok(!e2);
            t.ok(!ok);
            t.equal(res.errorMessage, 'passwordExpired');
            CLIENT.bind(dn, '123joyent', function (er3) {
                t.ok(er3);
                t.equal(er3.name, 'InvalidCredentialsError');
                t.equal(er3.message, 'passwordExpired');
                // Reset again to unlock:
                change = {
                    type: 'replace',
                    modification: {
                        pwdendtime: [now + (pwdPolicy.pwdmaxage * 1000)]
                    }
                };
                CLIENT.modify(dn, change, function (er4) {
                    t.ifError(er4);
                    CLIENT.compare(dn, 'userpassword', '123joyent',
                        function (er5, ok2, res2) {
                        t.ifError(er5);
                        t.ok(ok2);
                        t.done();
                    });
                });
            });
        });
    });
});


test('Failed login attempts', function (t) {

    //'123foobar' is the right password here
    var dn = sprintf(DN_FMT, IMPORTED.uuid);
    function compare(te, cb) {
        CLIENT.compare(dn, 'userpassword', '123joyent',
            function (err, ok, res) {
                te.ok(!err, 'compare error');
                te.ok(!ok, 'compare ok');
                te.equal(res.errorMessage, 'invalidPassword', 'compare msg');
                cb();
            });
    }

    var change = {
        type: 'replace',
        modification: {
            userpassword: 'joypass123'
        }
    };


    compare(t, function () {
        getUser(IMPORTED.uuid, function (e1, u1) {
            t.ifError(e1, 'get user err');
            t.ok(u1.pwdfailuretime, 'pwd failure time ok');
            compare(t, function () {
                getUser(IMPORTED.uuid, function (e2, u2) {
                    t.ifError(e2, 'get user err 2');
                    t.ok(u2.pwdfailuretime, 'pwd failure time ok 2');
                    t.equal(2, u2.pwdfailuretime.length, 'u2 length');
                    compare(t, function () {
                        compare(t, function () {
                            compare(t, function () {
                                compare(t, function () {
                                    getUser(IMPORTED.uuid, function (e3, u3) {
                                        t.ifError(e3, 'get user err 3');
                                        t.ok(u3.pwdfailuretime, 'fail time 3');
                                        t.equal(6, u3.pwdfailuretime.length);
                                        // Too much nesting for 80 chars lines:
                                        /* BEGIN JSSTYLED */
                                        CLIENT.bind(dn, '123joyent', function (err1) {
                                            t.ok(err1, 'bind error');
                                            t.equal(err1.name, 'InvalidCredentialsError', 'err name');
                                            CLIENT.compare(dn, 'userpassword', '123joyent', function (err, ok, res) {
                                                t.ok(!err, 'compare error');
                                                t.ok(!ok, 'compare not ok');
                                                t.equal(res.errorMessage, 'accountLocked', 'compare message');
                                                CLIENT.modify(dn, change, function (e4) {
                                                    t.ifError(e4);
                                                    getUser(IMPORTED.uuid, function (e5, u5) {
                                                        t.ifError(e5);
                                                        t.ok(!u5.pwdfailuretime);
                                                        t.ok(!u5.pwdaccountlockedtime);
                                                        t.done();
                                                    });
                                                });
                                            });
                                        });
                                        /* END JSSTYLED */
                                    });
                                });
                            });
                        });
                    });
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
