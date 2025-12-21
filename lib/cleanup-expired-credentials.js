/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2025 Edgecast Cloud LLC.
 */

/*
 * Cleanup job for expired temporary credentials
 */

var assert = require('assert-plus');
var vasync = require('vasync');

function cleanupExpiredCredentials(ufdsClient, log, callback) {
    assert.object(ufdsClient, 'ufdsClient');
    assert.object(log, 'log');
    assert.func(callback, 'callback');

    var totalDeleted = 0;
    var totalFailed = 0;
    var batchNumber = 0;

    // Process batches until no more expired credentials found
    function processBatch() {
        batchNumber++;
        var now = new Date().toISOString();

        // LDAP search for expired temporary credentials
        // Limited to 1000 entries per batch to avoid overwhelming the system
        var filter = '(&(objectclass=accesskey)' +
            '(credentialtype=temporary)(expiration<=' + now + '))';
        var opts = {
            scope: 'sub',
            filter: filter,
            attributes: ['dn', 'accesskeyid', 'expiration'],
            sizeLimit: 1000
        };

        log.info({batch: batchNumber, filter: filter},
            'Searching for expired temporary credentials');

        ufdsClient.search('o=smartdc', opts, function (err, res) {
            if (err) {
                log.error(err, 'Failed to search for expired credentials');
                return (callback(err));
            }

            var entries = [];

            res.on('searchEntry', function (entry) {
                entries.push(entry.object);
            });

            res.once('error', function (searchErr) {
                log.error(searchErr, 'Search error');
                return (callback(searchErr));
            });

            res.once('end', function () {
                if (entries.length === 0) {
                    // No more expired credentials found
                    if (batchNumber === 1) {
                        log.debug('No expired temporary credentials found');
                    } else {
                        log.info({
                            batches: batchNumber - 1,
                            totalDeleted: totalDeleted,
                            totalFailed: totalFailed
                        }, 'Cleanup completed all batches');
                    }

                    if (totalFailed > 0) {
                        return (callback(new Error('Failed to delete ' +
                            totalFailed + ' credentials')));
                    }
                    return (callback());
                }

                log.info({batch: batchNumber, count: entries.length},
                    'Found expired temporary credentials to delete');

                // Delete expired entries with limited concurrency to
                // avoid overloading Moray
                var batchDeleted = 0;
                var batchFailed = 0;
                var concurrency = 5;

                var queue = vasync.queue(function deleteExpired(entry, cb) {
                    log.debug({
                        dn: entry.dn,
                        accesskeyid: entry.accesskeyid,
                        expiration: entry.expiration
                    }, 'Deleting expired temporary credential');

                    ufdsClient.del(entry.dn, function (delErr) {
                        if (delErr) {
                            batchFailed++;
                            log.error({err: delErr, dn: entry.dn},
                                'Failed to delete expired credential');
                        } else {
                            batchDeleted++;
                        }
                        cb();
                    });
                }, concurrency);

                queue.on('end', function () {
                    totalDeleted += batchDeleted;
                    totalFailed += batchFailed;

                    log.info({
                        batch: batchNumber,
                        batchDeleted: batchDeleted,
                        batchFailed: batchFailed,
                        totalDeleted: totalDeleted,
                        totalFailed: totalFailed
                    }, 'Batch cleanup completed');

                    // Process next batch
                    processBatch();
                });

                queue.push(entries);
                queue.close();
            });
        });
    }

    // Start processing batches
    processBatch();
}

module.exports = {
    cleanupExpiredCredentials: cleanupExpiredCredentials
};
