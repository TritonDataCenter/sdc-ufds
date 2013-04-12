// Copyright 2013 Joyent, Inc.  All rights reserved.
//

var path = require('path');
var util = require('util');
// Just to avoid rewriting here the saltPassword(SHA1) functions:
var salt = require('../../lib/salt');

var h = path.resolve(__dirname, '../helper.js');

if (require.cache[h]) {
    delete require.cache[h];
}
var helper = require('../helper.js');
var uuid = require('node-uuid');

///--- Globals
var test = helper.test;
var CAPI;
var SUFFIX = process.env.UFDS_SUFFIX || 'o=smartdc';

var DUP_ID = uuid();
var DUP_LOGIN = 'a' + DUP_ID.substr(0, 7);
var DUP_EMAIL = DUP_LOGIN + '_test@joyent.com';
var CUSTOMER;
///--- Tests

test('setup', function (t) {
    helper.createCAPICLient(function (client) {
        t.ok(client);
        CAPI = client;
        t.done();
    });
});


test('list customers', function (t) {
    CAPI.get('/customers', function (err, req, res, obj) {
        t.ifError(err);
        t.ok(obj);
        t.ok(Array.isArray(obj));
        t.ok(obj.length);
        t.done();
    });
});


test('create customer (missing login)', function (t) {
    CAPI.post('/customers', {
        email_address: DUP_EMAIL,
        password: 'sup3rs3cr3t',
        password_confirmation: 'sup3rs3cr3t'
    }, function (err, req, res, obj) {
        t.ok(err);
        t.equal(res.statusCode, 409);
        t.ok(obj.errors);
        t.ok(/login/.test(obj.errors[0]));
        t.done();
    });
});


test('create customer (missing email)', function (t) {
    CAPI.post('/customers', {
        login: DUP_LOGIN,
        password: 'sup3rs3cr3t',
        password_confirmation: 'sup3rs3cr3t'
    }, function (err, req, res, obj) {
        t.ok(err);
        t.equal(res.statusCode, 409);
        t.ok(obj.errors);
        t.ok(/email_address/.test(obj.errors[0]));
        t.done();
    });
});


test('create customer (password confirmation missmatch)', function (t) {
    CAPI.post('/customers', {
        login: DUP_LOGIN,
        email_address: DUP_EMAIL,
        password: 'sup3rs3cr3t',
        password_confirmation: 'what3v3r3ls3'
    }, function (err, req, res, obj) {
        t.ok(err);
        t.equal(res.statusCode, 409);
        t.ok(obj.errors);
        t.ok(/password confirmation/.test(obj.errors[0]));
        t.done();
    });
});


test('create customer', function (t) {
    CAPI.post('/customers', {
        login: DUP_LOGIN,
        email_address: DUP_EMAIL,
        password: 'sup3rs3cr3t',
        role: '2'
    }, function (err, req, res, obj) {
        t.ifError(err);
        t.ok(obj);
        t.equal(obj.login, DUP_LOGIN);
        t.equal(obj.email_address, DUP_EMAIL);
        CUSTOMER = obj;
        t.done();
    });
});


test('create customer (duplicated login)', function (t) {
    CAPI.post('/customers', {
        login: DUP_LOGIN,
        email_address: DUP_EMAIL,
        password: 'sup3rs3cr3t'
    }, function (err, req, res, obj) {
        t.ok(err);
        t.equal(res.statusCode, 409);
        t.ok(obj.errors);
        t.ok(/login/.test(obj.errors[0]));
        t.ok(/already exists/.test(obj.errors[0]));
        t.done();
    });
});


test('get customer', function (t) {
    CAPI.get('/customers/' + CUSTOMER.uuid, function (err, req, res, obj) {
        t.ifError(err);
        t.ok(obj);
        t.equal(CUSTOMER.login, obj.login);
        t.done();
    });
});


test('get customer (404)', function (t) {
    CAPI.get('/customers/' + CUSTOMER.login, function (err, req, res, obj) {
        t.ok(err);
        t.equal(res.statusCode, 404);
        t.done();
    });
});

// FIXME: It is pending to make PUT /customers/:uuid to return admin role OK.
test('update customer', function (t) {
    CAPI.put('/customers/' + CUSTOMER.uuid, {
        first_name: 'Victor',
        last_name: 'Von Doom',
        country: 'Latveria'
    }, function (err, req, res, obj) {
        t.ifError(err);
        t.ok(obj);
        t.equal(CUSTOMER.login, obj.login);
        t.equal(obj.first_name, 'Victor');
        t.equal(obj.last_name, 'Von Doom');
        t.equal(obj.country, 'Latveria');
        t.done();
    });
});


