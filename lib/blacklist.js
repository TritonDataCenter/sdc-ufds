// Copyright 2012 Joyent, Inc.  All rights reserved.

var ldap = require('ldapjs');



///--- Globals

var SEARCH_OPTS = {
    scope: 'base',
    filter: '(objectclass=emailblacklist)'
};
var blacklistCacheEntry = {};



///--- Helpers

function skip(req) {
    assert.ok(req);

    if (!req.blacklistEmailDN)
        return true;

    var entry = req.object.attributes;
    if (!entry.email || !entry.email.length || !entry.objectclass)
        return true;

    for (var i = 0; i < entry.objectclass.length; i++)
        if (entry.objectclass[i].toLowerCase() === 'sdcperson')
            return false;

    return true;
}


function getBlacklist(req, callback) {
    assert.ok(req);
    assert.ok(callback);

    if (blacklistCacheEntry.email &&
        (new Date().getTime() - blacklistCacheEntry.time) < 60 * 1000)
        return callback(null, blacklistCacheEntry.email);

    req.client.search(req.blacklistEmailDN, SEARCH_OPTS, function(err, res) {
        if (err) {
            log.warn('error starting blacklist search to $self: %s', err.stack);
            return callback(new ldap.OperationsError(err.message));
        }

        var done = false;
        var email;
        res.on('searchEntry', function(entry) {
            email = entry.object.email;
        });
        res.on('error', function(err) {
            if (done)
                return;

            done = true;

            if (err instanceof ldap.NoSuchObjectError) {
                blacklistCacheEntry.email = [];
                blacklistCacheEntry.time = new Date().getTime();
                return callback(null, blacklistCacheEntry.email);
            }

            log.warn('error searching blacklist in $self: %s', err.stack);
            return callback(new ldap.OperationsError(err.message));
        });
        res.on('end', function() {
            if (done)
                return;
            done = true;
            blacklistCacheEntry.email = email || [];
            blacklistCacheEntry.time = new Date().getTime();

            var emailList = blacklistCacheEntry.email;
            for (var i = 0; i < emailList.length; i++)
                emailList[i] = emailList[i].toLowerCase();

            return callback(null, blacklistCacheEntry.email);
        });
    });
}


///--- API

module.exports = {

    add: function(req, res, next) {
        assert.ok(req.client);
        assert.ok(req.object);

        if (skip(req))
            return next();

        return getBlacklist(req, function(err, blacklist) {
            if (err)
                return next(err);

            var email = req.object.attributes.email;
            var msg = ' is blacklisted.';
            for (var i = 0; i < email.length; i++)
                if (blacklist.indexOf(email[i].toLowerCase()) !== -1)
                    return next(new ldap.ConstraintViolationError(email[i] + msg));

            return next();
        });
    }

};
