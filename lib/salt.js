// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var crypto = require('crypto');

var ldap = require('ldapjs');



///--- API

function saltPassword(password, salt) {
    assert.equal(typeof (password), 'string');

    if (salt === undefined) {
        salt = '';
        // 20 is the backwards-compat salt length of CAPI
        var rand = crypto.randomBytes(20);
        for (var i = 0; i < rand.length; i++)
            salt += rand[i].toString(16);
    }

    var hash = crypto.createHash('sha1');
    hash.update('--');
    hash.update(salt);
    hash.update('--');
    hash.update(password);
    hash.update('--');

    return {
        password: hash.digest('hex'),
        salt: salt
    };
}


function loadSalt(req, callback) {
    return req.get(req.bucket, req.key, function (err, val) {
        if (err)
            return callback(err);

        if (!val._salt)
            return callback(new ldap.NoSuchAttributeError('salt'));

        return callback(null, val._salt[0], val);
    });
}


function add(req, res, next) {
    var entry = req.toObject().attributes;
    if (!entry.userpassword || entry.userpassword.length === 0)
        return next();

    var salted = saltPassword(entry.userpassword[0]);
    req.addAttribute(new ldap.Attribute({
        type: '_salt',
        vals: [salted.salt]
    }));

    // attrs are sorted on the wire, so userPassword will be closer to tail
    for (var i = req.attributes.length - 1; i >= 0; i--) {
        if (req.attributes[i].type === 'userpassword') {
            req.attributes[i] = new ldap.Attribute({
                type: 'userpassword',
                vals: [salted.password]
            });
            break;
        }
    }

    return next();
}


function bind(req, res, next) {
    return loadSalt(req, function (err, salt, entry) {
        if (err)
            return next(err);

        req.credentials = saltPassword(req.credentials, salt).password;
        req._entry = entry;
        return next();
    });
}


function compare(req, res, next) {
    if (req.attribute !== 'userpassword')
        return next();

    return loadSalt(req, function (err, salt, entry) {
        if (err)
            return next(err);

        req.value = saltPassword(req.value, salt).password;
        req._entry = entry;
        return next();
    });
}


function modify(req, res, next) {
    var toSalt = false;

    // attrs are sorted on the wire, so userPassword will be closer to tail
    for (var i = req.changes.length - 1; i >= 0; i--) {
        var c = req.changes[i];
        if (c.operation !== 'delete' &&
            c.modification.type === 'userpassword') {
            toSalt = true;
            break;
        }
    }

    if (!toSalt)
        return next();

    return loadSalt(req, function (err, salt, entry) {
        if (err)
            return next(err);

        var orig = req.changes[i]._modification.vals[0];
        req.changes[i].modification = {
            userpassword: saltPassword(orig, salt).password
        };
        return next();
    });
}


function search(req, res, next) {
    if (!req.hidden)
        res.notAttributes.push('userpassword');

    return next();
}



///--- Exports

module.exports = {

    bind: bind,

    add: add,

    compare: compare,

    modify: modify,

    search: search

};
