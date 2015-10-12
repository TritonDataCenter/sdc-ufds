/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var test = require('tape');
var path = require('path');
var util = require('util');
var qs = require('querystring');
// Just to avoid rewriting here the saltPassword(SHA1) functions:
var salt = require('../../lib/salt');

var h = path.resolve(__dirname, '../helper.js');

if (require.cache[h]) {
    delete require.cache[h];
}
var helper = require('../helper.js');
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}
var vasync = require('vasync');

///--- Globals
var CAPI;
var SERVER;
var UFDS_SERVER;
var SUFFIX = process.env.UFDS_SUFFIX || 'o=smartdc';

var DUP_ID = uuid();
var DUP_LOGIN = 'a' + DUP_ID.substr(0, 7);
var DUP_EMAIL = DUP_LOGIN + '_test@joyent.com';
var CUSTOMER;

var FRAUD_EMAIL = DUP_LOGIN + '_fraud_test@joyent.com';
var FRAUD_WILDCARD = '*_test@joyent.com';

var METADATA_OBJ_KEY = 'private-api-key';
var METADATA_OBJ_VAL = {
    stat: 'httpd_ops',
    uri: '/ca/customers/' + DUP_ID + '/instrumentations/1'
};

var METADATA_APP = 'portal';
var METADATA_STR_KEY = 'useMoreSecurity';
var METADATA_STR_VAL = 'secretkey=OFRVW3Z6HJ6SQZT5JRLXGV2PG5CWSQCY';
var METADATA_STR_VAL_PLAIN = 'notQueryStringParseable';

///--- Tests

test('setup', function (t) {
    vasync.pipeline({
        'funcs': [
            function createUFDS(_, cb) {
                helper.createServer(function (err, ufds) {
                    if (err) {
                        return cb(err);
                    }
                    t.ok(ufds);
                    UFDS_SERVER = ufds;
                    cb();
                });
            },
            function createServer(_, cb) {
                helper.createCAPIServer(function (err, server) {
                    if (err) {
                        return cb(err);
                    }
                    t.ok(server);
                    SERVER = server;
                    cb();
                });
            },
            function createClient(_, cb) {
                helper.createCAPIClient(function (client) {
                    t.ok(client);
                    CAPI = client;
                    cb();
                });
            }
        ]
    }, function (err, result) {
        if (err) {
            t.ifError(err);
            // Fail hard if startup isn't successful
            process.exit(1);
        }
        t.end();
    });
});


test('list customers', function (t) {
    CAPI.get('/customers', function (err, req, res, obj) {
        t.ifError(err);
        t.ok(obj);
        t.ok(Array.isArray(obj));
        t.ok(obj.length);
        t.end();
    });
});


// REVIEW: This should always return obj.errors
test('create customer (missing login)', function (t) {
    CAPI.post('/customers', {
        email_address: DUP_EMAIL,
        password: 'sup3rs3cr3t',
        password_confirmation: 'sup3rs3cr3t'
    }, function (err, req, res, obj) {
        t.ok(err);
        t.equal(res.statusCode, 409);
        t.ok(obj.errors);
        if (obj.errors) {
            t.ok(/login/.test(obj.errors[0]), 'obj errors ok');
        }
        t.end();
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
        t.end();
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
        t.end();
    });
});


test('create customer', function (t) {
    CAPI.post('/customers', {
        login: DUP_LOGIN,
        email_address: DUP_EMAIL,
        password: 'sup3rs3cr3t',
        role: '2',
        approved_for_provisioning: true,
        first_name: 'Reed',
        last_name: 'Richards'
    }, function (err, req, res, obj) {
        t.ifError(err);
        t.ok(obj);
        t.equal(obj.login, DUP_LOGIN);
        t.equal(obj.email_address, DUP_EMAIL);
        t.ok(obj.first_name);
        t.ok(obj.last_name);
        t.ok(obj.approved_for_provisioning);
        t.ok(obj.created_at);
        t.ok(obj.updated_at);
        t.ok(obj.forgot_password_code);
        CUSTOMER = obj;
        t.end();
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
        t.ok(/login/i.test(obj.errors[0]));
        t.ok(/already taken/.test(obj.errors[0]));
        t.end();
    });
});


