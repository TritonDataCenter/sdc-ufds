// Copyright 2012 Joyent, Inc.  All rights reserved.

var ldap = require('ldapjs');

var common = require('./common');



///--- Handlers

function authorize(req, res, next) {
    if (req.type === 'BindRequest')
        return next();

    var bindDN = req.connection.ldap.bindDN;

    if (req.connection.remoteAddress === '127.0.0.1')
        req.hidden = true;

    // Leaky abstraction; we assume a config.rootDN was set
    if (bindDN.equals(req.config.rootDN))
        return next();

    if (bindDN.equals(req.dn) || bindDN.parentOf(req.dn))
        return next();

    // Otherwise check the backend
    var t = req.config.trees[req.suffix];
    if (!t.administratorsGroupRDN)
        return next(new ldap.InsufficientAccessRightsError());

    var dn = t.administratorsGroupRDN + ', ' + req.suffix;
    return req.moray.get(t.bucket, dn, function (err, _, group) {
        if (err) {
            req.log.warn({
                bucket: t.bucket,
                admininstratorsGroupDN: dn,
                suffix: req.suffix,
                err: err
            }, 'Unable to retrieve admin group');
            return next(new ldap.InsufficientAccessRightsError());
        }

        if (group.uniquemember.indexOf(bindDN.toString()) === -1)
            return next(new ldap.InsufficientAccessRightsError());

        return next();
    });
}



///--- Exports

module.exports = authorize;
