/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * This is the UFDS changelog code. Note that ufds-replicator depends
 * on changelog changes in order to properly replicate UFDS across different
 * setups.
 *
 * PLEASE, NOTE ROLES/GROUPS REVERSE INDEX MUST NOT BE ADDED TO THE
 * CHANGELOG. THIS INDEX WILL BE ADDED RIGHT AFTER THE MAIN CHANGE BY
 * THE DIFFERENT UFDS INSTANCES. ADDING IT HERE WOULD INTRODUCE UNDESIRED
 * DUPLICATION.
 */

var libuuid = require('libuuid');

var HintReqControl = require('../controls/index').ChangelogHintRequestControl;

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

    var key = 'change=' + libuuid.create() + ', cn=changelog';
    var value = {
        targetdn: [req.key],
        changetype: [req.headers['x-ufds-operation']],
        objectclass: ['changeLogEntry'],
        changetime: Date.now()
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

    // Record replication information about change, if available
    req.controls.forEach(function (control) {
        if (control.type === HintReqControl.OID) {
            var parsed = new HintReqControl({
                value: control.value
            });
            value.replurl = parsed.url;
            value.replchangenumber = parsed.changenumber;
        }
    });

    req.objects.push({
        bucket: bucket,
        key: key,
        operation: 'put',
        value: value,
        options: {
            etag: null
        }
    });

    return next();
}




///--- Exports

module.exports = {
    changelog: changelog
};
