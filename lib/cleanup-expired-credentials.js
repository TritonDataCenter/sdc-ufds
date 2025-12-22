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
var fs = require('fs');
var path = require('path');
var vasync = require('vasync');

/*
 * Lock file path to prevent concurrent executions
 */
var LOCK_FILE_PATH = '/var/run/ufds-cleanup-expired-credentials.lock';

/**
 * Check if a process with the given PID is running
 *
 * @param {Number} pid - Process ID to check
 * @returns {Boolean} true if process is running, false otherwise
 */
function isProcessRunning(pid) {
    try {
        // Sending signal 0 checks if process exists without actually
        // sending a signal
        process.kill(pid, 0);
        return (true);
    } catch (e) {
        // ESRCH means process does not exist
        if (e.code === 'ESRCH') {
            return (false);
        }
        // EPERM means process exists but we don't have permission
        // (still running)
        if (e.code === 'EPERM') {
            return (true);
        }
        // Other errors - assume process is not running
        return (false);
    }
}

/**
 * Attempt to acquire exclusive lock for cleanup process
 *
 * Uses file-based locking with O_EXCL flag for atomic creation.
 * Detects and removes stale locks from dead processes.
 *
 * @param {String} lockPath - Path to lock file
 * @param {Object} log - Bunyan logger
 * @param {Object} lockState - Lock state object to update
 * @returns {Boolean} true if lock acquired, false if held by another process
 */
function tryAcquireLock(lockPath, log, lockState) {
    var fd;
    var pid = process.pid;
    var lockData = String(pid);

    try {
        // Try to create lock file exclusively (fails if exists)
        // Using 'wx' flag for Node.js v0.10.48 compatibility
        // 'w' = write, 'x' = exclusive (fail if file exists)
        fd = fs.openSync(lockPath, 'wx', parseInt('0644', 8));
        fs.writeSync(fd, lockData, 0, 'utf8');
        fs.closeSync(fd);

        log.info({lockPath: lockPath, pid: pid}, 'Lock acquired');
        lockState.acquired = true;
        lockState.path = lockPath;
        return (true);

    } catch (e) {
        if (e.code === 'EEXIST') {
            // Lock file already exists - check if process is still running
            try {
                var existingPid = parseInt(
                    fs.readFileSync(lockPath, 'utf8').trim(), 10);

                if (isNaN(existingPid) || existingPid <= 0) {
                    log.warn({lockPath: lockPath, pid: existingPid},
                        'Lock file contains invalid PID, removing stale lock');
                    fs.unlinkSync(lockPath);
                    // Retry lock acquisition after removing stale lock
                    return (tryAcquireLock(lockPath, log, lockState));
                }

                if (!isProcessRunning(existingPid)) {
                    // Stale lock - process is dead
                    log.info({lockPath: lockPath, stalePid: existingPid},
                        'Removing stale lock from dead process');
                    fs.unlinkSync(lockPath);
                    // Retry lock acquisition after removing stale lock
                    return (tryAcquireLock(lockPath, log, lockState));
                }

                // Lock is held by running process
                log.info({lockPath: lockPath, pid: existingPid},
                    'Lock held by running process, exiting');
                return (false);

            } catch (readErr) {
                // Could not read lock file - assume locked
                log.warn({err: readErr, lockPath: lockPath},
                    'Could not read lock file, assuming locked');
                return (false);
            }
        }

        // Other error acquiring lock
        log.error({err: e, lockPath: lockPath},
            'Unexpected error acquiring lock');
        return (false);
    }
}

/**
 * Release the lock file
 *
 * @param {String} lockPath - Path to lock file
 * @param {Object} log - Bunyan logger
 * @param {Object} lockState - Lock state object
 */
function releaseLock(lockPath, log, lockState) {
    if (!lockState.acquired) {
        return;
    }

    try {
        fs.unlinkSync(lockPath);
        log.info({lockPath: lockPath}, 'Lock released');
        lockState.acquired = false;
        lockState.path = null;
    } catch (e) {
        // Lock file may have been removed already - not an error
        if (e.code !== 'ENOENT') {
            log.warn({err: e, lockPath: lockPath},
                'Error releasing lock file');
        }
        lockState.acquired = false;
        lockState.path = null;
    }
}

/**
 * Setup process exit handlers to ensure lock is released on termination
 *
 * @param {String} lockPath - Path to lock file
 * @param {Object} log - Bunyan logger
 * @param {Object} lockState - Lock state object
 */
function setupExitHandlers(lockPath, log, lockState) {
    // Release lock on normal exit
    var exitHandler = function () {
        if (lockState.acquired && lockState.path) {
            try {
                fs.unlinkSync(lockState.path);
            } catch (e) {
                // Ignore errors during exit
            }
        }
    };
    process.once('exit', exitHandler);

    // Release lock on SIGINT (Ctrl+C)
    var sigintHandler = function () {
        releaseLock(lockPath, log, lockState);
        process.exit(130); // Standard exit code for SIGINT
    };
    process.once('SIGINT', sigintHandler);

    // Release lock on SIGTERM (kill)
    var sigtermHandler = function () {
        releaseLock(lockPath, log, lockState);
        process.exit(143); // Standard exit code for SIGTERM
    };
    process.once('SIGTERM', sigtermHandler);
}

function cleanupExpiredCredentials(ufdsClient, log, callback, lockPath) {
    assert.object(ufdsClient, 'ufdsClient');
    assert.object(log, 'log');
    assert.func(callback, 'callback');
    assert.optionalString(lockPath, 'lockPath');

    // Use provided lock path or default
    var effectiveLockPath = lockPath || LOCK_FILE_PATH;

    // Lock state for this invocation
    var lockState = {
        acquired: false,
        path: null
    };

    // Try to acquire lock to prevent concurrent executions
    if (!tryAcquireLock(effectiveLockPath, log, lockState)) {
        log.info('Another cleanup process is already running, exiting');
        return (callback(new Error(
            'Another cleanup process is already running')));
    }

    // Setup process exit handlers to ensure lock is released
    setupExitHandlers(effectiveLockPath, log, lockState);

    var totalDeleted = 0;
    var totalFailed = 0;
    var batchNumber = 0;

    // Wrapper to release lock before calling callback
    function cleanupCallback(err) {
        releaseLock(effectiveLockPath, log, lockState);
        callback(err);
    }

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
                return (cleanupCallback(err));
            }

            var entries = [];

            res.on('searchEntry', function (entry) {
                entries.push(entry.object);
            });

            res.once('error', function (searchErr) {
                log.error(searchErr, 'Search error');
                return (cleanupCallback(searchErr));
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
                        return (cleanupCallback(new Error('Failed to delete ' +
                            totalFailed + ' credentials')));
                    }
                    return (cleanupCallback());
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