test('get customer', function (t) {
    CAPI.get('/customers/' + CUSTOMER.uuid, function (err, req, res, obj) {
        t.ifError(err);
        t.ok(obj);
        t.equal(CUSTOMER.login, obj.login);
        t.ok(obj.approved_for_provisioning);
        t.end();
    });
});

// CAPI-233: Missing /customers/:uuid/forgot_password route
test('customer forgot_password', function (t) {
    var p = '/customers/' + CUSTOMER.uuid + '/forgot_password';
    CAPI.put(p, {}, function (err, req, res, obj) {
        t.ifError(err, 'forgot password error');
        t.ok(obj, 'forgot password response');
        t.equal(CUSTOMER.login, obj.login, 'forgot pwd login');
        t.ok(obj.forgot_password_code, 'forgot pwd code');
        t.end();
    });
});

test('get customer (404)', function (t) {
    CAPI.get('/customers/' + CUSTOMER.login, function (err, req, res, obj) {
        t.ok(err);
        t.equal(res.statusCode, 404);
        t.end();
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
        t.end();
    });
});


// --- SALT:
var SALT;
test('get salt', function (t) {
    CAPI.get('/login/' + CUSTOMER.login, function (err, req, res, obj) {
        t.ifError(err, 'get salt error');
        t.ok(obj, 'get salt response');
        t.ok(obj.salt, 'get salt salt');
        SALT = obj.salt;
        t.end();
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
        t.end();
    });
});


// --- ForgotPassword:
test('forgot password', function (t) {
    CAPI.post('/forgot_password', {
        email: CUSTOMER.email_address
    }, function (err, req, res, obj) {
        t.ifError(err);
        t.ok(obj);
        t.ok(Array.isArray(obj));
        t.ok(obj.length);
        t.equal(obj[0].uuid, CUSTOMER.uuid);
        t.ok(obj[0].forgot_password_code);
        t.end();
    });
});


test('forgot password unknown email', function (t) {
    CAPI.post('/forgot_password', {
        email: 'whatever@foo.net'
    }, function (err, req, res, obj) {
        t.ok(err);
        t.equal(res.statusCode, 404);
        t.end();
    });
});


test('update customer password too short', function (t) {
    CAPI.put('/customers/' + CUSTOMER.uuid, {
        password: 'foobar',
        password_confirmation: 'foobar'
    }, function (err, req, res, obj) {
        t.ok(err);
        t.equal(res.statusCode, 409);
        t.ok(obj);
        t.ok(obj.errors);
        t.ok(Array.isArray(obj.errors));
        t.equal(obj.errors[0], 'passwordTooShort');
        t.end();
    });
});


test('update customer password insuficient quality', function (t) {
    CAPI.put('/customers/' + CUSTOMER.uuid, {
        password: 'supersecret',
        password_confirmation: 'supersecret'
    }, function (err, req, res, obj) {
        t.ok(err);
        t.equal(res.statusCode, 409);
        t.ok(obj);
        t.ok(obj.errors);
        t.ok(Array.isArray(obj.errors));
        t.equal(obj.errors[0], 'insufficientPasswordQuality');
        t.end();
    });
});


test('update customer password do not match', function (t) {
    CAPI.put('/customers/' + CUSTOMER.uuid, {
        password: 'supers3cret',
        password_confirmation: 'sup3rsecret'
    }, function (err, req, res, obj) {
        t.ok(err);
        t.equal(res.statusCode, 409);
        t.ok(obj.code);
        t.equal(obj.code, 'InvalidArgument');
        t.ok(obj.message);
        t.equal(obj.message, 'passwords do not match');
        t.end();
    });
});



test('update customer password', function (t) {
    CAPI.put('/customers/' + CUSTOMER.uuid, {
        password: 'supers3cret',
        password_confirmation: 'supers3cret'
    }, function (err, req, res, obj) {
        t.ifError(err);
        t.ok(obj);
        t.end();
    });
});


