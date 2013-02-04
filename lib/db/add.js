// Copyright 2013 Joyent, Inc.  All rights reserved.

var assert = require('assert');

var ldap = require('ldapjs');

var common = require('./common');



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
            key: req.key}, 'Adding suffix');
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

    if (!req._entry.login || !req._entry.email || req._entry._imported) {
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


function save(req, res, next) {
    var opts = {
        headers: {
            'x-ufds-operation': 'add'
        }
    };
    return req.put(req.bucket, req.key, req._entry, opts, function (err) {
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
        save
    ];
};
