/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * This file defines handlers for UFDS LDAP server add operation.
 * Blacklisted email check and login validation are defined here.
 */

var assert = require('assert');
var util = require('util');
var ldap = require('ldapjs');
var vasync = require('vasync');

var common = require('./common');
var clog = require('./changelog');

var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
var LOGIN_RE = /^[a-zA-Z][a-zA-Z0-9_\.@]+$/;

///--- Handlers

function entryExists(req, res, next) {
    return req.exists(req.bucket, req.key, function (err, exists) {
        if (err) {
            return next(err);
        }

        if (exists) {
            return next(new ldap.EntryAlreadyExistsError(req.dn.toString()));
        }

        return next();
    });
}


function parentExists(req, res, next) {
    var bucket = req.bucket;
    var log = req.log;

    if (req.dn.equals(req.suffix)) {
        log.debug({
            bucket: bucket,
            key: req.key
        }, 'Adding suffix');
        return next();
    }

    var parent = req.dn.parent().toString();
    assert.ok(parent);

    return req.exists(bucket, parent, function (err, exists) {
        if (err) {
            return next(err);
        }

        if (!exists) {
            return next(new ldap.NoSuchObjectError(parent));
        }

        // Tack on an _parent attribute so future indexed requests work
        req.attributes.push(new ldap.Attribute({
            type: '_parent',
            vals: [parent]
        }));

        return next();
    });
}


function checkBlacklist(req, res, next) {
    req._entry = req.toObject().attributes;

    if (req._entry.objectclass) {
        req._entry.objectclass = req._entry.objectclass.map(function (v) {
            return v.toLowerCase();
        });
    }

    if (!req._entry.login ||
        !req._entry.email ||
        req._entry._imported ||
        (req._entry._replicated && !req.config.ufds_is_master)) {
        return next();
    }

    var key = req.config[req.suffix].blacklistRDN + ', ' + req.suffix;

    return req.get(req.bucket, key, function (err, val) {
        if (err) {
            if (err.name === 'NoSuchObjectError') {
                // No blacklist, move forward:
                return next();
            }
            return next(err);
        }

        var blacklist = val.value;
        var blacklisted = blacklist.email.some(function (x) {
            var email = req._entry.email;
            if (x === email) {
                return true;
            }
            /* JSSTYLED */
            var re = new RegExp(x.replace(/\*/, '.\*'));
            return re.test(email);
        });

        if (blacklisted) {
            return next(new ldap.ConstraintViolationError(
                        'Email address is blacklisted.'));
        }
        return next();
    });
}


function preloadAccount(req, res, next) {
    if (!req._entry.login ||
        !req._entry._parent ||
        req._entry._imported ||
        (req._entry._replicated && !req.config.ufds_is_master)) {
        return next();
    }

    var parent = req.dn.parent().toString();
    assert.ok(parent);
    var entry = req._entry;

    return req.get(req.bucket, parent, function (err, val) {
        if (err) {
            return next(err);
        }

        if (val.value.objectclass.indexOf('sdcperson') !== -1) {
            req._account = val.value;

            // Add 'sdcaccountuser' if not present yet:
            if (entry.objectclass.indexOf('sdcaccountuser') === -1) {
                var o = req.indexOf('objectclass');
                req.attributes[o].vals =
                    req.attributes[o].vals.concat('sdcaccountuser');
            }

            // Add 'account' and set it to parent UUID if not present:
            if (!entry.account || entry.account.length === 0) {
                req.attributes.push(new ldap.Attribute({
                    type: 'account',
                    vals: [req._account.uuid]
                }));
            }
        }

        return next();
    });
}


function validateLogin(req, res, next) {
    if (!req._entry.login ||
        req._entry._imported ||
        (req._entry._replicated && !req.config.ufds_is_master)) {
        return next();
    }

    var login = req._entry.login;

    if (req._account && login.indexOf('/') === 36 &&
            UUID_RE.test(login.substr(0, 36))) {
        login = login.substr(37);
    }
    // Given this will run before schema, and we do not want any "fancy"
    // character going into the following query:
    if (!LOGIN_RE.test(login)) {
        return next(new ldap.ConstraintViolationError('Login is invalid'));
    }

    var query;

    if (req._account) {
        query = util.format('select count(*) from %s where login ~* \'^%s$\'',
            req.config[req.suffix].bucket,
            (req._account.uuid + '/' + login));
    } else {
        query = util.format('select count(*) from %s where login ~* \'^%s$\'',
            req.config[req.suffix].bucket, login);
    }

    var count = 0;
    var r = req.moray.sql(query);

    r.on('record', function (rec) {
        if (rec && rec.count) {
            count = parseInt(rec.count, 10);
        }
    });

    r.once('error', function (err) {
        r.removeAllListeners('record');
        r.removeAllListeners('end');
        return next(err);
    });

    r.once('end', function () {
        if (count !== 0) {
            return next(new ldap.ConstraintViolationError(
                    'Login is already taken'));
        }
        return next();
    });
}


