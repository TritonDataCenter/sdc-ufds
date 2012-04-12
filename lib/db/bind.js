// Copyright 2012 Joyent, Inc.  All rights reserved.

var ldap = require('ldapjs');



///--- Handlers


function check(req, res, next) {
    if (req.version !== 3)
        return next(new ldap.ProtocolError(req.version + ' is not v3'));

    if (req.authentication !== 'simple')
        return next(new ldap.AuthMethodNotSupportedError(req.authentication));

    return next();
}


function load(req, res, next) {
    if (req._entry)
        return next();

    return req.get(req.bucket, req.key, function(err, val) {
        if (err)
            return next(err);

        req._entry = val;
        return next();
    });
}


function bind(req, res, next) {
    if (!req._entry.userpassword)
        return next(new ldap.NoSuchAttributeError('userPassword'));

    console.log(req._entry.userpassword[0] + ' --> ' + req.credentials);
    if (req._entry.userpassword[0] !== req.credentials)
        return next(new ldap.InvalidCredentialsError());

    res.end();
    return next();
}



///--- Exports

module.exports = function bindChain() {
    return [check, load, bind];
};