// --- SSH KEYS:
var KEYS_PATH = '/customers/%s/keys';
var KEY_PATH = KEYS_PATH + '/%s';
var KEY;
var SSH_KEY_ONE = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDY2qV5e2q8qb+kYtn' +
'pvRxC5PM6aqPPgWcaXn2gm4jtefGAPuJX9fIkz/KTRRLxdG27IMt6hBXRXvL0Gzw0H0mSUPHAbq' +
'g4TAyG3/xEHp8iLH/QIf/RwVgjoGB0MLZn7q+L4ThMDo9rIrc5CpfOm/AN9vC4w0Zzu/XpJbzjd' +
'pTXOh+vmOKkiWCzN+BJ9DvX3iei5NFiSL3rpru0j4CUjBKchUg6X7mdv42g/ZdRT9rilmEP154F' +
'X/bVsFHitmyyYgba+X90uIR8KGLFZ4eWJNPprJFnCWXrpY5bSOgcS9aWVgCoH8sqHatNKUiQpZ4' +
'Lsqr+Z4fAf4enldx/KMW91iKn whatever@wherever.local';

test('add key', function (t) {
    var p = util.format(KEYS_PATH, CUSTOMER.uuid);
    CAPI.post(p, {
        name: 'id_rsa',
        key: SSH_KEY_ONE
    }, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(201, res.statusCode);
        t.ok(obj);
        t.ok(obj.id);
        t.ok(obj.name);
        t.equal(obj.name, 'id_rsa');
        t.ok(obj.body);
        t.ok(obj.fingerprint);
        KEY = obj;
        t.done();
    });
});


test('list keys', function (t) {
    var p = util.format(KEYS_PATH, CUSTOMER.uuid);
    CAPI.get(p, function (err, req, res, obj) {
        t.ifError(err);
        t.ok(obj);
        t.ok(Array.isArray(obj));
        t.ok(obj.length);
        t.ok(obj[0]);
        t.ok(obj[0].id);
        t.ok(obj[0].name);
        t.ok(obj[0].body);
        t.ok(obj[0].fingerprint);
        t.done();
    });
});


test('get key', function (t) {
    var p = util.format(KEY_PATH, CUSTOMER.uuid, KEY.id);
    CAPI.get(p, function (err, req, res, obj) {
        t.ifError(err);
        t.ok(obj);
        t.ok(obj.id);
        t.ok(obj.name);
        t.equal(obj.name, KEY.name);
        t.ok(obj.body);
        t.ok(obj.fingerprint);
        t.done();
    });
});


test('smartlogin', function (t) {
    var p = util.format('/customers/%s/ssh_sessions', CUSTOMER.uuid);
    CAPI.post(p, {
        fingerprint: KEY.fingerprint
    }, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 201);
        t.done();
    });
});


test('update key', function (t) {
    var p = util.format(KEY_PATH, CUSTOMER.uuid, KEY.id);
    CAPI.put(p, {
        name: 'my_rsa_key'
    }, function (err, req, res, obj) {
        t.ifError(err);
        t.done();
    });
});

// --- SALT:
var SALT;
test('get salt', function (t) {
    CAPI.get('/login/' + CUSTOMER.login, function (err, req, res, obj) {
        t.ifError(err);
        t.ok(obj);
        t.ok(obj.salt);
        SALT = obj.salt;
        t.done();
    });
});


// --- LOGIN:
test('login', function (t) {
    CAPI.post('/login', {
        login: CUSTOMER.login,
        digest: salt.saltPasswordSHA1('sup3rs3cr3t', SALT).password
    }, function (err, req, res, obj) {
        t.ifError(err);
        // If login attempt fails, we'll receive an empty JSON object as
        // the response
        t.ok(obj);
        t.ok(Object.keys(obj).length !== 0);
        t.equal(obj.uuid, CUSTOMER.uuid);
        t.done();
    });
});


// --- ForgotPassword:
test('forgot password', function (t) {
    CAPI.post('/auth/forgot_password', {
        email: CUSTOMER.email_address
    }, function (err, req, res, obj) {
        t.ifError(err);
        t.ok(obj);
        t.ok(Array.isArray(obj));
        t.ok(obj.length);
        t.equal(obj[0].uuid, CUSTOMER.uuid);
        t.ok(obj[0].forgot_password_code);
        t.done();
    });
});

// --- Limits:
test('add limit', function (t) {
    var limitPath = util.format('/customers/%s/limits/%s/%s',
        CUSTOMER.uuid, 'coal', 'smartos');
    var restify = require('restify');
    var client = restify.createStringClient({
        url: CAPI.url.protocol + '//' + CAPI.url.host
    });
    client.put(limitPath, '7', function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 201);
        client.close();
        t.done();
    });
});


