// Copyright 2012 Joyent, Inc.  All rights reserved.

var ldap = require('ldapjs');
var clog = require('./changelog');


///--- Handlers

function load(req, res, next) {
    if (req._entry) {
        return next();
    }

    return req.get(req.bucket, req.key, function (err, val, meta) {
        if (err) {
            return next(err);
        }

        req._entry = val.value;
        req._meta = {
            etag: val._etag
        }; // pick up etag
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

    req.changes.forEach(function (c) {
        changes.push(c.json);
    });

    if (!req.headers) {
        req.headers = {};
    }
    req.headers['x-ufds-operation'] = 'modify';
    req.headers['x-ufds-changes'] = JSON.stringify(changes);

    if (!req.objects) {
        req.objects = [];
    }

    req.objects.push({
        bucket: req.bucket,
        key: req.key,
        value: req._entry
    });

    return next();
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


function updated(req, res, next) {
    var now = Date.now();

    if (!req._entry.updated_at || req._entry.updated_at.length === 0) {
        req.changes.push(new ldap.Change({
            operation: 'add',
            modification: new ldap.Attribute({
                type: 'updated_at',
                vals: [now]
            })
        }));
    } else {
        req.changes.push(new ldap.Change({
            operation: 'replace',
            modification: new ldap.Attribute({
                type: 'updated_at',
                vals: [now]
            })
        }));
    }
    return next();
}


function commit(req, res, next) {
    // Do nothing if there's nothing to do ...
    if (!req.objects) {
        req.log.info({file: __filename, line: '153'}, 'res.end()');
        res.end();
        return next();
    }
    return req.batch(req.objects, req.headers, function (err, meta) {
        if (err) {
            return next(err);
        }

        if (!req.doNotCommit) {
            req.log.info({file: __filename, line: '163'}, 'res.end()');
            res.end();
        }
        return next();
    });
}

///--- Exports

module.exports = {
    mod: function modifyChain(check) {
        var chain = [load, updated, change];

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
        chain.push(clog.changelog);
        chain.push(commit);
        return chain;
    },
    // Want these to save password failures on bind or compare:
    load: load,
    change: change,
    save: save,
    commit: commit
};
