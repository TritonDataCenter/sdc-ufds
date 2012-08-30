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

    return req.search(req.bucket, filter, function (err, children) {
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


function load(req, res, next) {
    if (req._entry)
        return next();

    return req.get(req.bucket, req.key, function (err, val) {
        if (err)
            return next(err);

        req._entry = val.value;
        req._meta = {
            etag: val._etag
        }; // pick up etag
        return next();
    });
}


function immutable(req, res, next) {
    var errors = [],
        immutableClasses = [];

    Object.keys(req._immutableAttrs).forEach(function (k) {
        if (req._immutableAttrs[k].length > 0) {
            immutableClasses.push(k);
        }
    });

    req._entry.objectclass.forEach(function (objectclass) {
        var oc = objectclass.toLowerCase();
        if (req.schema[oc] && immutableClasses.indexOf(oc) !== -1) {
            errors.push('Entries of class \'' + oc + '\' are immutable and' +
                ' cannot be destroyed');
        }
    });

    if (errors.length > 0) {
        return next(new ldap.NotAllowedOnRdnError(errors.join('\n')));
    }

    return next();
}


function del(req, res, next) {
    var opts = {
        headers: {
            'x-ufds-operation': 'delete',
            'x-ufds-deleted-entry': JSON.stringify(req._entry)
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

module.exports = function delChain(check) {
    var chain = [entryExists, childExists, load];

    if (Array.isArray(check)) {
        check.forEach(function (c) {
            if (typeof (c) === 'function')
                chain.push(c);
        });
    } else if (typeof (check) === 'function') {
        chain.push(check);
    }

    chain.push(immutable);

    chain.push(del);
    return chain;
};
