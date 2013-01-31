// Copyright 2013 Joyent, Inc.  All rights reserved.

var ldap = require('ldapjs');
var mod = require('./mod');
var attempt = require('./login_attempt');

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
                var opts = req._meta || {};

                req.changes.forEach(function (c) {
                    chgs.push(c.json);
                });

                opts.headers = {
                    'x-ufds-operation': 'modify',
                    'x-ufds-changes': JSON.stringify(chgs)
                };

                return req.put(req.bucket, req.key, req._entry, opts,
                    function (err) {
                        if (err) {
                            return next(err);
                        }

                        return next(new ldap.CompareFalseError(
                                'invalidPassword'));
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
                    var opts = req._meta || {};

                    req.changes.forEach(function (c) {
                        chgs.push(c.json);
                    });

                    opts.headers = {
                        'x-ufds-operation': 'modify',
                        'x-ufds-changes': JSON.stringify(chgs)
                    };

                    return req.put(req.bucket, req.key, req._entry, opts,
                        function (err) {
                            if (err) {
                                return next(err);
                            }
                            res.end(found);
                            return next();
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
