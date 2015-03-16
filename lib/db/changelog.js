/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
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

var libuuid = require('libuuid');

/**
 * Create an entry to record a change to the UFDS changelog suitable for
 * passing to moray.batch.
 *
 * @param {string} operation: LDAP operation (add/delete/modify)
 * @param {string} bucket: Moray bucket for UFDS changelog
 * @param {string} dn: DN being acted upon
 * @param {string} changes: JSON of changes to record
 * @param {string} entry: JSON of old entry to record (modify only)
 */
function createClogBatch(operation, bucket, dn, changes, entry) {
    var key = 'change=' + libuuid.create() + ', cn=changelog';
    var value = {
        targetdn: [dn],
        changetype: [operation],
        objectclass: ['changeLogEntry'],
        changetime: Date.now(),
        changes: [changes]
    };

    if (operation === 'modify') {
        value.entry = [entry];
    }

    return {
        bucket: bucket,
        key: key,
        operation: 'put',
        value: value,
        options: {
            etag: null
        }
    };
}

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

    var operation = req.headers['x-ufds-operation'];
    var changes;
    var entry;
    switch (operation) {
    case 'add':
        changes = JSON.stringify(req._entry);
        break;
    case 'delete':
        changes = req.headers['x-ufds-deleted-entry'];
        break;
    case 'modify':
        changes = req.headers['x-ufds-changes'];
        entry = JSON.stringify(req.entry);
        break;
    default:
        throw new Error('unknown clog operation:' + operation);
    }

    req.objects.push(createClogBatch(
        operation,
        bucket,
        req.key,
        changes,
        entry));

    return next();
}


///--- Exports

module.exports = {
    changelog: changelog,
    createClogBatch: createClogBatch
};
