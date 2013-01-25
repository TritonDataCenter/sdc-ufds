// Copyright 2013 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var crypto = require('crypto');

var ldap = require('ldapjs');

var bcrypt = require('bcrypt');


///--- API

function saltPasswordSHA1(password, salt) {
    assert.equal(typeof (password), 'string');

    if (salt === undefined) {
        salt = '';
        // 20 is the backwards-compat salt length of CAPI
        var rand = crypto.randomBytes(20);
        for (var i = 0; i < rand.length; i++) {
            salt += rand[i].toString(16);
        }
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


function saltPassword(password, salt) {
    assert.equal(typeof (password), 'string');
    if (salt === undefined) {
        salt = bcrypt.genSaltSync(10);
    }

    return {
        password: bcrypt.hashSync(password, salt),
        salt: salt
    };
}


function loadSalt(req, callback) {
    return req.get(req.bucket, req.key, function (err, val) {
        if (err)
            return callback(err);

        if (!val.value._salt)
            return callback(new ldap.NoSuchAttributeError('salt'));

        return callback(null, val.value._salt[0], val.value);
    });
}


function loadPwdPolicy(req, entry, callback) {
    // When no specific pwdPolicy is set for the given sdcPerson, we want
    // the global pwdPolicy
    var key = (!entry.pwdpolicysubentry ||
                entry.pwdpolicysubentry.length === 0) ?
                'cn=pwdpolicy, ' + req.suffix :
                entry.pwdpolicysubentry;

    return req.get(req.bucket, key, function (err, val) {
        if (err) {
            return callback(err);
        }
        return callback(null, val.value);
    });
}


function validatePassword(password, policy, callback) {
    if (policy === null) {
        return callback(null);
    }

    if (policy.pwdminlength &&
        policy.pwdminlength.length &&
        password.length < policy.pwdminlength[0]) {
        return callback(new ldap.OperationsError('passwordTooShort'));
    }

    // Should be the last one, given it's a function to eval, which will
    // return with a callback and an error message when appropriated:
    if (policy.pwdcheckquality && policy.pwdcheckquality.length) {
        var checkQuality = eval('(' + policy.pwdcheckquality[0] + ')');
        if (typeof (checkQuality) === 'function') {
            return checkQuality(password, function (err) {
                if (err) {
                    return callback(new ldap.OperationsError(err));
                }
                return callback(null);
            });
        }
    }

    return callback(null);
}


function add(req, res, next) {
    var entry = req.toObject().attributes;
    if (!entry.userpassword || entry.userpassword.length === 0)
        return next();

    var now = Date.now();
    // We need the last time the password changed both, to know if a pwd
    // remains active, and to sort old passwords by time
    if (!entry.pwdchangedtime || entry.pwdchangedtime.length === 0) {
        req.attributes.push(new ldap.Attribute({
            type: 'pwdchangedtime',
            vals: [now]
        }));
    }

    // During upgrade from SDC 6.5 we already have salt and encoded password:
    if (entry._salt) {
        return next();
    }

    loadPwdPolicy(req, entry, function (err, pwdPolicy) {
        if (err) {
            pwdPolicy = null;
        }

        validatePassword(entry.userpassword[0], pwdPolicy, function (er1) {
            if (er1) {
                return next(er1);
            }

            var salted = saltPassword(entry.userpassword[0]);
            req.addAttribute(new ldap.Attribute({
                type: '_salt',
                vals: [salted.salt]
            }));

            if (pwdPolicy &&
                pwdPolicy.pwdmaxage &&
                pwdPolicy.pwdmaxage.length) {
                    req.addAttribute(new ldap.Attribute({
                        type: 'pwdendtime',
                        vals: [ now + (pwdPolicy.pwdmaxage[0] * 1000)]
                    }));
            }

            // attrs are sorted on the wire,
            // so userPassword will be closer to tail
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

        });
    });
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
        if (err) {
            return next(err);
        }

        if (salt.length !== 29) {
            req.value = saltPasswordSHA1(req.value, salt).password;
        } else {
            req.value = saltPassword(req.value, salt).password;
        }
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

    var now = Date.now();

    return loadSalt(req, function (err, salt, entry) {
        if (err)
            return next(err);

        var orig = req.changes[i]._modification.vals[0];

        loadPwdPolicy(req, entry, function (er0, pwdPolicy) {
            if (er0) {
                pwdPolicy = null;
            }

            validatePassword(orig, pwdPolicy, function (er1) {
                if (er1) {
                    return next(er1);
                }

                // Legacy SHA1 salted password, need to generate a new salt and
                // store legacy salt into _sha1_salt
                if (salt.length !== 29) {
                    var sha1_salt = salt;
                    var bcrypted = saltPassword(orig);
                    req.changes[i].modification = {
                        userpassword: bcrypted.password
                    };

                    req.changes.push(new ldap.Change({
                        operation: 'replace',
                        modification: new ldap.Attribute({
                            type: '_salt',
                            vals: [bcrypted.salt]
                        })
                    }));

                    req.changes.push(new ldap.Change({
                        operation: 'add',
                        modification: new ldap.Attribute({
                            type: '_sha1_salt',
                            vals: [sha1_salt]
                        })
                    }));

                } else {
                    req.changes[i].modification = {
                        userpassword: saltPassword(orig, salt).password
                    };
                }

                req.changes.push(new ldap.Change({
                    operation: 'replace',
                    modification: new ldap.Attribute({
                        type: 'pwdchangedtime',
                        vals: [now]
                    })
                }));

                if (pwdPolicy &&
                    pwdPolicy.pwdmaxage &&
                    pwdPolicy.pwdmaxage.length) {
                        req.changes.push(new ldap.Change({
                            operation: 'replace',
                            modification: new ldap.Attribute({
                                type: 'pwdendtime',
                                vals: [ now + (pwdPolicy.pwdmaxage[0] * 1000)]
                            })
                        }));
                }

                return next();

            });
        });
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