function scopeSubAccount(req, res, next) {
    if (!req._entry.login) {
        return next();
    }

    // We need to scope sub-users login in order to allow same login
    // to be used by sub-users of different customer accounts
    if (req._entry.login && req._account) {
        var login = req.attributes.filter(function (a) {
            return (a.type === 'login');
        })[0];

        req.addAttribute(new ldap.Attribute({
            type: 'alias',
            vals: [login.vals[0]]
        }));

        var vals = (login.vals[0].indexOf('/') === 36 &&
                    UUID_RE.test(login.vals[0].substr(0, 36))) ?
                   [login.vals[0]] : [req._account.uuid + '/' + login.vals[0]];
        delete req.attributes[req.indexOf('login')];

        req.addAttribute(new ldap.Attribute({
            type: 'login',
            vals: vals
        }));

        req._entry = req.toObject().attributes;
        // CAPI-383: Need to re-lowercase objectclass due to req._entry
        // override above:
        req._entry.objectclass = req._entry.objectclass.map(function (v) {
            return v.toLowerCase();
        });
    }

    return next();
}


// TODO: Get rid of this the day moray support multiple column unique indexes:
function validateNameUniqueness(req, res, next) {
    if (req._entry.objectclass.indexOf('sdcaccountpolicy') === -1 &&
            req._entry.objectclass.indexOf('sdcaccountrole') === -1 ||
            !req._entry.name) {
        return next();
    }

    var opts = { req_id: req.req_id, limit: 1 };
    var filter = util.format('(&(name=%s)(account=%s)(objectclass=%s))',
            req._entry.name, req._entry.account, req._entry.objectclass);
    var r = req.moray.findObjects(req.bucket, filter, opts);
    var dupe = false;
    r.once('error', function (err) {
        return next();
    });

    r.on('record', function (obj) {
        dupe = true;
    });

    r.once('end', function () {
        if (dupe) {
            return next(new ldap.ConstraintViolationError(
                    'Name is not unique'));
        } else {
            return next();
        }
    });
}


function save(req, res, next) {
    if (!req.headers) {
        req.headers = {};
    }
    req.headers['x-ufds-operation'] = 'add';

    if (!req.objects) {
        req.objects = [];
    }

    req.objects.push({
        bucket: req.bucket,
        key: req.key,
        value: req._entry,
        options: {
            etag: null
        }
    });
    return next();
}


// Add reverse index to linked 'sdcaccountpolicy' or 'sdcaccountrole'
// object classes when required:
function roleGroupReverseIndex(req, res, next) {
    if (req._entry.objectclass.indexOf('sdcaccountpolicy') === -1 &&
            req._entry.objectclass.indexOf('sdcaccountrole') === -1) {
        return next();
    }

    function loadLinked(key, cb) {
        return req.get(req.bucket, key, function (err, val, meta) {
            if (err) {
                if (err.name === 'NoSuchObjectError') {
                    return next(new ldap.NoSuchObjectError(key));
                }
                return next(err);
            }

            return cb({
                etag: val._etag,
                value: val.value
            });
        });
    }


    var oc = (req._entry.objectclass.indexOf('sdcaccountpolicy') !== -1) ?
        'sdcaccountpolicy' : 'sdcaccountrole';
    var target = (oc === 'sdcaccountpolicy') ?
                    'memberrole' : 'memberpolicy';
    var current = (oc === 'sdcaccountpolicy') ?
                    'memberpolicy' : 'memberrole';

    if (req._entry[target]) {
        vasync.forEachPipeline({
            func: function reverseIdx(t, cb) {
                loadLinked(t, function (obj) {
                    var val = obj.value;
                    if (!val[current]) {
                        val[current] = [];
                    }
                    val[current].push(req.key);
                    req.objects.push({
                        bucket: req.bucket,
                        key: t,
                        value: val,
                        options: {
                            etag: obj.etag
                        }
                    });
                    cb();
                });
            },
            inputs: req._entry[target]
        }, function (err, results) {
            if (err) {
                return next(err);
            }
            return next();
        });
    } else {
        return next();
    }
}


function commit(req, res, next) {
    // Do nothing if there's nothing to do ...
    if (!req.objects) {
        res.end();
        return next();
    }
    return req.batch(req.objects, req.headers, function (err, meta) {
        if (err) {
            return next(err);
        }
        res.end();
        return next();
    });
}

///--- Exports

module.exports = function addChain() {
    return [
        entryExists,
        parentExists,
        checkBlacklist,
        preloadAccount,
        validateLogin,
        scopeSubAccount,
        validateNameUniqueness,
        save,
        roleGroupReverseIndex,
        clog.changelog,
        commit
    ];
};
