// Copyright 2014 Joyent, Inc.  All rights reserved.

var test = require('tape');
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}
var util = require('util'),
    sprintf = util.format;

if (require.cache[__dirname + '/helper.js']) {
    delete require.cache[__dirname + '/helper.js'];
}
var helper = require('./helper.js');
var ldap = require('ldapjs');


///--- Globals

var CLIENT;
var SERVER;
var SUFFIX = process.env.UFDS_SUFFIX || 'o=smartdc';
var TOTAL_ENTRIES = 10;
var USERS = {};

var ID = uuid();
var LOGIN = 'a' + ID.substr(0, 7);

///--- Helpers

function entryToObject(entry) {
    var obj = entry.object;
    obj.userpassword = 'secret123';
    delete obj.dn;
    if (obj.controls) {
        delete obj.controls;
    }
    // FIXME: Need to review why attrs. _parent and _salt are being retrieved
    // now but they weren't by the non-streaming branch.
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
    return obj;
}

function search(dn, filter, scope, callback) {
    switch (arguments.length) {
    case 2:
        callback = filter;
        filter = '(objectclass=*)';
        scope = 'base';
        break;
    case 3:
        callback = scope;
        scope = 'base';
        break;
    case 4:
        break;
    default:
        throw new Error('Invalid arguments to search');
    }

    var opts = {
        scope: scope,
        filter: filter
    };
    CLIENT.search(dn, opts, function (err, res) {
        if (err) {
            return callback(err);
        }

        var results = [];
        var retrieved = 0;
        res.on('searchEntry', function (entry) {
            if (USERS[entry.dn.toString()]) {
                results.push({
                    dn: entry.dn.toString(),
                    attributes: entryToObject(entry)
                });
                retrieved++;
            }
        });

        res.on('error', function (error) {
            return callback(error);
        });

        res.on('end', function (result) {
            return callback(null, results, retrieved);
        });
    });
}


function load(callback) {
    var finished = 0;

    for (var i = 0; i < TOTAL_ENTRIES; i++) {
        var dn = sprintf('login=%s_child' + i + ', ' + SUFFIX, LOGIN);
        USERS[dn] = {
            uuid: uuid(),
            login: sprintf('%s_child' + i, LOGIN),
            email: sprintf('%s_child' + i, LOGIN) + '@test.joyent.com',
            userpassword: 'secret123',
            objectclass: 'sdcperson'
        };
        CLIENT.add(dn, USERS[dn], function (err) {
            if (err) {
                return callback(err);
            }

            if (++finished === TOTAL_ENTRIES) {
                return callback(null);
            }
        });
    }
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
        load(function (err2) {
            t.ifError(err2);
            t.end();
        });
    });
});


test('search base objectclass=*', function (t) {
    var dn = sprintf('login=%s_child1, ' + SUFFIX, LOGIN);
    search(dn, function (err, results, count) {
        t.ifError(err);
        t.equal(count, 1);
        t.equal(results.length, 1);
        t.equal(dn, results[0].dn);
        Object.keys(USERS[dn]).forEach(function (attr) {
            t.equal(USERS[dn][attr], results[0].attributes[attr]);
        });
        t.end();

    });
});


test('search base eq filter ok', function (t) {
    var dn = sprintf('login=%s_child1, ' + SUFFIX, LOGIN);
    search(dn, sprintf('(login=%s_child1)', LOGIN),
        function (err, results, count) {
        t.ifError(err);
        t.equal(count, 1);
        t.equal(results.length, 1);
        t.equal(dn, results[0].dn);
        Object.keys(USERS[dn]).forEach(function (attr) {
            t.equal(USERS[dn][attr], results[0].attributes[attr]);
        });
        t.end();
    });
});


test('search base case sensitive search filter ok', function (t) {
    var dn = sprintf('login=%s_child1, ' + SUFFIX, LOGIN);
    search(dn, sprintf('(login=%s_child1)', 'A' + ID.substr(0, 7)),
        function (err, results, count) {
        t.ifError(err);
        t.equal(count, 0);
        t.end();
    });
});


test('search base caseIgnoreMatch filter ok', function (t) {
    var dn = sprintf('login=%s_child1, ' + SUFFIX, LOGIN);
    search(dn, sprintf('(login:caseIgnoreMatch:=%s_child1)', 'A' +
            ID.substr(0, 7)),
        function (err, results, count) {
        t.ifError(err);
        t.equal(count, 1);
        t.equal(results.length, 1);
        t.equal(dn, results[0].dn);
        Object.keys(USERS[dn]).forEach(function (attr) {
            t.equal(USERS[dn][attr], results[0].attributes[attr]);
        });
        t.end();
    });
});


test('search base eq filter no match', function (t) {
    var dn = sprintf('login=%s_child1, ' + SUFFIX, LOGIN);
    search(dn, sprintf('(login=%s_child2)', LOGIN), function (err, _, count) {
        t.ifError(err);
        t.equal(count, 0);
        t.end();
    });
});


test('search sub substr filter ok', function (t) {
    search(SUFFIX, '(login=*c*d*)', 'sub', function (err, results, count) {
        t.ifError(err);
        t.equal(count, TOTAL_ENTRIES);
        results.forEach(function (r) {
            Object.keys(USERS[r.dn]).forEach(function (attr) {
                t.equal(USERS[r.dn][attr], r.attributes[attr]);
            });
        });
        t.end();
    });
});


