/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * This file defines handlers for the UFDS server LDAP search operation.
 */

var ldap = require('ldapjs');
var util = require('util');


///--- Handlers

// Account sub-users login includes both, account UUID and login,
// need to return results w/o the UUID prefix
var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function _subUser(entry) {
    if (entry.objectclass.indexOf('sdcaccountuser') === -1) {
        return (entry);
    }

    var login = entry.login[0];

    if (login.indexOf('/') === 36 && UUID_RE.test(login.substr(0, 36))) {
        login = login.substr(37);
    }

    entry.login = [login];
    return (entry);
}


function compareDN(dn1, dn2) {
    if (dn1.parentOf(dn2) || dn2.parentOf(dn1)) {
        return dn2.rdns.length - dn1.rdns.length;
    }

    if (dn1.equals(dn2)) {
        return 0;
    }

    return -1;
}


function base(req, res, next) {
    if (req.scope !== 'base') {
        return next();
    }

    return req.get(req.bucket, req.key, function (err, obj) {
        if (err) {
            return next(err);
        }

        if (req.filter.matches(obj.value)) {
            res.send({
                dn: req.dn,
                attributes: _subUser(obj.value)
            }, req.hidden);
        }

        return next();
    });
}


function one(req, res, next) {
    if (req.scope !== 'one') {
        return next();
    }

    var bucket = req.bucket;
    var dn = req.dn;
    var clog = (req.config.changelog &&
                bucket === req.config.changelog.bucket);
    if (!clog) {
        req.filter = new ldap.AndFilter({
            filters: [
                req.filter,
                new ldap.EqualityFilter({
                    attribute: '_parent',
                    value: req.dn.toString()
                })
            ]
        });
    }
    var filter = req.filter;

    return req.search(bucket, req.filter.toString(), function (err, result) {
        if (err) {
            return next(err);
        }

        Object.keys(result).forEach(function (k) {
            var dist = compareDN(dn, ldap.parseDN(k));
            if (dist >= 0 && dist <= 1 && filter.matches(result[k])) {
                res.send({
                    dn: k,
                    attributes: _subUser(result[k])
                }, req.hidden);
            }
        });

        return next();
    });
}


function sub(req, res, next) {
    if (req.scope !== 'sub') {
        return next();
    }

    var bucket = req.bucket;
    var dn = req.dn;
    var clog = (req.config.changelog &&
                bucket === req.config.changelog.bucket);
    if (!clog) {
        req.filter = new ldap.AndFilter({
            filters: [
                req.filter,
                new ldap.SubstringFilter({
                    attribute: '_parent',
                    final: req.dn.toString()
                })
            ]
        });
    }
    var filter = req.filter;

    return req.search(bucket, filter.toString(), function (err, result) {
        if (err) {
            return next(err);
        }

        Object.keys(result).forEach(function (k) {
            var _dn = ldap.parseDN(k);
            // HEAD-1278: moray already performs a full ldap evaluation
            // for us, so we really just want to check the DN. Also, we don't
            // have a good facility to deal with type coercion here.
            if (compareDN(dn, _dn) >= 0) {
                res.send({
                    dn: k,
                    attributes: _subUser(result[k])
                }, req.hidden);
            }
        });

        return next();
    });
}


function done(req, res, next) {
    res.end();
    return next();
}


///--- Exports

module.exports = function searchChain() {
    return [base, one, sub, done];
};