test('login with new password', function (t) {
    // First, we try to login with the old one, to verify it doesn't work:
    CAPI.post('/login', {
        login: CUSTOMER.login,
        digest: salt.saltPasswordSHA1('sup3rs3cr3t', SALT).password
    }, function (err, req, res, obj) {
        t.ifError(err);
        // If login attempt fails, we'll receive an empty JSON object as
        // the response
        t.ok(obj);
        t.ok(Object.keys(obj).length === 0);
        // Now with the new password
        CAPI.post('/login', {
            login: CUSTOMER.login,
            digest: salt.saltPasswordSHA1('supers3cret', SALT).password
        }, function (err2, req2, res2, obj2) {
            t.ifError(err2);
            // If login attempt fails, we'll receive an empty JSON object as
            // the response
            t.ok(obj2);
            t.ok(Object.keys(obj2).length !== 0);
            t.end();
        });
    });
});


// Searching customers, by login mostly:
test('search customer by login (positive match)', function (t) {
    var u = util.format('/customers?login=%s', CUSTOMER.login);
    CAPI.get(u, function (err, req, res, obj) {
        t.ifError(err);
        t.ok(obj);
        t.ok(Array.isArray(obj));
        t.ok(obj.length);
        t.equal(obj[0].login, CUSTOMER.login);
        t.equal(obj[0].role, CUSTOMER.role);
        t.end();
    });
});


test('search customer by login (negative match)', function (t) {
    var id = uuid();
    var login = 'a' + id.substr(0, 7);
    var u = util.format('/customers?login=%s', login);
    CAPI.get(u, function (err, req, res, obj) {
        t.ifError(err);
        t.ok(obj);
        t.ok(Array.isArray(obj));
        t.ok(!obj.length);
        t.end();
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
var KEY_FP_MD5 = 'e6:c1:1a:0f:5d:88:a1:75:10:30:85:0e:28:28:ff:82';
var KEY_FP_SHA256 = 'SHA256:EU/VWtMieb/35Lzl/igIpeHXJzbxjnaLWuTrTyhHp/k';

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
        t.strictEqual(obj.fingerprint, KEY_FP_MD5);
        KEY = obj;
        t.end();
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
        t.end();
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
        t.end();
    });
});

test('smartlogin invalid fp', function (t) {
    var p = util.format('/customers/%s/ssh_sessions', CUSTOMER.uuid);
    CAPI.post(p, {
        fingerprint: 'asdfasdfadsfasdf'
    }, function (err, req, res, obj) {
        t.ok(err);
        t.equal(res.statusCode, 409);
        t.end();
    });
});

test('smartlogin not found md5', function (t) {
    var p = util.format('/customers/%s/ssh_sessions', CUSTOMER.uuid);
    CAPI.post(p, {
        fingerprint: KEY_FP_MD5.slice(3) + ':aa'
    }, function (err, req, res, obj) {
        t.ok(err);
        t.equal(res.statusCode, 409);
        t.end();
    });
});

test('smartlogin ok md5', function (t) {
    var p = util.format('/customers/%s/ssh_sessions', CUSTOMER.uuid);
    CAPI.post(p, {
        fingerprint: KEY_FP_MD5
    }, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 201);
        t.end();
    });
});

test('smartlogin ok sha256', function (t) {
    var p = util.format('/customers/%s/ssh_sessions', CUSTOMER.uuid);
    CAPI.post(p, {
        fingerprint: KEY_FP_SHA256
    }, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 201);
        t.end();
    });
});

test('smartlogin wrong algorithm', function (t) {
    var p = util.format('/customers/%s/ssh_sessions', CUSTOMER.uuid);
    CAPI.post(p, {
        fingerprint: KEY_FP_SHA256,
        algorithm: 'foo'
    }, function (err, req, res, obj) {
        t.ok(err);
        t.equal(res.statusCode, 409);
        t.end();
    });
});

test('smartlogin ok algorithm', function (t) {
    var p = util.format('/customers/%s/ssh_sessions', CUSTOMER.uuid);
    CAPI.post(p, {
        fingerprint: KEY_FP_SHA256,
        algorithm: 'rsa'
    }, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 201);
        t.end();
    });
});

