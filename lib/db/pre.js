// Copyright 2012 Joyent, Inc.  All rights reserved.
//
// Note that ldapjs (because LDAP RFC says so) sends all types across the wire
// as strings, but we want correct indexing/searching/etc, so we have this
// pre-trigger in moray that cleans up type information.  All this does is take
// the configured schema and convert types to what they should be, not a list
// of strings.


///--- Triggers

function fixTypes(req, cb) {
    req.log.info({
        meta: req.headers,
        schema: req.schema,
        value: req.value
    }, 'fixTypes: entered');

    if (req.headers['x-ufds-operation'] !== 'add' &&
        req.headers['x-ufds-operation'] !== 'modify') {
        cb();
        return;
    }

    var schema = req.schema;
    var value = req.value;

    Object.keys(value).forEach(function (k) {
        if (!schema[k])
            return;
        switch (schema[k].type) {
        case 'boolean':
            value[k] = value[k].map(function (v) {
                return /true/i.test(v);
            });
            break;
        case 'number':
            value[k] = value[k].map(function (v) {
                return parseInt(v, 10);
            });
            break;
        default:
            // everything is already a string
            break;
        }
    });

    req.log.info({
        meta: req.headers,
        schema: req.schema,
        value: req.value
    }, 'fixTypes: done');
    req.value = value;
    cb();
}



///--- Exports

module.exports = {

    fixTypes: fixTypes

};
