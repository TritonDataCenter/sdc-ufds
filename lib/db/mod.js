// Copyright 2012 Joyent, Inc.  All rights reserved.

var ldap = require('ldapjs');



///--- Handlers

function load(req, res, next) {
    if (req._entry)
        return next();

    return req.get(req.bucket, req.key, function (err, val, meta) {
        if (err)
            return next(err);

        req._entry = val;
        req._meta = meta; // pick up etag
        return next();
    });
}


function change(req, res, next) {
    var entry = req._entry;
    req._modifiedAttrs = [];

    // Modify the loaded entry
    if (req.log.debug()) {
        var msg = '';
        req.changes.forEach(function (c) {
            msg += JSON.stringify(c.json);
        });
        req.log.debug('processing modifications %s', msg);
    }

    req.changes.forEach(function (c) {
        var mod = c.modification;
        req._modifiedAttrs.push(mod.type);

        switch (c.operation) {

        case 'add':
            if (!entry[mod.type])
                entry[mod.type] = [];

            mod.vals.forEach(function (v) {
                if (mod.type === 'objectclass')
                    v = v.toLowerCase();

                if (entry[mod.type].indexOf(v) === -1)
                    entry[mod.type].push(v);
            });
            break;

        case 'delete':
            if (!entry[mod.type])
                return; // Just silently allow this.

            if (!mod.vals || mod.vals.length === 0) {
                delete entry[mod.type];
            } else {
                mod.vals.forEach(function (v) {
                    var index = entry[mod.type].indexOf(v);
                    if (index !== -1)
                        entry[mod.type].splice(index, 1);
                });

                if (entry[mod.type].length === 0)
                    delete entry[mod.type];
            }
            break;

        case 'replace':
            if (!mod.vals || mod.vals.length === 0) {
                if (entry[mod.type])
                    delete entry[mod.type];
            } else {
                entry[mod.type] = mod.vals.slice();
                if (mod.type === 'objectclass') {
                    entry[mod.type] = entry[mod.type].map(function (v) {
                        return v.toLowerCase();
                    });
                }
            }
            break;

        default: // This never happens, but linters whine
            break;
        }
    });

    req.entry = entry;
    return next();
}


function save(req, res, next) {
    var changes = [];
    var opts = req._meta;

    req.changes.forEach(function (c) {
        changes.push(c.json);
    });

    opts.headers = {
        'x-ufds-operation': 'modify',
        'x-ufds-changes': JSON.stringify(changes)
    };

    return req.put(req.bucket, req.key, req._entry, opts, function (err) {
        if (err)
            return next(err);

        res.end();
        return next();
    });
}


function immutable(req, res, next) {
    var errors = [];

    Object.keys(req._immutableAttrs).forEach(function (oc) {
        req._immutableAttrs[oc].forEach(function (a) {
            if (req._modifiedAttrs.indexOf(a) !== -1) {
                errors.push('Attribute \'' + a + '\' is immutable');
            }
        });
    });


    if (errors.length > 0) {
        return next(new ldap.ObjectclassModsProhibitedError(errors.join('\n')));
    }

    return next();
}

///--- Exports

module.exports = function modifyChain(check) {
    var chain = [load, change];

    if (Array.isArray(check)) {
        check.forEach(function (c) {
            if (typeof (c) === 'function')
                chain.push(c);
        });
    } else if (typeof (check) === 'function') {
        chain.push(check);
    }

    chain.push(immutable);

    chain.push(save);
    return chain;
};