test('update key', function (t) {
    var p = util.format(KEY_PATH, CUSTOMER.uuid, KEY.id);
    CAPI.put(p, {
        name: 'my_rsa_key'
    }, function (err, req, res, obj) {
        t.ifError(err);
        t.end();
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
        t.end();
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
        t.end();
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
            t.end();
        });
    });
});


test('delete limit', function (t) {
    var limitPath = util.format('/customers/%s/limits/%s/%s',
        CUSTOMER.uuid, 'coal', 'smartos');
    CAPI.del(limitPath, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.end();
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
                t.end();
            });
        });
    });
});


// --- Metadata:
test('add app meta key (parseable string)', function (t) {
    var appKeyMetaPath = util.format('/customers/%s/metadata/%s/%s',
        CUSTOMER.uuid, METADATA_APP, METADATA_STR_KEY);
    var restify = require('restify');
    var client = restify.createStringClient({
        url: CAPI.url.protocol + '//' + CAPI.url.host
    });
    client.put(appKeyMetaPath, METADATA_STR_VAL, function (err, req, res, obj) {
        t.equal(res.statusCode, 201);
        client.close();
        t.end();
    });
});


test('get app meta key (parseable string)', function (t) {
    var appKeyMetaPath = util.format('/customers/%s/metadata/%s/%s',
        CUSTOMER.uuid, METADATA_APP, METADATA_STR_KEY);
    CAPI.get(appKeyMetaPath, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        var orig = qs.parse(METADATA_STR_VAL);
        var vals = Object.keys(orig);
        vals.forEach(function (k) {
            t.equal(orig[k], obj[k]);
        });
        t.end();
    });
});


test('update app meta key (to plain string)', function (t) {
    var appKeyMetaPath = util.format('/customers/%s/metadata/%s/%s',
        CUSTOMER.uuid, METADATA_APP, METADATA_STR_KEY);
    var restify = require('restify');
    var client = restify.createStringClient({
        url: CAPI.url.protocol + '//' + CAPI.url.host
    });
    client.put(appKeyMetaPath, METADATA_STR_VAL_PLAIN,
        function (err, req, res, obj) {
            t.equal(res.statusCode, 200);
            client.close();
            t.end();
        });
});


test('get app meta key (string plain)', function (t) {
    var appKeyMetaPath = util.format('/customers/%s/metadata/%s/%s',
        CUSTOMER.uuid, METADATA_APP, METADATA_STR_KEY);
    CAPI.get(appKeyMetaPath, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.equal(METADATA_STR_VAL_PLAIN, obj);
        t.end();
    });
});


test('add app meta key (object)', function (t) {
    var appKeyMetaPath = util.format('/customers/%s/metadata/%s/%s',
        CUSTOMER.uuid, METADATA_APP, METADATA_OBJ_KEY);
    var restify = require('restify');
    var client = restify.createStringClient({
        url: CAPI.url.protocol + '//' + CAPI.url.host
    });
    client.put(appKeyMetaPath, METADATA_OBJ_VAL, function (err, req, res, obj) {
        t.equal(res.statusCode, 201);
        client.close();
        t.end();
    });
});


test('get app meta key (object)', function (t) {
    var appKeyMetaPath = util.format('/customers/%s/metadata/%s/%s',
        CUSTOMER.uuid, METADATA_APP, METADATA_OBJ_KEY);
    CAPI.get(appKeyMetaPath, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        var keys = Object.keys(obj);
        t.ok(keys.length);
        keys.forEach(function (k) {
            t.equal(METADATA_OBJ_VAL[k], obj[k]);
        });
        t.end();
    });
});


test('get app meta', function (t) {
    var appMetaPath = util.format('/customers/%s/metadata/%s',
        CUSTOMER.uuid, METADATA_APP);
    CAPI.get(appMetaPath, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.ok(Array.isArray(obj));
        t.equal(obj.length, 2);
        t.ok(obj.indexOf(METADATA_STR_KEY.toLowerCase()) !== -1);
        t.end();
    });
});


test('delete app meta key', function (t) {
    var appKeyMetaPath = util.format('/customers/%s/metadata/%s/%s',
        CUSTOMER.uuid, METADATA_APP, METADATA_STR_KEY);
    CAPI.del(appKeyMetaPath, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.end();
    });
});


