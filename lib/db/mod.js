/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * This file defines handlers for UFDS LDAP server modify operation.
 * "updated_at" attribute is automatically added here and attempts to
 * modify immutable attributes are also rejected here.
 */

var assert = require('assert');
var util = require('util');

var ldap = require('ldapjs');
var vasync = require('vasync');

var clog = require('./changelog');

var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function _subUser(entry) {
    if (entry.objectclass.indexOf('sdcaccountuser') === -1) {
        return (entry);
    }

    var login = entry.login[0];

    if (login.indexOf('/') === 36 && UUID_RE.test(login.substr(0, 36))) {
        login = login.substr(37);
    }

    entry.login = [login];
    return (entry);
}

///--- Handlers

function load(req, res, next) {
    if (req._entry) {
        return next();
    }

    return req.get(req.bucket, req.key, function (err, val, meta) {
        if (err) {
            return next(err);
        }

        req._entry = _subUser(val.value);
        req._meta = {
            etag: val._etag
        }; // pick up etag
        return next();
    });
}

function preloadAccount(req, res, next) {
    if (!req._entry.login ||
        !req._entry._parent ||
        req._entry._imported ||
        (req._entry._replicated && !req.config.ufds_is_master)) {
        return next();
    }

    var parent = req.dn.parent().toString();
    assert.ok(parent);

    return req.get(req.bucket, parent, function (err, val) {
        if (err) {
            return next(err);
        }

        if (val.value.objectclass.indexOf('sdcperson') !== -1) {
            req._account = val.value;
        }

        return next();
    });
}


