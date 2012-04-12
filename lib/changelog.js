// Copyright 2012 Joyent, Inc.  All rights reserved.

var ldap = require('ldapjs');



///--- Triggers
//
// This is all Moray magic...
// req will always look like:
//
// {
//     bucket: bucket,
//     key: key,
//     value: value,
//     meta: { 'x-ufds-op': 'add' },
//     schema: $original_schema,
//     objectManager: $ObjectManager
//     pgClient: $postgres_driver
//
// }

function changelogAdd(req, callback) {
    var bucket = req.meta['x-ufds-changelog-bucket'];
    var meta = req.meta;
    var db = req.objectManager;

}
