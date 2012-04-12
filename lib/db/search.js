// Copyright 2012 Joyent, Inc.  All rights reserved.

var ldap = require('ldapjs');



///--- Handlers


// function _send(req, res, dn, entry) {
// }

// function send(req, res, dn, entry, callback) {
//     var log = req.log;

//     if (typeof(req.searchCallback) !== 'function') {
//         _send(req, res, dn, entry);
//         return callback(null);
//     }

//     log.debug('searchCallback registered, calling with %j', obj);
//     return req.searchCallback(req, dn, entry, function(err, _obj) {
//         if (err) {
//             log.warn({
//                 dn: req.dn.toString(),
//                 err: err
//             }, 'searchCallback failed. Sending original entry.');
//         }

//         return _send(req, res, dn, _obj || obj, callback);
//     });
// }


function compareDN(dn1, dn2) {
    if (dn1.parentOf(dn2) || dn2.parentOf(dn1))
        return dn2.rdns.length - dn1.rdns.length;

    if (dn1.equals(dn2))
        return 0;

    return false;
}

function base(req, res, next) {
    if (req.scope !== 'base')
        return next();

    return req.get(req.bucket, req.key, function (err, obj) {
        if (err)
            return next(err);

        if (req.filter.matches(obj)) {
            res.send({
                dn: req.dn,
                attributes: obj
            });
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
                });
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
            if (compareDN(dn, _dn) >= 0 && filter.matches(result[k])) {
                res.send({
                    dn: k,
                    attributes: result[k]
                });
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
