// Copyright 2013 Joyent, Inc.  All rights reserved.

var ldap = require('ldapjs');
var mod = require('./mod');
var attempt = require('./login_attempt');
var clog = require('./changelog');
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
        return mod.change(req, res, function (e1) {
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
            return clog.changelog(req, res, function (er1) {
                if (er1) {
                    return next(er1);
                }
                return mod.commit(req, res, function (er2) {
                    if (er2) {
                        return next(er2);
                    }
                    return next(new ldap.InvalidCredentialsError());
                });
            });
        });
    } else {
        // After a successful login, remove previous attempts (less than
        // the allowed maximum and, eventually, cleanup any previous
        // locked time)
        if (req._entry.pwdfailuretime &&
            req._entry.pwdfailuretime.length !== 0) {

            attempt.removeFailedLoginAttempts(req);
            return mod.change(req, res, function (e1) {
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
                return clog.changelog(req, res, function (er1) {
                    if (er1) {
                        return next(er1);
                    }
                    return mod.commit(req, res, function (er2) {
                        if (er2) {
                            return next(er2);
                        }
                        req.log.info({file: __filename, line: '114'},
                            'res.end()');
                        res.end();
                        return next();
                    });
                });
            });

        } else {
            req.log.info({file: __filename, line: '123'}, 'res.end()');
            res.end();
            return next();
        }
    }
}



///--- Exports

module.exports = function bindChain() {
    return [check, mod.load, bind];
};