// Or we'll raise a NotAllowedOnNonLeafError from delete customer:
test('meta cleanup', function (t) {
    var limitDn = util.format('metadata=%s, %s', METADATA_APP,
        'uuid=' + CUSTOMER.uuid + ', ou=users, ' + SUFFIX);

    helper.createClient(function (err, client) {
        t.ifError(err);
        t.ok(client);
        client.del(limitDn, function (err1) {
            t.ifError(err1);
            client.unbind(function (err2) {
                t.ifError(err2);
                t.end();
            });
        });
    });
});


// CAPI-234: Blacklist "/fraud"
//test('add email to blacklist', function (t) {
//    CAPI.post('/fraud', {email: FRAUD_EMAIL}, function (err, req, res, obj) {
//        t.ifError(err);
//        t.equal(201, res.statusCode);
//        t.ok(Array.isArray(obj));
//        t.equal(obj[obj.length - 1].email_address, FRAUD_EMAIL);
//        t.end();
//    });
//});


//test('get blacklist', function (t) {
//    CAPI.get('/fraud', function (err, req, res, obj) {
//        t.ifError(err);
//        t.equal(200, res.statusCode);
//        t.ok(Array.isArray(obj));
//        if (obj.length) {
//            t.ok(obj[0].email_address);
//            t.ok(obj[0].id);
//        }
//        t.end();
//    });
//});


//test('search email in blacklist', function (t) {
//    CAPI.get('/fraud/' + FRAUD_EMAIL, function (err, req, res, obj) {
//        t.ifError(err);
//        t.equal(200, res.statusCode);
//        t.ok(obj.email_address);
//        t.ok(obj.id);
//        t.end();
//    });
//});


//test('search email not in blacklist', function (t) {
//    CAPI.get('/fraud/' + DUP_EMAIL, function (err, req, res, obj) {
//        t.ifError(err);
//        t.equal(200, res.statusCode);
//        t.ok(obj); // it is actually a plain []
//        t.ok(!obj.email_address);
//        t.end();
//    });
//});


//test('add wildcard to blacklist', function (t) {
//    CAPI.post('/fraud',
//        {email: FRAUD_WILDCARD}, function (err, req, res, obj) {
//        t.ifError(err);
//        t.equal(201, res.statusCode);
//        t.ok(Array.isArray(obj));
//        t.equal(obj[obj.length - 1].email_address, FRAUD_WILDCARD);
//        t.end();
//    });
//});


//test('search email wildcard in blacklist', function (t) {
//    CAPI.get('/fraud/' + DUP_EMAIL, function (err, req, res, obj) {
//        t.ifError(err);
//        t.equal(200, res.statusCode);
//        t.ok(obj.email_address);
//        t.ok(obj.id);
//        t.end();
//    });
//});


// Go with clean blacklist for the next time:
//test('blacklist cleanup', function (t) {
//    helper.createClient(function (err, client) {
//        t.ifError(err);
//        t.ok(client);
//        client.del('cn=blacklist, o=smartdc', function (err1) {
//            t.ifError(err1);
//            client.unbind(function (err2) {
//                t.ifError(err2);
//                t.end();
//            });
//        });
//    });
//});


test('delete key', function (t) {
    var p = util.format(KEY_PATH, CUSTOMER.uuid, KEY.id);
    CAPI.del(p, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.end();
    });
});


test('delete customer', function (t) {
    CAPI.del('/customers/' + CUSTOMER.uuid, function (err, req, res) {
        t.ifError(err);
        t.equal(200, res.statusCode);
        t.end();
    });
});


test('teardown', function (t) {
    vasync.pipeline({
        funcs: [
            function cleanupData(_, cb) {
                helper.cleanup(SUFFIX, function (err) {
                    t.ifError(err);
                    cb(err);
                });
            },
            function destroyClient(_, cb) {
                CAPI.close();
                cb();
            },
            function destroyServer(_, cb) {
                helper.destroyCAPIServer(SERVER, cb);
            },
            function destroyUFDS(_, cb) {
                helper.destroyServer(UFDS_SERVER, cb);
            }
        ]
    }, function (err, result) {
        if (err) {
            t.ifError(err);
        }
        t.end();
    });
});