test('list limits', function (t) {
    var limitsPath = util.format('/customers/%s/limits', CUSTOMER.uuid);
    CAPI.get(limitsPath, function (err, req, res, obj) {
        t.ifError(err);
        t.ok(obj);
        t.ok(Array.isArray(obj));
        t.equal(obj[0].limit, 7);
        t.equal(obj[0].value, 7);
        t.done();
    });
});


test('modify limit', function (t) {
    var limitPath = util.format('/customers/%s/limits/%s/%s',
        CUSTOMER.uuid, 'coal', 'smartos');
    var restify = require('restify');
    var client = restify.createStringClient({
        url: CAPI.url.protocol + '//' + CAPI.url.host
    });
    client.put(limitPath, '14', function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        client.close();
        var limitsPath = util.format('/customers/%s/limits', CUSTOMER.uuid);
        CAPI.get(limitsPath, function (err2, req2, res2, obj2) {
            t.ifError(err2);
            t.ok(obj2);
            t.ok(Array.isArray(obj2));
            t.equal(obj2[0].limit, 14);
            t.done();
        });
    });
});


test('delete limit', function (t) {
    var limitPath = util.format('/customers/%s/limits/%s/%s',
        CUSTOMER.uuid, 'coal', 'smartos');
    CAPI.del(limitPath, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.done();
    });
});

// Or we'll raise a NotAllowedOnNonLeafError from delete customer:
test('limit cleanup', function (t) {
    var limitDn = util.format('dclimit=coal, %s',
        'uuid=' + CUSTOMER.uuid + ', ou=users, ' + SUFFIX);

    helper.createClient(function (err, client) {
        t.ifError(err);
        t.ok(client);
        client.del(limitDn, function (err1) {
            t.ifError(err1);
            client.unbind(function (err2) {
                t.ifError(err2);
                t.done();
            });
        });
    });
});


// --- Metadata:
test('add app meta key', function (t) {
    var appKeyMetaPath = util.format('/auth/customers/%s/metadata/%s/%s',
        CUSTOMER.uuid, 'myapp', 'foo');
    var restify = require('restify');
    var client = restify.createStringClient({
        url: CAPI.url.protocol + '//' + CAPI.url.host
    });
    client.put(appKeyMetaPath, 'bar', function (err, req, res, obj) {
        t.equal(res.statusCode, 201);
        client.close();
        t.done();
    });
});


test('get app meta key', function (t) {
    var appKeyMetaPath = util.format('/auth/customers/%s/metadata/%s/%s',
        CUSTOMER.uuid, 'myapp', 'foo');
    CAPI.get(appKeyMetaPath, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.equal('bar', obj);
        t.done();
    });
});


test('update app meta key', function (t) {
    var appKeyMetaPath = util.format('/auth/customers/%s/metadata/%s/%s',
        CUSTOMER.uuid, 'myapp', 'foo');
    var restify = require('restify');
    var client = restify.createStringClient({
        url: CAPI.url.protocol + '//' + CAPI.url.host
    });
    client.put(appKeyMetaPath, 'baz', function (err, req, res, obj) {
        t.equal(res.statusCode, 200);
        client.close();
        t.done();
    });
});


test('get app meta', function (t) {
    var appMetaPath = util.format('/auth/customers/%s/metadata/%s',
        CUSTOMER.uuid, 'myapp');
    CAPI.get(appMetaPath, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.ok(Array.isArray(obj));
        t.equal(obj.length, 1);
        t.equal(obj[0], 'foo');
        t.done();
    });
});


test('delete app meta key', function (t) {
    var appKeyMetaPath = util.format('/auth/customers/%s/metadata/%s/%s',
        CUSTOMER.uuid, 'myapp', 'foo');
    CAPI.del(appKeyMetaPath, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.done();
    });
});


// Or we'll raise a NotAllowedOnNonLeafError from delete customer:
test('meta cleanup', function (t) {
    var limitDn = util.format('metadata=myapp, %s',
        'uuid=' + CUSTOMER.uuid + ', ou=users, ' + SUFFIX);

    helper.createClient(function (err, client) {
        t.ifError(err);
        t.ok(client);
        client.del(limitDn, function (err1) {
            t.ifError(err1);
            client.unbind(function (err2) {
                t.ifError(err2);
                t.done();
            });
        });
    });
});


test('delete key', function (t) {
    var p = util.format(KEY_PATH, CUSTOMER.uuid, KEY.id);
    CAPI.del(p, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.done();
    });
});


test('delete customer', function (t) {
    CAPI.del('/customers/' + CUSTOMER.uuid, function (err, req, res) {
        t.ifError(err);
        t.equal(200, res.statusCode);
        t.done();
    });
});


test('teardown', function (t) {
    helper.cleanup(SUFFIX, function (err3) {
        t.ifError(err3);
        CAPI.close();
        t.done();
    });
});
