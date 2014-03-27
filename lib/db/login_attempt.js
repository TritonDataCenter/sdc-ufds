// Copyright 2013 Joyent, Inc.  All rights reserved.
var ldap = require('ldapjs');

function logFailedLoginAttempt(req) {
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
                        if (s < t) {
                            return 1;
                        }
                        if (s > t) {
                            return -1;
                        }
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

    if (changes.length === parseInt(req._policy.pwdmaxfailure[0], 10)) {
        req.changes.push(new ldap.Change({
            operation: 'add',
            modification: new ldap.Attribute({
                type: 'pwdaccountlockedtime',
                vals: [now + (req._policy.pwdlockoutduration * 1000)]
            })
        }));
    }

}


function removeFailedLoginAttempts(req) {
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
}

module.exports = {
    logFailedLoginAttempt: logFailedLoginAttempt,
    removeFailedLoginAttempts: removeFailedLoginAttempts
};
