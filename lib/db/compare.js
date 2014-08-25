/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var ldap = require('ldapjs');
var mod = require('./mod');
var attempt = require('./login_attempt');
var clog = require('./changelog');
var util = require('util');

// --- Handlers


function compare(req, res, next) {
    req.changes = [];
    try {
        var attribute = req._entry[req.attribute];
        if (!attribute) {
            throw new ldap.NoSuchAttributeError(req.attribute);
        }

        var found = attribute.some(function (i) {
            return (req.value === i);
        });

        if (req.attribute === 'userpassword' && found === false &&
                req._policy && req._policy.pwdmaxfailure) {

            attempt.logFailedLoginAttempt(req);
            mod.change(req, res, function (e1) {
                if (e1) {
                    return next(e1);
                }
                var chgs = [];

                req.changes.forEach(function (c) {
                    chgs.push(c.json);
                });

                if (!req.headers) {
                    req.headers = {};
                }
                req.headers['x-ufds-operation'] = 'modify';
                req.headers['x-ufds-changes'] = JSON.stringify(chgs);

                if (!req.objects) {
                    req.objects = [];
                }

                req.objects.push({
                    bucket: req.bucket,
                    key: req.key,
                    value: req._entry
                });
                req.doNotCommit = true;
                clog.changelog(req, res, function (er1) {
                    if (er1) {
                        return next(er1);
                    }
                    mod.commit(req, res, function (er2) {
                        if (er2) {
                            return next(er2);
                        }
                        return next(new ldap.CompareFalseError(
                                'invalidPassword'));
                    });
                });
            });
        } else {
            // After a successful login, remove previous attempts (less than
            // the allowed maximum and, eventually, cleanup any previous
            // locked time)
            if (req.attribute === 'userpassword' &&
                req._entry.pwdfailuretime &&
                req._entry.pwdfailuretime.length !== 0) {

                attempt.removeFailedLoginAttempts(req);
                mod.change(req, res, function (e1) {
                    if (e1) {
                        return next(e1);
                    }
                    var chgs = [];

                    req.changes.forEach(function (c) {
                        chgs.push(c.json);
                    });

                    if (!req.headers) {
                        req.headers = {};
                    }
                    req.headers['x-ufds-operation'] = 'modify';
                    req.headers['x-ufds-changes'] = JSON.stringify(chgs);

                    if (!req.objects) {
                        req.objects = [];
                    }

                    req.objects.push({
                        bucket: req.bucket,
                        key: req.key,
                        value: req._entry
                    });
                    req.doNotCommit = true;
                    clog.changelog(req, res, function (er1) {
                        if (er1) {
                            return next(er1);
                        }
                        mod.commit(req, res, function (er2) {
                            if (er2) {
                                return next(er2);
                            }
                            res.end(found);
                            return next();
                        });
                    });
                });

            } else {
                res.end(found);
                return next();
            }
        }

    } catch (e) {
        return next(e);
    }
}



///--- Exports

module.exports = function compareChain() {
    return [mod.load, compare];
};
