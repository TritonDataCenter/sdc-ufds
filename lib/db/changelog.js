// Copyright 2013 Joyent, Inc.  All rights reserved.

var uuid = require('node-uuid');

function changelog(req, res, next) {
    if (!req.headers['x-ufds-operation'] || !req.objects) {
        return next();
    }

    var bucket = req.config.changelog.bucket;

    if (!bucket) {
        req.log.warn({
            config: req.config.changelog
        }, 'bucket not provided, skipping');
        return next();
    }

    // Without objects to add/modify/remove we don't need to add nothing
    // to changelog
    if (!req.objects) {
        return next();
    }

    var key = 'change=' + uuid() + ', cn=changelog';
    var value = {
        targetdn: [req.key],
        changetype: [req.headers['x-ufds-operation']],
        objectclass: ['changeLogEntry']
    };

    switch (req.headers['x-ufds-operation']) {
        case 'add':
            value.changes = [JSON.stringify(req._entry)];
            break;
        case 'delete':
            value.changes = [req.headers['x-ufds-deleted-entry']];
            break;
        default:
            // Modify:
            value.changes = [req.headers['x-ufds-changes']];
            value.entry = [JSON.stringify(req.entry)];
            break;
    }

    req.objects.push({
        bucket: bucket,
        key: key,
        operation: 'put',
        value: value
    });

    return next();
}




///--- Exports

module.exports = {
    changelog: changelog
};
