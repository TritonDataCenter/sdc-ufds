// Copyright 2012 Joyent, Inc.  All rights reserved.

var ldap = require('ldapjs');



///--- Handlers

function matches(attr, value, entry) {
    var attribute = entry[attr];
    if (!attribute) {
        throw new ldap.NoSuchAttributeError(attr);
    }

    var found = false;
    for (var i = 0; i < attribute.length; i++) {
        if (value === attribute[i]) {
            found = true;
            break;
        }
    }

    return found;
}


function compare(req, res, next) {
    if (req._entry) {
        try {
            res.end(matches(req.attribute, req.value, req._entry));
        } catch (e) {
            return next(e);
        }
        return next();
    }

    return req.get(req.bucket, req.key, function (err, entry) {
        if (err)
            return next(err);

        try {
            res.end(matches(req.attribute, req.value, entry.value));
        } catch (e) {
            return next(e);
        }
        return next();
    });
}



///--- Exports

module.exports = function compareChain() {
    return [compare];
};
