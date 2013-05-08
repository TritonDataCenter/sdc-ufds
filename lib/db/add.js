// Copyright 2013 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');

var ldap = require('ldapjs');

var common = require('./common');

var clog = require('./changelog');


///--- Handlers

function entryExists(req, res, next) {
    return req.exists(req.bucket, req.key, function (err, exists) {
        if (err)
            return next(err);

        if (exists)
            return next(new ldap.EntryAlreadyExistsError(req.dn.toString()));

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
        if (err)
            return next(err);

        if (!exists)
            return next(new ldap.NoSuchObjectError(parent));

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
        req._entry._replicated) {
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


function validateLogin(req, res, next) {
    if (!req._entry.login ||
        req._entry._imported ||
        req._entry._replicated) {
        return next();
    }

    // Given this will run before schema, and we do not want any "fancy"
    // character going into the following query:
    var LOGIN_RE = /^[a-zA-Z][a-zA-Z0-9_\.@]+$/;
    if (!LOGIN_RE.test(req._entry.login)) {
        return next(new ldap.ConstraintViolationError('Login is invalid'));
    }

    var query = util.format('select count(*) from %s where login ~* \'%s\'',
            req.config[req.suffix].bucket, req._entry.login);

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
        value: req._entry
    });
    return next();
}


function commit(req, res, next) {
    // Do nothing if there's nothing to do ...
    if (!req.objects) {
        req.log.info({file: __filename, line: '129'}, 'res.end()');
        res.end();
        return next();
    }
    return req.batch(req.objects, req.headers, function (err, meta) {
        if (err) {
            return next(err);
        }
        req.log.info({file: __filename, line: '137'}, 'res.end()');
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
        validateLogin,
        save,
        clog.changelog,
        commit
    ];
};
