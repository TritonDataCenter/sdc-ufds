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

    var now = new Date().toISOString();

    // LDAP search for expired temporary credentials
    // Limited to 1000 entries per run to avoid overwhelming the system
    var filter = '(&(objectclass=accesskey)' +
        '(credentialtype=temporary)(expiration<=' + now + '))';
    var opts = {
        scope: 'sub',
        filter: filter,
        attributes: ['dn', 'accesskeyid', 'expiration'],
        sizeLimit: 1000
    };

    log.debug({filter: filter}, 'Searching for expired temporary credentials');

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
                log.debug('No expired temporary credentials found');
                return (callback());
            }

            log.info({count: entries.length},
                'Found expired temporary credentials to delete');

            // Delete expired entries with limited concurrency to avoid
            // overloading Moray
            var deleted = 0;
            var failed = 0;
            var concurrency = 5;

            var queue = vasync.queue(function deleteExpired(entry, cb) {
                log.debug({
                    dn: entry.dn,
                    accesskeyid: entry.accesskeyid,
                    expiration: entry.expiration
                }, 'Deleting expired temporary credential');

                ufdsClient.del(entry.dn, function (delErr) {
                    if (delErr) {
                        failed++;
                        log.error({err: delErr, dn: entry.dn},
                            'Failed to delete expired credential');
                    } else {
                        deleted++;
                    }
                    cb();
                });
            }, concurrency);

            queue.on('end', function () {
                if (failed > 0) {
                    log.error({deleted: deleted, failed: failed},
                        'Cleanup completed with failures');
                    callback(new Error('Failed to delete ' + failed +
                        ' credentials'));
                } else {
                    log.info({deleted: deleted},
                        'Successfully deleted expired credentials');
                    callback();
                }
            });

            queue.push(entries);
            queue.close();
        });
    });
}

function startCleanupInterval(ufdsClient, log, intervalMs) {
    intervalMs = intervalMs || 5 * 60 * 1000; // Default 5 minutes

    log.info({intervalMs: intervalMs}, 'Starting credential cleanup interval');

    function runCleanup() {
        setTimeout(function () {
            cleanupExpiredCredentials(ufdsClient, log, function (err) {
                if (err) {
                    log.error(err, 'Credential cleanup failed');
                }
                // only run next iteration after the last call has finished
                 runCleanup();
            });
        }, intervalMs);
    }
    runCleanup();
}

module.exports = {
    cleanupExpiredCredentials: cleanupExpiredCredentials,
    startCleanupInterval: startCleanupInterval
};
