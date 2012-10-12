// Copyright 2012 Joyent, Inc.  All rights reserved.

var ldap = require('ldapjs');



///--- Handlers


function compareDN(dn1, dn2) {
    if (dn1.parentOf(dn2) || dn2.parentOf(dn1))
        return dn2.rdns.length - dn1.rdns.length;

    if (dn1.equals(dn2))
        return 0;

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
                attributes: obj.value
            }, req.hidden);
        }

        return next();
    });
}


function one(req, res, next) {
    if (req.scope !== 'one')
        return next();

    var bucket = req.bucket;
    var dn = req.dn;
    var filter = req.filter;

    return req.search(bucket, filter.toString(), function (err, result) {
        if (err)
            return next(err);

        Object.keys(result).forEach(function (k) {
            var dist = compareDN(dn, ldap.parseDN(k));
            if (dist >= 0 && dist <= 1 && filter.matches(result[k])) {
                res.send({
                    dn: k,
                    attributes: result[k]
                }, req.hidden);
            }
        });

        return next();
    });
}


function sub(req, res, next) {
    if (req.scope !== 'sub')
        return next();

    var bucket = req.bucket;
    var dn = req.dn;
    var filter = req.filter;

    return req.search(bucket, filter.toString(), function (err, result) {
        if (err)
            return next(err);

        Object.keys(result).forEach(function (k) {
            var _dn = ldap.parseDN(k);
            // HEAD-1278: moray already performs a full ldap evaluation
            // for us, so we really just want to check the DN. Also, we don't
            // have a good facility to deal with type coercion here.
            if (compareDN(dn, _dn) >= 0) {
                res.send({
                    dn: k,
                    attributes: result[k]
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