// To be called only when objectclass is one of sdcAccountGroup or
// sdcAccountRole, and modifications apply either to membergroup or
// memberrole attributes
function roleGroupReverseIndex(req, res, next) {
    var entry = req._entry;

    if (entry.objectclass.indexOf('sdcaccountrole') === -1 &&
        entry.objectclass.indexOf('sdcaccountgroup') === -1) {
        return next();
    }

    function loadLinked(key, cb) {
        return req.get(req.bucket, key, function (err, val, meta) {
            if (err) {
                return next(err);
            }

            return cb({
                etag: val._etag,
                value: val.value
            });
        });
    }

    function processChanges(c, callback) {
        var mod = c.modification;

        var target = (mod.type === 'memberrole') ? 'membergroup' : 'memberrole';

        function doAdd(t, cb) {
            loadLinked(t, function (obj) {
                var val = obj.value;
                if (!val[target]) {
                    val[target] = [];
                }
                val[target].push(req.key);
                req.objects.push({
                    bucket: req.bucket,
                    key: t,
                    value: val,
                    options: {
                        etag: obj.etag
                    }
                });
                cb();
            });
        }

        function doRemove(t, cb) {
            loadLinked(t, function (obj) {
                var val = obj.value;
                val[target] = val[target].filter(function (r) {
                    return (r !== req.key);
                });
                req.objects.push({
                    bucket: req.bucket,
                    key: t,
                    value: val,
                    options: {
                        etag: obj.etag
                    }
                });
                cb();
            });
        }

        var func;
        var inputs;

        var extra_func;
        var extra_inputs;

        switch (c.operation) {

        case 'add':
            if (!entry[mod.type]) {
                entry[mod.type] = [];
            }
            // Find all the targets not yet linked to the entry
            // (likely all for the "add" operation), and add the backlink to the
            // current entry to all of them
            func = doAdd;
            inputs = mod.vals.filter(function (v) {
                return (entry[mod.type].indexOf(v) === -1);
            });
            break;

        case 'delete':
            func = doRemove;
            // Everything already removed
            if (!entry[mod.type]) {
                entry[mod.type] = [];
            }
            // We are removing the attribute from the entry. Need to loop over
            // all the existing links into the entry and remove the link from
            // all the targets
            if (!mod.vals || mod.vals.length === 0) {
                inputs = entry[mod.type];
            } else {
                // We're removing some links from the entry, need to loop over
                // those values and remove the reverse link to the entry from
                // the targets.
                inputs = mod.vals.filter(function (v) {
                    return (entry[mod.type].indexOf(v) !== -1);
                });
            }
            break;

        case 'replace':
            // If we have no values for the replace operation, we want to
            // remove the links for this attribute. Need to loop over the
            // existing backlinks and remove them too.
            if (!mod.vals || mod.vals.length === 0) {
                func = doRemove;
                inputs = entry[mod.type];
            } else {
                // We can be adding or removing links here.
                // a) For those presents on the modifications and not present
                // on the entry, we want to add a new reverse link to the
                // linked targets
                func = doAdd;
                inputs = mod.vals.filter(function (v) {
                    return (entry[mod.type].indexOf(v) === -1);
                });
                // b) For those present on the entry and not on the modified
                // value, we want to update reverse index and remove the entry
                // from there
                extra_func = doRemove;
                extra_inputs = entry[mod.type].filter(function (v) {
                    return (mod.vals.indexOf(v) === -1);
                });
            }
            break;

        default: // This never happens, but linters whine
            break;
        }

        vasync.forEachPipeline({
            func: func,
            inputs: inputs
        }, function (err, results) {
            if (err) {
                return callback(err);
            }

            if (extra_func) {
                vasync.forEachPipeline({
                    func: extra_func,
                    inputs: extra_inputs
                }, function (err2, res2) {
                    if (err2) {
                        return callback(err2);
                    }
                    return callback();
                });
            } else {
                return callback();
            }
        });
    }

    // We are interested only into the 'memberole' or 'membergroup' changes.
    var changes = req.changes.filter(function (chg) {
        return (chg.modification.type === 'memberrole' ||
            chg.modification.type === 'membergroup');
    });

    if (!changes.length) {
        return next();
    }

    if (!req.objects) {
        req.objects = [];
    }

    vasync.forEachPipeline({
        func: processChanges,
        inputs: changes
    }, function (err, results) {
        if (err) {
            return next(err);
        }
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
            if (!entry[mod.type]) {
                entry[mod.type] = [];
            }

            mod.vals.forEach(function (v) {
                if (mod.type === 'objectclass') {
                    v = v.toLowerCase();
                }

                if (entry[mod.type].indexOf(v) === -1) {
                    entry[mod.type].push(v);
                }
            });
            break;

        case 'delete':
            if (!entry[mod.type]) {
                return; // Just silently allow this.
            }

            if (!mod.vals || mod.vals.length === 0) {
                delete entry[mod.type];
            } else {
                mod.vals.forEach(function (v) {
                    var index = entry[mod.type].indexOf(v);
                    if (index !== -1) {
                        entry[mod.type].splice(index, 1);
                    }
                });

                if (entry[mod.type].length === 0) {
                    delete entry[mod.type];
                }
            }
            break;

        case 'replace':
            if (!mod.vals || mod.vals.length === 0) {
                if (entry[mod.type]) {
                    delete entry[mod.type];
                }
            } else {
                entry[mod.type] = mod.vals.slice();

                if (mod.type === 'objectclass') {
                    entry[mod.type] = entry[mod.type].map(function (v) {
                        return v.toLowerCase();
                    });
                }

                if (mod.type === 'login' && req._account) {
                    entry.alias = [];
                    entry[mod.type] = entry[mod.type].map(function (v) {
                        if (v.indexOf('/') === 36 &&
                            UUID_RE.test(v.substr(0, 36))) {
                            entry.alias.push(v.substr(37));
                            return v;
                        } else {
                            entry.alias.push(v);
                            return (req._account.uuid + '/' + v);
                        }
                    });

                }
            }
            break;

        default: // This never happens, but linters whine
            break;
        }
    });

    // Undo what we did in _subUser, since we are not changing login:
    if (entry.objectclass.indexOf('sdcaccountuser') !== -1 && req._account &&
            req._modifiedAttrs.indexOf('login') === -1) {
        entry.login = [req._account.uuid + '/' + entry.login[0]];
    }

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
    if (req._entry.objectclass[0] !== 'sdcperson') {
        return next();
    }
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
        res.end();
        return next();
    }
    return req.batch(req.objects, req.headers, function (err, meta) {
        if (err) {
            return next(err);
        }

        if (!req.doNotCommit) {
            res.end();
        }
        return next();
    });
}

///--- Exports

module.exports = {
    mod: function modifyChain(check) {
        var chain = [load, preloadAccount, updated,
            roleGroupReverseIndex, change];

        if (Array.isArray(check)) {
            check.forEach(function (c) {
                if (typeof (c) === 'function') {
                    chain.push(c);
                }
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
