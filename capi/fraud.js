// Copyright 2013 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var sprintf = require('util').format;

var restify = require('restify');

var ldap = require('ldapjs');
var Change = ldap.Change;

var util = require('./util');



///--- Globals

var BLACKLIST_FILTER = '(objectclass=emailblacklist)';
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

module.exports = {
    loadBlackList: function loadBlackList(req, res, next) {
        assert.ok(req.ldap);

        var log = req.log;
        var sent = false;
        function returnError(err) {
            if (!sent) {
                log.debug(err, 'loadBlackList: returning error');
                sent = true;
                next(new restify.InternalError(err.message));
            }
        }

        req.ldap.search(BLACKLIST_DN, '(objectclass=*)', function (e, result) {
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
            });

            result.once('error', returnError);
            result.once('end', function () {
                if (req.blacklist) {
                    log.debug('BlackList load done');
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

        if (req.blacklist) {
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
        } else {
            return req.ldap.add(dn, {
                email: req.params.email,
                objectclass: ['emailblacklist']
            }, function (err) {
                if (err) {
                    return next(res.sendError([err.toString()]));
                }
                log.debug({email: req.params.email}, 'Blacklist Created: ok');
                var blacklist = translateBlackList(req.params.email);
                if (req.accepts('application/xml')) {
                    blacklist = { blacklist: blacklist };
                }
                res.send(201, blacklist);
                next();
                return;
            });
        }
    }
};
