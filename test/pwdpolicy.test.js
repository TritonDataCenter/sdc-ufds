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

// SDC 6.5 like imported entry, including SHA1 encrypted password, 
// 'joypass123', with salt length of 39 chars.
function importedEntry() {
    var id = uuid();
    var login = 'a' + id.substr(0, 7);
    var email = login + '_test@joyent.com';

    return {
        login: login,
        email: email,
        uuid: id,
        userpassword: 'cce3af1d9eab80fbca78a2795919cdc7cbab3136',
        _salt: '73e4f8488ac85ab542bc54f12ef55a0a429edb1',
        objectclass: 'sdcperson'
    };
}


// New entry to be added straight to UFDS, not imported from SDC 6.5 CAPI:
function newEntry() {
    var id = uuid();
    var login = 'a' + id.substr(0, 7);
    var email = login + '_test@joyent.com';

    return {
        login: login,
        email: email,
        uuid: id,
        userpassword: 'joypass123',
        objectclass: 'sdcperson'
    };
}

var IMPORTED, NOT_IMPORTED;

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

        res.on('error', function (err) {
            return callback(err);
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
});


test('CAPI Imported sdcPerson entry', function (t) {
    var entry = importedEntry();
    var dn = sprintf(DN_FMT, entry.uuid);
    CLIENT.add(dn, entry, function (err) {
        t.ifError(err, 'Imported entry error');
        getUser(entry.uuid, function (err, user) {
            t.ifError(err);
            t.equal(39, user._salt.length);
            IMPORTED = user;
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
    var entry = newEntry();
    var dn = sprintf(DN_FMT, entry.uuid);
    CLIENT.add(dn, entry, function (err) {
        t.ifError(err, 'New sdcPerson entry error');
        getUser(entry.uuid, function (err, user) {
            t.ifError(err);
            t.equal(29, user._salt.length);
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


test('teardown', function (t) {
    helper.cleanup(SUFFIX, function (err) {
        t.ifError(err);
        CLIENT.unbind(function (err2) {
            t.ifError(err2);
            t.done();
        });
    });
});
