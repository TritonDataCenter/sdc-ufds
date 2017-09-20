/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * This file defines handlers related to sdcPerson object passwords, passwords
 * encryption using either SHA1 or Bcrypt (depending on configuration) and
 * everything related to Password Policy for all the LDAP Operations
 * supported by UFDS LDAP server.
 *
 * It also sets default values for the sdcPerson attributes "_imported"
 * (related to SDC 6.5), "created_at" and "approved_for_provisioning".
 *
 * Check the documentation password policy section for the details on the
 * meaning of each attribute (#Password-Policy-(pwdPolicy)) and search for
 * dn "cn=pwdpolicy, o=smartdc" for the concrete pwdPolicy being applied to
 * the current setup.
 */

var assert = require('assert');
var crypto = require('crypto');
var util = require('util');

var ldap = require('ldapjs');
var bcrypt = require('bcrypt');
var vasync = require('vasync');

// --- API

function saltPasswordSHA1(password, salt) {
    assert.equal(typeof (password), 'string');

    if (salt === undefined) {
        salt = '';
        // 20 is the backwards-compat salt length of CAPI
        var rand = crypto.randomBytes(20);
        var i;
        for (i = 0; i < rand.length; i += 1) {
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
        if (err) {
            return callback(err);
        }

        if (!val.value._salt) {
            return callback(new ldap.NoSuchAttributeError('salt'));
        }

        return callback(null, val.value._salt[0], val.value);
    });
}


function loadPwdPolicy(req, entry, callback) {
    // When no specific pwdPolicy is set for the given account, we want
    // the global pwdPolicy. But when we're talking about sub-users, then
    // we want to lookup for account policy before default to global.

    var arg = {
        // Set it to the default first:
        key: 'cn=pwdpolicy, ' + req.suffix
    };

    vasync.pipeline({
        arg: arg,
        funcs: [
            function checkIfAccountKeyExists(ctx, next) {
                if (req._entry && req.suffix !== req._entry._parent[0]) {
                    ctx.account_key = 'cn=pwdpolicy, ' + req._entry._parent[0];
                }

                if (!ctx.account_key) {
                    next();
                    return;
                }
                req.exists(req.bucket, ctx.account_key, function (err, exists) {
                    if (err) {
                        next(err);
                        return;
                    }

                    if (exists) {
                        ctx.key = ctx.account_key;
                    }
                    next();
                });
            },
            function getPolicyByKey(ctx, next) {
                // If it's explicitly overriden, take that value and move
                // forward:
                if (entry.pwdpolicysubentry &&
                    entry.pwdpolicysubentry.length !== 0) {
                    ctx.key = entry.pwdpolicysubentry;
                }

                req.get(req.bucket, ctx.key, function (err, val) {
                    if (err) {
                        next(err);
                        return;
                    }
                    ctx.value = val.value;
                    next();
                });
            }
        ]
    }, function pipeCb(pipeErr) {
        if (pipeErr) {
            callback(pipeErr);
            return;
        }
        callback(null, arg.value);
    });
}


function validatePassword(password, policy, callback) {
    if (policy === null) {
        return callback(null);
    }

    if (policy.pwdminlength &&
        policy.pwdminlength.length &&
        password.length < policy.pwdminlength[0]) {
        return callback(new ldap.ConstraintViolationError('passwordTooShort'));
    }

    // Should be the last one, given it's a function to eval, which will
    // return with a callback and an error message when appropriated:
    if (policy.pwdcheckquality && policy.pwdcheckquality.length) {
        var checkQuality = eval('(' + policy.pwdcheckquality[0] + ')');
        if (typeof (checkQuality) === 'function') {
            return checkQuality(password, function (err) {
                if (err) {
                    return callback(new ldap.ConstraintViolationError(err));
                }
                return callback(null);
            });
        }
    }

    return callback(null);
}


function add(req, res, next) {
    var entry = req.toObject().attributes;
    if (!entry.userpassword || entry.userpassword.length === 0) {
        next();
        return;
    }

    var now = Date.now();
    // We need the last time the password changed both, to know if a pwd
    // remains active, and to sort old passwords by time
    if (!entry.pwdchangedtime || entry.pwdchangedtime.length === 0) {
        req.attributes.push(new ldap.Attribute({
            type: 'pwdchangedtime',
            vals: [now]
        }));
    }

    // During upgrade from SDC 6.5 we already have salt and encoded password:
    if (entry._salt) {
        // We need to know we're importing an entry into some other places:
        req.attributes.push(new ldap.Attribute({
            type: '_imported',
            vals: ['true']
        }));
        next();
        return;
    }

    if (entry._replicated && !req.config.ufds_is_master) {
        next();
        return;
    }

    if (!entry.created_at || entry.created_at.length === 0) {
        req.attributes.push(new ldap.Attribute({
            type: 'created_at',
            vals: [now]
        }));
    }

    if (!entry.updated_at || entry.updated_at.length === 0) {
        req.attributes.push(new ldap.Attribute({
            type: 'updated_at',
            vals: [now]
        }));
    }

    if (!entry.approved_for_provisioning ||
            entry.approved_for_provisioning.length === 0) {
        req.attributes.push(new ldap.Attribute({
            type: 'approved_for_provisioning',
            vals: ['false']
        }));
    }

    loadPwdPolicy(req, entry, function (err, pwdPolicy) {
        if (err) {
            pwdPolicy = null;
        }

        validatePassword(entry.userpassword[0], pwdPolicy, function (er1) {
            if (er1) {
                next(er1);
                return;
            }

            var salted = (req.use_bcrypt === false) ?
                saltPasswordSHA1(entry.userpassword[0]) :
                saltPassword(entry.userpassword[0]);

            req.addAttribute(new ldap.Attribute({
                type: '_salt',
                vals: [salted.salt]
            }));
            if (pwdPolicy &&
                pwdPolicy.pwdmaxage && pwdPolicy.pwdmaxage.length) {
                req.addAttribute(new ldap.Attribute({
                    type: 'pwdendtime',
                    vals: [ now + (pwdPolicy.pwdmaxage[0] * 1000)]
                }));
            }

            // attrs are sorted on the wire,
            // so userPassword will be closer to tail
            var i;
            for (i = req.attributes.length - 1; i >= 0; i--) {
                if (req.attributes[i].type === 'userpassword') {
                    req.attributes[i] = new ldap.Attribute({
                        type: 'userpassword',
                        vals: [salted.password]
                    });
                    break;
                }
            }

            next();
            return;

        });
    });
}


function bind(req, res, next) {
    loadSalt(req, function (err, salt, entry) {
        if (err) {
            next(err);
            return;
        }

        // Check if password is expired:
        var now = Date.now();
        if (entry.pwdendtime && entry.pwdendtime.length &&
            now > entry.pwdendtime[0]) {
            next(new ldap.InvalidCredentialsError('passwordExpired'));
            return;
        }

        req.credentials = (req.use_bcrypt === false) ?
            saltPasswordSHA1(req.credentials, salt).password :
            saltPassword(req.credentials, salt).password;
        req._entry = entry;
        loadPwdPolicy(req, entry, function (er1, pwdPolicy) {
            if (er1) {
                pwdPolicy = null;
            }
            req._policy = pwdPolicy;
            next();
            return;
        });
    });
}


function compare(req, res, next) {
    if (req.attribute !== 'userpassword') {
        next();
        return;
    }

    loadSalt(req, function (err, salt, entry) {
        if (err) {
            next(err);
            return;
        }

        // Check if password is expired:
        var now = Date.now();
        if (entry.pwdendtime && entry.pwdendtime.length &&
            now > entry.pwdendtime[0]) {
            next(new ldap.CompareFalseError('passwordExpired'));
            return;
        }
        // Check if account is locked:
        if (entry.pwdaccountlockedtime && entry.pwdaccountlockedtime.length &&
            now < entry.pwdaccountlockedtime[0]) {
            next(new ldap.CompareFalseError('accountLocked'));
            return;
        }

        if (salt.length !== 29 || req.use_bcrypt === false) {
            req.value = saltPasswordSHA1(req.value, salt).password;
        } else {
            req.value = saltPassword(req.value, salt).password;
        }
        req._entry = entry;
        loadPwdPolicy(req, entry, function (er1, pwdPolicy) {
            if (er1) {
                pwdPolicy = null;
            }
            req._policy = pwdPolicy;
            next();
            return;
        });
    });
}


// When pwd is already in history, it will return an error using
//      cb(new ldap.ConstraintViolationError('passwordInHistory'));
// when it's a valid password, it will return `cb(null)` and
// will add the list of changes required for pwdHistory entry
// members to req.changes.
function checkPwdHistory(pwd, encrypted, entry, policy, req, sha1_salt, cb) {
    var changes = [];

    // We may not have sha1_salt for the most recent password:
    if (typeof (sha1_salt) === 'function') {
        cb = sha1_salt;
        sha1_salt = null;
    }

    if (sha1_salt) {
        var p = saltPasswordSHA1(pwd, sha1_salt).password;
        if (p === entry.userpassword[0]) {
            return cb(new ldap.ConstraintViolationError('passwordInHistory'));
        } else {
            changes.push(util.format(
                    '%d#1.3.6.1.4.1.1466.115.121.1.40#%d#{sha}%s',
                    entry.pwdchangedtime[0], entry.userpassword[0].length,
                    entry.userpassword[0]));
        }
    } else {

        if (encrypted === entry.userpassword[0]) {
            return cb(new ldap.ConstraintViolationError('passwordInHistory'));
        } else {
            var str = (req.use_bcrypt === false) ?
                '%d#1.3.6.1.4.1.1466.115.121.1.40#%d#{sha}%s' :
                '%d#1.3.6.1.4.1.1466.115.121.1.40#%d#{bcrypt}%s';

            changes.push(util.format(
                    str,
                    entry.pwdchangedtime[0], entry.userpassword[0].length,
                    entry.userpassword[0]));
        }
    }

    if (!entry.pwdhistory || entry.pwdhistory.length === 0) {
        req.changes.push(new ldap.Change({
            operation: 'add',
            modification: new ldap.Attribute({
                type: 'pwdhistory',
                vals: changes
            })
        }));
        return cb(null);
    }

    var h = 1;
    var history = entry.pwdhistory.map(function (x) {
        return (x.split('#'));
    }).sort(function (s, t) {
        // Reverse sort based on pwdhistory timestamp:
        var a = s[0];
        var b = t[0];
        if (a < b) {
            return 1;
        }
        if (a > b) {
            return -1;
        }
        return 0;
    });

    var i;
    for (i = 0; i < history.length; i++) {
        var algoAndPwd = history[i][3];
        /* JSSTYLED */
        var res = algoAndPwd.match(/{(sha|bcrypt)}(.*)/);
        if (res !== null) {
            var algo = res[1];
            var pass = res[2];
            var test = (algo === 'sha' && req.use_bcrypt !== false) ?
                        saltPasswordSHA1(pwd, entry._sha1_salt[0]).password :
                        encrypted;
            if (test === pass) {
                return cb(new ldap.ConstraintViolationError(
                            'passwordInHistory'));
            }
            // Increase counter for after-modify pwdhistory:
            h += 1;
            // And do not keep more than the desired number of passwords:
            if (h <= policy.pwdinhistory[0]) {
                changes.push(history[i].join('#'));
            } else {
                if (algo === 'sha' && entry._sha1_salt &&
                    entry._sha1_salt[0].length) {
                    req.changes.push(new ldap.Change({
                        operation: 'delete',
                        modification: new ldap.Attribute({
                            type: '_sha1_salt',
                            vals: null
                        })
                    }));
                }
            }
        }
    }

    req.changes.push(new ldap.Change({
        type: 'replace',
        modification: new ldap.Attribute({
            type: 'pwdhistory',
            vals: changes
        })
    }));

    return cb(null);
}


function modify(req, res, next) {
    var toSalt = false;
    // attrs are sorted on the wire, so userPassword will be closer to tail
    var i;
    for (i = req.changes.length - 1; i >= 0; i--) {
        var c = req.changes[i];
        if (c.operation !== 'delete' &&
            c.modification.type === 'userpassword') {
            toSalt = true;
            break;
        }
    }

    if (!toSalt) {
        next();
        return;
    }

    var now = Date.now();

    loadSalt(req, function (err, salt, entry) {
        if (err) {
            next(err);
            return;
        }

        if (entry._replicated && !req.config.ufds_is_master) {
            next();
            return;
        }
        var orig = req.changes[i]._modification.vals[0];

        loadPwdPolicy(req, entry, function (er0, pwdPolicy) {
            if (er0) {
                pwdPolicy = null;
            }

            validatePassword(orig, pwdPolicy, function (er1) {
                if (er1) {
                    next(er1);
                    return;
                }

                var encrypted_password;
                var sha1_salt = null;
                var bcrypted = null;
                // Legacy SHA1 salted password, need to generate a new salt and
                // store legacy salt into _sha1_salt
                if (salt.length !== 29 && req.use_bcrypt !== false) {
                    sha1_salt = salt;
                    bcrypted = saltPassword(orig);
                    encrypted_password = bcrypted.password;
                } else {
                    encrypted_password = (req.use_bcrypt === false) ?
                        saltPasswordSHA1(orig, salt).password :
                        saltPassword(orig, salt).password;
                }

                checkPwdHistory(orig,
                                encrypted_password,
                                entry,
                                pwdPolicy,
                                req,
                                sha1_salt,
                                function (er2) {
                    if (er2) {
                        next(er2);
                        return;
                    }

                    req.changes[i].modification = {
                        userpassword: encrypted_password
                    };

                    if (sha1_salt) {
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
                    }

                    req.changes.push(new ldap.Change({
                        operation: 'replace',
                        modification: new ldap.Attribute({
                            type: 'pwdchangedtime',
                            vals: [now]
                        })
                    }));

                    if (pwdPolicy &&
                        pwdPolicy.pwdmaxage && pwdPolicy.pwdmaxage.length) {
                        req.changes.push(new ldap.Change({
                            operation: 'replace',
                            modification: new ldap.Attribute({
                                type: 'pwdendtime',
                                vals: [ now +
                                        (pwdPolicy.pwdmaxage[0] * 1000)]
                            })
                        }));
                    }

                    // If the account has been locked, a password reset unlocks
                    if (entry.pwdfailuretime) {
                        req.changes.push(new ldap.Change({
                            operation: 'delete',
                            modification: new ldap.Attribute({
                                type: 'pwdfailuretime',
                                vals: null
                            })
                        }));
                    }

                    if (entry.pwdaccountlockedtime) {
                        req.changes.push(new ldap.Change({
                            operation: 'delete',
                            modification: new ldap.Attribute({
                                type: 'pwdaccountlockedtime',
                                vals: null
                            })
                        }));
                    }

                    next();
                    return;
                });
            });
        });
    });
}


function search(req, res, next) {
    if (!req.hidden) {
        res.notAttributes.push('userpassword');
    }

    return next();
}



// --- Exports

module.exports = {

    bind: bind,

    add: add,

    compare: compare,

    modify: modify,

    search: search,

    saltPassword: saltPassword,

    saltPasswordSHA1: saltPasswordSHA1

};
