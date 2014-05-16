// Copyright 2014 Joyent, Inc.  All rights reserved.

var ldap = require('ldapjs');



///--- Globals

var USERS = ldap.parseDN('ou=users, o=smartdc');



///--- Functions

function parseOwner(dn, op) {
    if (!dn.childOf(USERS)) {
        return false;
    }

    // Make a copy
    var _dn = dn.clone();

    _dn.pop();
    _dn.pop();
    var rdn = _dn.pop();
    // If the entry is an account sub-user, we want to get into the next dn
    // member:
    var crdn = _dn.pop();
    var owner = false;

    // CAPI-376: We don't want account sub-users to "own themselves", just
    // the stuff nested under them into the ldap tree:
    var sub = _dn.pop();

    if (typeof (crdn) !== 'undefined' && typeof (crdn.uuid) === 'string' &&
            ((typeof (sub) !== 'undefined' && op === 'add') ||
             (op !== 'add'))) {
        owner = crdn.uuid;
    } else if (typeof (rdn.uuid) === 'string') {
        owner = rdn.uuid;
    }
    return (owner);
}



///--- Exports

module.exports = {

    add: function (req, res, next) {
        var owner = parseOwner(req.dn, 'add');
        if (!owner) {
            return next();
        }

        req.addAttribute(new ldap.Attribute({
            type: '_owner',
            vals: [owner]
        }));

        return next();
    },


    search: function (req, res, next) {
        var owner = parseOwner(req.dn, 'search');
        if (!owner || req.scope === 'base') {
            return next();
        }

        var f = req.filter;
        req.filter = new ldap.AndFilter({
            filters: [
                f,
                new ldap.EqualityFilter({
                    attribute: '_owner',
                    value: owner
                })
            ]
        });

        return next();
    }

};
