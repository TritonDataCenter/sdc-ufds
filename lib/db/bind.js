// Copyright 2013 Joyent, Inc.  All rights reserved.

var ldap = require('ldapjs');
var mod = require('./mod');
var attempt = require('./login_attempt');

///--- Handlers


function check(req, res, next) {
    if (req.version !== 3) {
        return next(new ldap.ProtocolError(req.version + ' is not v3'));
    }

    if (req.authentication !== 'simple') {
        return next(new ldap.AuthMethodNotSupportedError(req.authentication));
    }

    return next();
}


function bind(req, res, next) {
    if (!req._entry.userpassword) {
        return next(new ldap.NoSuchAttributeError('userPassword'));
    }

    req.changes = [];

    if (req._entry.userpassword[0] !== req.credentials) {
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

                    return next(new ldap.InvalidCredentialsError());
                });
        });
    } else {
        // After a successful login, remove previous attempts (less than
        // the allowed maximum and, eventually, cleanup any previous
        // locked time)
        if (req._entry.pwdfailuretime &&
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
                        res.end();
                        return next();
                    });
            });

        } else {
            res.end();
            return next();
        }
    }
}



///--- Exports

module.exports = function bindChain() {
    return [check, mod.load, bind];
};
