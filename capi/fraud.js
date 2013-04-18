// Copyright 2013 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var mod_util = require('util');
var sprintf = mod_util.format;

var restify = require('restify');

var ldap = require('ldapjs');
var Change = ldap.Change;
var util = require('./util');



///--- Globals

var BLACKLIST_FILTER = '(&(email=%s)(objectclass=emailblacklist))';
var BLACKLIST_DN = 'cn=blacklist, o=smartdc';

var BadRequestError = restify.BadRequestError;
var ResourceNotFoundError = restify.ResourceNotFoundError;

function translateBlackList(blacklist) {
    if (Array.isArray(blacklist)) {
        return blacklist.map(function (email) {
            return ({
                email_address: email,
                id: util.randomId()
            });
        });
    } else {
        return ({
            email_address: blacklist,
            id: util.randomId()
        });
    }
}

function createBlackList(ld, email, callback) {
    if (typeof (email) === 'function') {
        callback = email;
        email = null;
    }
    var blacklist = {
        objectclass: ['emailblacklist']
    };

    if (email) {
        blacklist.email = email;
    }
    return ld.add(BLACKLIST_DN, blacklist, function (err) {
        if (err) {
            return callback(err);
        }
        return callback(null);
    });
}

module.exports = {
    loadBlackList: function loadBlackList(req, res, next) {
        assert.ok(req.ldap);

        var log = req.log;
        var sent = false;
        function returnError(err) {
            if (err instanceof ldap.NoSuchObjectError) {
                return createBlackList(req.ldap, function (err2) {
                    if (err2) {
                        if (!sent) {
                            log.debug(err, 'create Blacklist error');
                            sent = true;
                            next(new restify.InternalError(err2.message));
                        }
                    } else {
                        log.debug(err, 'Blacklist created');
                        req.blacklist = { email: []};
                        if (!sent) {
                            sent = true;
                            next();
                        }
                    }
                });
            } else if (!sent) {
                log.debug(err, 'loadBlackList: returning error');
                sent = true;
                next(new restify.InternalError(err.message));
            }
        }

        req.ldap.search(BLACKLIST_DN, '(objectclass=emailblacklist)',
                function (e, result) {
            if (e) {
                log.debug({
                    err: e
                }, 'loadBlackList: error starting search');
                returnError(e);
                return;
            }

            result.once('searchEntry', function (entry) {
                log.debug({
                    entry: entry.object
                }, 'BlackList Loaded');
                req.blacklist = entry.object;
                // Just in case we have a single email
                if (!Array.isArray(req.blacklist.email)) {
                    req.blacklist.email = [req.blacklist.email];
                    log.debug({
                        entry: req.blacklist
                    }, 'BlackList Modified');
                }

            });

            result.once('error', returnError);
            result.once('end', function () {
                if (req.blacklist) {
                    log.debug(req.blacklist, 'BlackList load done');
                }

                if (!sent) {
                    sent = true;
                    next();
                }
            });
        });
    },

    list: function list(req, res, next) {
        var blacklist = req.blacklist || [];
        var log = req.log;
        if (blacklist && blacklist.email) {
            blacklist = translateBlackList(blacklist.email);
        }
        if (req.accepts('application/xml')) {
            blacklist = { blacklist: blacklist };
        }
        log.debug({
            result: blacklist
        }, 'ListBlacklist: done');
        res.send(200, blacklist);
        return next();
    },

    create: function create(req, res, next) {
        var log = req.log;

        if (!req.params.email) {
            return next(new BadRequestError('email is required'));
        }

        var dn = BLACKLIST_DN;

        var changes = [];
        changes.push(new Change({
            type: 'add',
            modification: {
                email: req.params.email
            }
        }));

        return req.ldap.modify(dn, changes, function (err) {
            if (err) {
                return next(res.sendError([err.toString()]));
            }

            log.debug({email: req.params.email}, 'Update Blacklist: ok');
            var blacklist = req.blacklist;
            blacklist.email.push(req.params.email);
            blacklist = translateBlackList(blacklist.email);
            if (req.accepts('application/xml')) {
                blacklist = { blacklist: blacklist };
            }
            res.send(201, blacklist);
            next();
            return;
        });
    },

    search: function search(req, res, next) {

        assert.ok(req.ldap);
        assert.ok(req.blacklist);
        var log = req.log;

        if (!req.params.email) {
            return next(new BadRequestError('email is required'));
        }

        log.debug({uuid: req.params.email}, 'searchBlackList: entered');

        var blacklisted = req.blacklist.email.some(function (x) {
            var email = req.params.email;
            if (x === email) {
                return true;
            }
            /* JSSTYLED */
            var re = new RegExp(x.replace(/\*/, '.\*'));
            return re.test(email);
        });

        var blacklist;

        if (blacklisted) {
            blacklist = translateBlackList(req.params.email);
        } else {
            blacklist = [];
        }

        if (req.accepts('application/xml')) {
            blacklist = { blacklist: blacklist };
        }
        res.send(200, blacklist);
        return next();
    }
};
