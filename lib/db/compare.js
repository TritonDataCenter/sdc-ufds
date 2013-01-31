// Copyright 2013 Joyent, Inc.  All rights reserved.

var ldap = require('ldapjs');
var mod = require('./mod');


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
            var changes = [];
            var now = Date.now();

            if (!req._entry.pwdfailuretime ||
                    req._entry.pwdfailuretime.length === 0) {
                changes.push(now);
                req.changes.push(new ldap.Change({
                    operation: 'add',
                    modification: new ldap.Attribute({
                        type: 'pwdfailuretime',
                        vals: changes
                    })
                }));
            } else {
                changes = changes.concat(req._entry.pwdfailuretime.sort(
                            function (s, t) {
                                // Reverse sort based on timestamp:
                                if (s < t)
                                    return 1;
                                if (s > t)
                                    return -1;
                                return 0;
                            })).slice(0, req._policy.pwdmaxfailure - 1);

                changes.push(now);

                req.changes.push(new ldap.Change({
                    operation: 'replace',
                    modification: new ldap.Attribute({
                        type: 'pwdfailuretime',
                        vals: changes
                    })
                }));
            }

            if (changes.length === req._policy.pwdmaxfailure[0]) {
                req.changes.push(new ldap.Change({
                    operation: 'add',
                    modification: new ldap.Attribute({
                        type: 'pwdaccountlockedtime',
                        vals: [now + (req._policy.pwdlockoutduration * 1000)]
                    })
                }));
            }

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

                req.changes.push(new ldap.Change({
                    operation: 'delete',
                    modification: new ldap.Attribute({
                        type: 'pwdfailuretime',
                        vals: false
                    })
                }));

                if (req._entry.pwdaccountlockedtime &&
                    req._entry.pwdaccountlockedtime.length !== 0) {
                    req.changes.push(new ldap.Change({
                        operation: 'delete',
                        modification: new ldap.Attribute({
                            type: 'pwdaccountlockedtime',
                            vals: false
                        })
                    }));
                    }

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
            }
        }

    } catch (e) {
        return next(e);
    }
    return next();
}



///--- Exports

module.exports = function compareChain() {
    return [mod.load, compare];
};
