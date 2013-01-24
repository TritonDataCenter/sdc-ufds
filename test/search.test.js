// Copyright 2012 Joyent, Inc.  All rights reserved.
//
// You can set UFDS_URL to connect to a server, and LOG_LEVEL to turn on
// bunyan debug logs.
//

var extend = require('node.extend');
var uuid = require('node-uuid');

if (require.cache[__dirname + '/helper.js'])
    delete require.cache[__dirname + '/helper.js'];
var helper = require('./helper.js');



///--- Globals

var test = helper.test;

var CLIENT;
var SUFFIX = process.env.UFDS_SUFFIX || 'o=smartdc';
var TOTAL_ENTRIES = 10;
var USERS = {};



///--- Helpers

function entryToObject(entry) {
    var obj = entry.object;
    obj.userpassword = 'test';
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
        if (err)
            return callback(err);

        var results = [];
        var retrieved = 0;
        res.on('searchEntry', function (entry) {
            if (USERS[entry.dn.toString()]) {
                results.push({
                    dn: entry.dn.toString(),
                    attributes: entryToObject(entry)
                });
            }
            retrieved++;
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
        var dn = 'login=child' + i + ', ' + SUFFIX;
        USERS[dn] = {
            uuid: uuid(),
            login: 'child' + i,
            email: 'child' + i + '@test.joyent.com',
            userpassword: 'test',
            objectclass: 'sdcperson'
        };
        CLIENT.add(dn, USERS[dn], function (err) {
            if (err)
                return callback(err);

            if (++finished === TOTAL_ENTRIES)
                return callback(null);
        });
    }
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
        t.ifError(err);
        load(function (err2) {
            t.ifError(err2);
            t.done();
        });
    });
});


test('search base objectclass=*', function (t) {
    var dn = 'login=child1, ' + SUFFIX;
    search(dn, function (err, results, count) {
        t.ifError(err);
        t.equal(count, 1);
        t.equal(results.length, 1);
        t.equal(dn, results[0].dn);
        t.deepEqual(results[0].attributes, USERS[dn]);
        t.done();

    });
});


test('search base eq filter ok', function (t) {
    var dn = 'login=child1, ' + SUFFIX;
    search(dn, '(login=child1)', function (err, results, count) {
        t.ifError(err);
        t.equal(count, 1);
        t.equal(results.length, 1);
        t.equal(dn, results[0].dn);
        t.deepEqual(results[0].attributes, USERS[dn]);
        t.done();
    });
});


test('search base eq filter no match', function (t) {
    var dn = 'login=child1, ' + SUFFIX;
    search(dn, '(login=child2)', function (err, _, count) {
        t.ifError(err);
        t.equal(count, 0);
        t.done();
    });
});


test('search sub substr filter ok', function (t) {
    search(SUFFIX, '(login=c*d*)', 'sub', function (err, results, count) {
        t.ifError(err);
        t.equal(count, TOTAL_ENTRIES);
        results.forEach(function (r) {
            t.deepEqual(r.attributes, USERS[r.dn]);
        });
        t.done();
    });
});


test('search sub wrong base', function (t) {
    search('cn=foo, ' + SUFFIX, '(login=*)', 'sub', function (err, _, count) {
        t.ifError(err);
        t.equal(count, 0);
        t.done();
    });
});


test('search sub filter no match', function (t) {
    search(SUFFIX, '(!(login=c*))', 'sub', function (err, _, count) {
        t.ifError(err);
        t.equal(count, 0);
        t.done();
    });
});


test('search sub filter ge ok', function (t) {
    search(SUFFIX, '(login>=child9)', 'sub', function (err, results, count) {
        t.ifError(err);
        t.equal(count, 1);
        results.forEach(function (r) {
            t.deepEqual(r.attributes, USERS[r.dn]);
        });
        t.done();
    });
});


test('search sub filter le ok', function (t) {
    search(SUFFIX, '(login<=child8)', 'sub', function (err, results, count) {
        t.ifError(err);
        t.equal(count, 9);
        results.forEach(function (r) {
            t.deepEqual(r.attributes, USERS[r.dn]);
        });
        t.done();
    });
});


test('search sub filter and ok', function (t) {
    var filter = '(&(login=child1)(objectclass=sdcperson))';
    search(SUFFIX, filter, 'sub', function (err, results, count) {
        t.ifError(err);
        t.equal(count, 1);
        results.forEach(function (r) {
            t.deepEqual(r.attributes, USERS[r.dn]);
        });
        t.done();
    });
});


test('search sub filter or ok', function (t) {
    var filter = '(|(login=child1)(login=child2))';
    search(SUFFIX, filter, 'sub', function (err, results, count) {
        t.ifError(err);
        t.equal(count, 2);
        results.forEach(function (r) {
            t.deepEqual(r.attributes, USERS[r.dn]);
        });
        t.done();
    });
});


test('search sub filter compound ok', function (t) {
    var filter = '(&(|(login=child1)(login=child2))(!(email=*)))';
    search(SUFFIX, filter, 'sub', function (err, _, count) {
        t.ifError(err);
        t.equal(count, 0);
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
