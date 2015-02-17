/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * This file defines handlers for the UFDS server LDAP search operation.
 */

var ldap = require('ldapjs');
var filters = require('ldap-filter');
var util = require('util');


///--- Helpers

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

function validateDepth(req, dn) {
    dn = ldap.parseDN(dn);
    var dist = -1;
    if (req.dn.parentOf(dn) || dn.parentOf(req.dn)) {
        dist = (dn.rdns.length - req.dn.rdns.length);
    } else if (req.dn.equals(dn)) {
        dist = 0;
    }
    // HEAD-1278: moray already performs a full ldap evaluation
    // for us, so we really just want to check the DN.
    return ((req.scope === 'sub' && dist >= 0) ||
            (req.scope === 'one' && dist === 1));
}

function safeAttributeType(name) {
    /* JSSTYLED */
    return /^[a-zA-Z]+$/.test(name);
}

/**
 * Decorate ext filter with CaseInsensitiveMatch attributes/methods.
 */
function _matchCaseInsensitive(filter) {
    function matches(target) {
        var tv = filters.getAttrValue(target, this.matchType);
        var value = this.value.toLowerCase();
        return filters.testValues(function (v) {
            return value === v.toLowerCase();
        }, tv);
    }
    filter.matches = matches.bind(filter);
}

/**
 * Decorate ext filter with CaseInsensitiveSubstrMatch attributes/methods.
 */
function _matchCaseInsensitiveSubstr(filter) {
    var f = filters.parse(util.format('(%s=%s)',
                filter.attribute, filter.value.toLowerCase()));

    // extract substr fields to build SQL statement
    filter.initial = f.initial;
    filter.any = f.any;
    filter.final = f.final;

    function matches(target) {
        var attr = this.attribute;
        var tv = filters.getAttrValue(target, attr);

        return filters.testValues(function (v) {
            var obj = {};
            obj[attr] = v.toLowerCase();
            return f.matches(obj);
        }, tv);
    }
    filter.matches = matches.bind(filter);
}

///--- Handlers

function prep(req, res, next) {
    req.isClogSearch = (req.config.changelog &&
            req.bucket == req.config.changelog.bucket);
    // CAPI-352: Hidden control should work as expected:
    if (req.controls.some(function (c) {
        return c.type === '1.3.6.1.4.1.38678.1';
    })) {
        req.hidden = true;
    }

    try {
        req.filter.forEach(function (f) {
            if (f.type !== 'ext') {
                return;
            }
            switch (f.rule) {
                case '2.5.13.2':
                case 'caseIgnoreMatch':
                    _matchCaseInsensitive(f);
                    break;
                case '2.5.13.4':
                case 'caseIgnoreSubstringsMatch':
                    _matchCaseInsensitiveSubstr(f);
                    break;
                default:
                    throw new Error('Unsupported ext filter');
            }
        });
    } catch (e) {
        next(e);
        return;
    }
    next();
}