test('search sub substr caseIgnoreSubstringsMatch filter ok', function (t) {
    search(SUFFIX, '(login:caseIgnoreSubstringsMatch:=A*c*d*)', 'sub',
        function (err, results, count) {
        t.ifError(err);
        t.equal(count, TOTAL_ENTRIES);
        results.forEach(function (r) {
            Object.keys(USERS[r.dn]).forEach(function (attr) {
                t.equal(USERS[r.dn][attr], r.attributes[attr]);
            });
        });
        t.end();
    });
});


test('search sub substr case sensitive filter ok', function (t) {
    search(SUFFIX, '(login=A*c*d*)', 'sub', function (err, results, count) {
        t.ifError(err);
        t.equal(count, 0);
        t.end();
    });
});


test('search sub wrong base', function (t) {
    search('cn=foo, ' + SUFFIX, '(login=*)', 'sub', function (err, _, count) {
        t.ok(err);
        t.equal(err.name, 'NoSuchObjectError');
        t.end();
    });
});


test('search sub filter no match', function (t) {
    search(SUFFIX, '(!(login=*c*))', 'sub', function (err, _, count) {
        t.ifError(err);
        t.equal(count, 0);
        t.end();
    });
});


test('search sub filter ge ok', function (t) {
    search(SUFFIX, sprintf('(login>=%s_child9)', LOGIN), 'sub',
        function (err, results, count) {
        t.ifError(err);
        t.equal(count, 1);
        results.forEach(function (r) {
            Object.keys(USERS[r.dn]).forEach(function (attr) {
                t.equal(USERS[r.dn][attr], r.attributes[attr]);
            });
        });
        t.end();
    });
});


test('search sub filter le ok', function (t) {
    search(SUFFIX, sprintf('(login<=%s_child8)', LOGIN), 'sub',
        function (err, results, count) {
        t.ifError(err);
        t.equal(count, 9);
        results.forEach(function (r) {
            Object.keys(USERS[r.dn]).forEach(function (attr) {
                t.equal(USERS[r.dn][attr], r.attributes[attr]);
            });
        });
        t.end();
    });
});


test('search sub filter and ok', function (t) {
    var filter = sprintf('(&(login=%s_child1)(objectclass=sdcperson))', LOGIN);
    search(SUFFIX, filter, 'sub', function (err, results, count) {
        t.ifError(err);
        t.equal(count, 1);
        results.forEach(function (r) {
            Object.keys(USERS[r.dn]).forEach(function (attr) {
                t.equal(USERS[r.dn][attr], r.attributes[attr]);
            });
        });
        t.end();
    });
});


test('search sub filter or ok', function (t) {
    var filter = sprintf('(|(login=%s_child1)(login=%s_child2))', LOGIN,
        LOGIN);
    search(SUFFIX, filter, 'sub', function (err, results, count) {
        t.ifError(err);
        t.equal(count, 2);
        results.forEach(function (r) {
            Object.keys(USERS[r.dn]).forEach(function (attr) {
                t.equal(USERS[r.dn][attr], r.attributes[attr]);
            });
        });
        t.end();
    });
});


test('search sub filter compound ok', function (t) {
    var filter = sprintf('(&(|(login=%s_child1)(login=%s_child2))(!(email=*)))',
        LOGIN, LOGIN);
    search(SUFFIX, filter, 'sub', function (err, _, count) {
        t.ifError(err);
        t.equal(count, 0);
        t.end();
    });
});


test('changelog search', function (t) {
    CLIENT.search('cn=changelog', {
        scope: 'sub',
        filter: '(&(changenumber>=0)(changenumber<=5))'
    }, function (err, res) {
        t.ifError(err, 'changelog search error');
        var retrieved = 0;
        res.on('searchEntry', function (entry) {
            t.ok(entry.attributes);
            retrieved++;
        });

        res.on('error', function (error) {
            t.ifError(error);
        });

        res.on('end', function (result) {
            t.equal(retrieved, 5);
            t.end();
        });
    });
});


test('changelog count', function (t) {
    CLIENT.search('cn=changelogcount', {
        filter: '(&(objectclass=*))'
    }, function (err, res) {
        t.ifError(err, 'changelogcount search error');

        res.on('searchEntry', function (entry) {
            t.ok(entry.attributes);
            t.ok(entry.attributes.some(function (attr) {
                return (attr.type === 'count');
            }), 'count attr present');
        });

        res.on('error', function (error) {
            t.ifError(error);
        });

        res.on('end', function (result) {
            t.end();
        });
    });
});


test('latestchangenumber', function (t) {
    CLIENT.search('cn=latestchangenumber', {
        filter: '(&(objectclass=*))'
    }, function (err, res) {
        t.ifError(err, 'latestchangenumber search error');

        res.on('searchEntry', function (entry) {
            t.ok(entry.attributes);
            t.ok(entry.attributes.some(function (attr) {
                return (attr.type === 'count');
            }), 'count attr present');
        });

        res.on('error', function (error) {
            t.ifError(error);
            t.end();
        });

        res.on('end', function (result) {
            t.end();
        });
    });
});


// CAPI-354: sizeLimit:
test('search sizeLimit', function (t) {
    var opts = {
        scope: 'sub',
        filter: '(login=*chi*d*)',
        sizeLimit: 5
    };

    CLIENT.search(SUFFIX, opts, function (err, res) {
        t.ifError(err);

        var results = [];
        var retrieved = 0;
        res.on('searchEntry', function (entry) {
            if (USERS[entry.dn.toString()]) {
                results.push({
                    dn: entry.dn.toString(),
                    attributes: entryToObject(entry)
                });
                retrieved++;
            }
        });

        res.on('error', function (error) {
            t.ifError(error);
            t.end();
        });

        res.on('end', function (result) {
            t.equal(retrieved, opts.sizeLimit);
            t.end();
        });
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
