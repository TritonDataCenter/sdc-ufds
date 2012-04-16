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
var USER_DN = 'cn=child, ' + SUFFIX;
var USER = {
    email: 'modunittest@joyent.com',
    login: 'mod_unit_test',
    objectclass: 'sdcperson',
    userpassword: 'test',
    uuid: uuid()
};



///--- Helpers

function get(callback) {
    CLIENT.search(USER_DN, '(objectclass=*)', function (err, res) {
        if (err)
            return callback(err);

        var obj;

        // Clean up the entry so it's easy to do deepEquals later
        res.on('searchEntry', function (entry) {
            obj = entry.object;
            obj.userpassword = 'test';
            delete obj.dn;
            if (obj.controls)
                delete obj.controls;
        });

        res.on('error', function (err2) {
            return callback(err2);
        });

        res.on('end', function (result) {
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
        t.ifError(err);

        CLIENT.add(USER_DN, USER, function (err) {
            t.ifError(err);
            t.done();
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

        get(function (err, entry) {
            t.ifError(err);
            t.ok(entry);
            t.deepEqual(extend(USER, change.modification), entry);
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

        get(function (err, entry) {
            t.ifError(err);
            t.ok(entry);
            t.deepEqual(extend(USER, change.modification), entry);
            t.done();
        });
    });
});


test('modify delete ok', function (t) {
    var change = {
        type: 'delete',
        modification: {
            pets: false
        }
    };
    CLIENT.modify(USER_DN, change, function (err) {
        t.ifError(err);

        get(function (err, entry) {
            t.ifError(err);
            t.ok(entry);
            t.deepEqual(USER, entry);
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


test('teardown', function (t) {
    helper.cleanup(SUFFIX, function (err) {
        t.ifError(err);
        CLIENT.unbind(function (err2) {
            t.ifError(err2);
            t.done();
        });
    });
});
