// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var sprintf = require('util').format;

var ldap = require('ldapjs');

var common = require('./common');



///--- Globals

var NotAllowedOnNonLeafError = ldap.NotAllowedOnNonLeafError;



///--- Handlers

function entryExists(req, res, next) {
    return req.exists(req.bucket, req.key, function (err, exists) {
        if (err)
            return next(err);

        if (!exists)
            return next(new ldap.NoSuchObjectError(req.dn.toString()));

        return next();
    });
}


function childExists(req, res, next) {
    var filter = sprintf('(_parent=%s)', req.dn.toString());

    return req.search(req.bucket, filter, function(err, children) {
        if (err)
            return next(err);

        var dns = Object.keys(children);
        if (dns.length > 0) {
            var len = Math.min(dns.length, 10);
            var msg = 'Child entries exist: ' + dns.slice(0, len).join('; ');
            return next(new NotAllowedOnNonLeafError(msg));
        }

        return next();
    });
}


function del(req, res, next) {
    var opts = {
        headers: {
            'x-ufds-operation': 'delete'
        }
    };

    return req.del(req.bucket, req.key, opts, function (err) {
        if (err)
            return next(err);

        res.end();
        return next();
    });
}



///--- Exports

module.exports = function delChain() {
    return [
        entryExists,
        childExists,
        del
    ];
};