function base(req, res, next) {
    // (The changelog doesn't exist as a base object.)
    if (req.isClogSearch) {
        return next();
    }
    // Yield a NoSuchObject error for non-base searches with bad baseDNs
    if (req.scope !== 'base') {
        return req.get(req.bucket, req.key, function (err, obj) {
            return next(err);
        });
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


function children(req, res, next) {
    if (req.scope !== 'one' && req.scope !== 'sub') {
        return next();
    }

    var client = req.moray;
    var bucket = req.bucket;
    var log = req.log;
    var opts = {
        no_count: true,    // See CAPI-440
        req_id: req.req_id
    };

    opts.sort =  [];

    // CAPI-354: Make sure --sizeLimit option gets passed to moray:
    if (req.sizeLimit) {
        var limit = parseInt(req.sizeLimit, 10);
        if (!isNaN(limit)) {
            opts.limit = limit;
        }
    }

    if (req.isClogSearch) {
        /* JSSTYLED */
        var RE = /(\d{4}\-\d{2}\-\d{2}(T\d{2}\:\d{2}\:\d{2}(\.\d{1,3})*Z)*)/;
        if (ldap.filters.isFilter(req.filter)) {
            req.filter.forEach(function (f) {
                // If we are searching changelog by "changenumber", we need to
                // replace it with an "_id":
                if (f.attribute === 'changenumber') {
                    f.attribute = '_id';
                }

                // If we are searching changelog by "changetime", we need to go
                // for millisecs since epoch instead of ISO Date
                if (f.attribute === 'changetime') {
                    var rest;
                    if ((rest = RE.exec(f.value)) !== null) {
                        f.value = new Date(rest[1]).getTime();
                    }
                }
            });
        }
    } else {
        // Apply 'one' or 'sub' scope via filter
        if (req.scope === 'one') {
            req.filter = new ldap.AndFilter({
                filters: [
                    req.filter,
                    new ldap.EqualityFilter({
                        attribute: '_parent',
                        value: req.dn.toString()
                    })
                ]
            });
        } else if (req.scope === 'sub') {
            // No need to change the filter for searches starting at the root
            // of the directory tree.
            if (req.dn.toString() !== '') {
                req.filter = new ldap.AndFilter({
                    filters: [
                        req.filter,
                        new ldap.SubstringFilter({
                            attribute: '_key',
                            final: req.dn.toString()
                        })
                    ]
                });
            }
        }
    }

    // CAPI-444: Handle server-side-sorting controls
    // Sorting by multiple fields requires Moray version of at least:
    // 9b95fa6ecbbff28fccef7bd3a9080b1bd6406798
    req.controls.some(function (c) {
        if (c.type === '1.2.840.113556.1.4.473') {
            var invalid = null;
            for (var i = 0; i < c.value.length; i++) {
                var field = c.value[i];
                // TODO: Check attributeType against schema
                if (!safeAttributeType(field.attributeType)) {
                    // bail out on sorting
                    invalid = field.attributeType;
                    opts.sort = [];
                    break;
                }
                opts.sort.push({
                    attribute: field.attributeType,
                    order: (field.reverseOrder) ? 'DESC' : 'ASC'
                });
            }
            if (!invalid) {
                res.controls.push(new ldap.ServerSideSortingResponseControl({
                    value: { result: ldap.LDAP_SUCCESS }
                }));
            } else {
                res.controls.push(new ldap.ServerSideSortingResponseControl({
                    value: {
                        result: ldap.LDAP_UNWILLING_TO_PERFORM,
                        failedAttribute: invalid
                    }
                }));
            }
            // None of the other controls are of interest
            return false;
        }
    });

    // CAPI-277: Redundant sorting value, just to make sure PostgreSQL
    // is searching and sorting as it should if multiple search indexes
    // are given:
    if (opts.sort.length === 0) {
        opts.sort.push({
            attribute: '_id',
            order: 'ASC'
        });
    }

    var filter = req.filter.toString();
    var r = client.findObjects(bucket, filter, opts);
    log.debug({bucket: bucket, filter: filter}, 'search entered');

    r.once('error', function (err) {
        return next(err);
    });

    r.on('record', function (obj) {
        var k = obj.key;
        var value = obj.value;
        if (req.isClogSearch) {
            /* JSSTYLED */
            k = k.replace(/^change=(\S)+/,
                'changenumber=' + obj._id + ',');
            value.changenumber = obj._id;
            value.changetime = new Date(value.changetime).toISOString();
        }
        if (validateDepth(req, k)) {
            res.send({
                dn: k,
                attributes: _subUser(value)
            }, req.hidden);
        }
    });

    r.on('end', function () {
        log.debug({
            bucket: bucket,
            filter: filter
        }, 'search done');
        return next();
    });
}


function done(req, res, next) {
    res.end();
    return next();
}


///--- Exports

module.exports = function searchChain() {
    return [prep, base, children, done];
};
