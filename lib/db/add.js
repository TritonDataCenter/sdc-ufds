// Copyright 2012 Joyent, Inc.  All rights reserved.

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
    var client = req.moray;
    var log = req.log;

    if (req.dn.equals(req.suffix)) {
        log.debug({
            bucket: bucket,
            key: req.key}, 'Adding suffix');
        return next();
    }

    var parent = req.dn.parent().toString();
    assert.ok(parent);

    return req.exists(bucket, parent, function(err, exists) {
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


function save(req, res, next) {
    var entry = req.toObject().attributes;

    var opts = {
        headers: {
            'x-ufds-operation': 'add'
        }
    };
    return req.put(req.bucket, req.key, entry, opts, function (err) {
        if (err)
            return next(err);

        res.end();
        return next();
    });
}


///--- Exports

module.exports = function addChain() {
    return [
        entryExists,
        parentExists,
        save
    ];
};
