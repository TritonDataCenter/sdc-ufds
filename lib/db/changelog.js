/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

/*
 * This is the UFDS changelog code. Note that ufds-replicator depends
 * on changelog changes in order to properly replicate UFDS across different
 * setups.
 *
 * PLEASE, NOTE ROLES/GROUPS REVERSE INDEX MUST NOT BE ADDED TO THE
 * CHANGELOG. THIS INDEX WILL BE ADDED RIGHT AFTER THE MAIN CHANGE BY
 * THE DIFFERENT UFDS INSTANCES. ADDING IT HERE WOULD INTRODUCE UNDESIRED
 * DUPLICATION.
 */

var uuidv4 = require('uuid/v4');

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

    var key = 'change=' + uuidv4() + ', cn=changelog';
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




// --- Exports

module.exports = {
    changelog: changelog
};
