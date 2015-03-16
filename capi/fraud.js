/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var assert = require('assert');
var mod_util = require('util');
var sprintf = mod_util.format;

var restify = require('restify');

var libuuid = require('libuuid');
var ldap = require('ldapjs');
var Change = ldap.Change;
var filters = ldap.filters;
var once = require('once');
var util = require('./util');



///--- Globals

var BLACKLIST_DN = 'cn=blacklist, o=smartdc';

var BadRequestError = restify.BadRequestError;
var ResourceNotFoundError = restify.ResourceNotFoundError;

function fetchBlacklist(ufds, cb) {
    var opts = {
        scope: 'one',
        limit: 10000,
        filter: '(objectclass=emailblacklistentry)'
    };
    ufds.search(BLACKLIST_DN, opts, function (e, blacklist) {
        if (e) {
            return cb(e);
        }
        blacklist = blacklist.map(function (entry) {
            var out = {
                id: entry.uuid
            };
            if (entry.denydomain !== undefined) {
                out.email = '*@' + entry.denydomain;
            } else {
                out.email = entry.denyemail;
            }
            return out;
        });
        return cb(null, blacklist);
    });
}


module.exports = {
    verifyBlackList: function verifyBlackList(req, res, next) {
        assert.ok(req.ufds);
        var log = req.log;
        var cb = once(function (error) {
            if (error) {
                next(new restify.InternalError(error.message));
            } else {
                next();
            }
        });

        var opts = {
            scope: 'base',
            filter: '(objectclass=emailblacklist)'
        };
        req.ufds.search(BLACKLIST_DN, opts, function (e, blacklist) {
            if (e) {
                log.debug(e, 'verifyBlackList: error starting search');
                return cb(e);
            }

            if (!blacklist.length) {
                blacklist = { objectclass: ['emailblacklist'] };
                return req.ufds.add(BLACKLIST_DN, blacklist, function (err) {
                    if (err) {
                        log.debug(err, 'create Blacklist error');
                        cb(err);
                    } else {
                        log.debug('Blacklist created');
                        cb();
                    }
                });
            }

            log.debug('BlackList Found');
            return cb();
        });
    },

    list: function list(req, res, next) {
        fetchBlacklist(req.ufds, function (err, blacklist) {
            if (err) {
                req.log.debug(err, 'ListBlacklist: failure');
                return next(new restify.InternalError(err.message));
            }
            if (req.accepts('application/xml')) {
                blacklist = { blacklist: blacklist };
            }
            req.log.debug({
                result: blacklist
            }, 'ListBlacklist: done');
            res.send(200, blacklist);
            return next();
        });
    },

    create: function create(req, res, next) {
        var email = req.params.email;
        if (typeof (email) !== 'string') {
            return next(new BadRequestError('email is required'));
        }

        var entry = {
            uuid: libuuid.create(),
            objectclass: ['emailblacklistentry']
        };
        if (email.includes('*')) {
            // Emails containing a wildcard are assumed to be in the form
            // *@domain.tld. That domain is used for the denydomain field.
            var domain = email.split('@')[1];
            if (domain === undefined || domain.length === 0) {
                return next(new BadRequestError('invalid email wildcard'));
            }
            entry.denydomain = domain;
        } else {
            entry.denyemail = email;
        }

        var dn = sprintf('uuid=%s, %s', entry.uuid, BLACKLIST_DN);

        return req.ufds.client.add(dn, entry, function (err) {
            if (err) {
                return next(res.sendError([err.toString()]));
            }

            req.log.debug({entry: entry}, 'UpdateBlacklist: ok');
            fetchBlacklist(req.ufds, function (error, blacklist) {
                if (error) {
                    req.log.debug(err, 'UpdateBlacklist: fetch failure');
                    return next(new restify.InternalError(error.message));
                }
                if (req.accepts('application/xml')) {
                    blacklist = { blacklist: blacklist };
                }
                req.log.debug({
                    result: blacklist
                }, 'UpdateBlacklist: done');
                res.send(201, blacklist);
                return next();
            });
        });
    },

    search: function search(req, res, next) {
        assert.ok(req.ufds);

        var email = req.params.email;
        if (typeof (email) !== 'string') {
            return next(new BadRequestError('email is required'));
        }
        var domain = email.split('@')[1];

        req.log.debug({email: email}, 'searchBlackList: entered');
        var filter = new filters.AndFilter({
            filters: [
                new filters.EqualityFilter({
                    attribute: 'objectclass',
                    value: 'emailblacklistentry'
                }),
                new filters.OrFilter({
                    filters: [
                        new filters.EqualityFilter({
                            attribute: 'denydomain',
                            value: domain
                        }),
                        new filters.EqualityFilter({
                            attribute: 'denyemail',
                            value: email
                        })
                    ]
                })
            ]
        });
        var opts = {
            scope: 'one',
            filter: filter.toString()
        };

        req.ufds.search(BLACKLIST_DN, opts, function (err, results) {
            if (err) {
                req.log.debug(err, 'SearchBlacklist: failure');
                return next(new restify.InternalError(err.message));
            }
            var blacklist = [];
            if (results.length !== 0) {
                blacklist.push({
                    email_address: email,
                    id: results[0].uuid
                });
            }
            if (req.accepts('application/xml')) {
                blacklist = { blacklist: blacklist };
            }
            res.send(200, blacklist);
            return next();
        });
    }
};
