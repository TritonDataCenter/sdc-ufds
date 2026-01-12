/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2026 Edgecast Cloud LLC.
 */

/*
 * Unit tests for cleanup-expired-credentials.js lock mechanism
 * Tests lock acquisition, stale lock detection, and concurrent execution
 * prevention
 */

var test = require('tape');
var fs = require('fs');
var path = require('path');
var cleanup = require('../lib/cleanup-expired-credentials');
var EventEmitter = require('events').EventEmitter;

// Test lock file path (use /tmp for tests)
var TEST_LOCK_PATH = '/tmp/test-cleanup-lock-' + process.pid + '.lock';

// Mock bunyan logger
function createMockLogger() {
    return ({
        debug: function () {},
        info: function () {},
        error: function () {},
        warn: function () {}
    });
}

// Mock UFDS client that succeeds immediately
function createMockUfdsClient() {
    return ({
        search: function (base, opts, callback) {
            var res = new EventEmitter();

            setImmediate(function () {
                callback(null, res);

                setImmediate(function () {
                    // Return no entries (empty cleanup)
                    res.emit('end');
                });
            });

            return (res);
        }
    });
}

// Cleanup any leftover lock files before tests
function cleanupLockFile() {
    try {
        fs.unlinkSync(TEST_LOCK_PATH);
    } catch (e) {
        // Ignore if file doesn't exist
    }
}

/* --- Test lock acquisition --- */

test('lock acquisition - succeeds when no lock exists', function (t) {
    cleanupLockFile();

    var client = createMockUfdsClient();
    var log = createMockLogger();

    cleanup.cleanupExpiredCredentials(client, log, function (err) {
        t.ifError(err, 'should not error');
        t.false(fs.existsSync(TEST_LOCK_PATH),
            'lock should be released after completion');
        t.end();
    }, TEST_LOCK_PATH);
});

test('lock acquisition - fails when lock held by running process',
    function (t) {
    cleanupLockFile();

    // Create lock file with current process PID
    fs.writeFileSync(TEST_LOCK_PATH, String(process.pid), 'utf8');

    var client = createMockUfdsClient();
    var log = createMockLogger();

    cleanup.cleanupExpiredCredentials(client, log, function (err) {
        t.ok(err, 'should return error when lock is held');
        t.ok(err.message.indexOf('already running') !== -1,
            'error should mention another process is running');

        // Cleanup our test lock
        cleanupLockFile();
        t.end();
    }, TEST_LOCK_PATH);
});

test('lock acquisition - removes stale lock from dead process', function (t) {
    cleanupLockFile();

    // Create lock file with fake PID that doesn't exist (99999)
    fs.writeFileSync(TEST_LOCK_PATH, '99999', 'utf8');

    var client = createMockUfdsClient();
    var log = createMockLogger();

    cleanup.cleanupExpiredCredentials(client, log, function (err) {
        t.ifError(err, 'should not error after removing stale lock');
        t.false(fs.existsSync(TEST_LOCK_PATH),
            'lock should be released after completion');
        t.end();
    }, TEST_LOCK_PATH);
});

test('lock acquisition - handles invalid PID in lock file', function (t) {
    cleanupLockFile();

    // Create lock file with invalid PID (not a number)
    fs.writeFileSync(TEST_LOCK_PATH, 'not-a-pid', 'utf8');

    var client = createMockUfdsClient();
    var log = createMockLogger();

    cleanup.cleanupExpiredCredentials(client, log, function (err) {
        t.ifError(err, 'should not error after removing invalid lock');
        t.false(fs.existsSync(TEST_LOCK_PATH),
            'lock should be released after completion');
        t.end();
    }, TEST_LOCK_PATH);
});

/* --- Test lock release --- */

test('lock release - released after successful cleanup', function (t) {
    cleanupLockFile();

    var client = createMockUfdsClient();
    var log = createMockLogger();

    cleanup.cleanupExpiredCredentials(client, log, function (err) {
        t.ifError(err, 'should not error');
        t.false(fs.existsSync(TEST_LOCK_PATH),
            'lock file should not exist after completion');
        t.end();
    }, TEST_LOCK_PATH);
});

test('lock release - released after cleanup error', function (t) {
    cleanupLockFile();

    // Mock UFDS client that returns error
    var client = {
        search: function (base, opts, callback) {
            setImmediate(function () {
                callback(new Error('LDAP connection failed'));
            });
        }
    };

    var log = createMockLogger();

    cleanup.cleanupExpiredCredentials(client, log, function (err) {
        t.ok(err, 'should return error from LDAP');
        t.false(fs.existsSync(TEST_LOCK_PATH),
            'lock should be released even after error');
        t.end();
    }, TEST_LOCK_PATH);
});

/* --- Test concurrent execution prevention --- */

test('concurrent execution - second instance exits early', function (t) {
    cleanupLockFile();

    var client1 = {
        search: function (base, opts, callback) {
            var res = new EventEmitter();

            setImmediate(function () {
                callback(null, res);

                // Delay the end event to simulate long-running cleanup
                setTimeout(function () {
                    res.emit('end');
                }, 100);
            });

            return (res);
        }
    };

    var client2 = createMockUfdsClient();
    var log = createMockLogger();

    var firstCompleted = false;
    var secondCompleted = false;

    // Start first cleanup (will hold lock for 100ms)
    cleanup.cleanupExpiredCredentials(client1, log, function (err1) {
        t.ifError(err1, 'first cleanup should succeed');
        firstCompleted = true;

        if (secondCompleted) {
            t.ok(true, 'second cleanup exited before first completed');
            t.false(fs.existsSync(TEST_LOCK_PATH),
                'lock should be released after first cleanup');
            t.end();
        }
    }, TEST_LOCK_PATH);

    // Try to start second cleanup immediately (should fail)
    setImmediate(function () {
        cleanup.cleanupExpiredCredentials(client2, log, function (err2) {
            t.ok(err2, 'second cleanup should fail with lock error');
            t.ok(err2.message.indexOf('already running') !== -1,
                'error should mention another process is running');
            secondCompleted = true;

            if (firstCompleted) {
                t.false(fs.existsSync(TEST_LOCK_PATH),
                    'lock should be released after first cleanup');
                t.end();
            }
        }, TEST_LOCK_PATH);
    });
});

/* --- Test edge cases --- */

test('edge case - empty lock file', function (t) {
    cleanupLockFile();

    // Create empty lock file
    fs.writeFileSync(TEST_LOCK_PATH, '', 'utf8');

    var client = createMockUfdsClient();
    var log = createMockLogger();

    cleanup.cleanupExpiredCredentials(client, log, function (err) {
        t.ifError(err, 'should handle empty lock file');
        t.false(fs.existsSync(TEST_LOCK_PATH),
            'lock should be released after completion');
        t.end();
    }, TEST_LOCK_PATH);
});

test('edge case - lock file with PID 0', function (t) {
    cleanupLockFile();

    // PID 0 has special meaning (current process group) but should
    // never appear in a lock file from a real process
    fs.writeFileSync(TEST_LOCK_PATH, '0', 'utf8');

    var client = createMockUfdsClient();
    var log = createMockLogger();

    cleanup.cleanupExpiredCredentials(client, log, function (err) {
        t.ifError(err, 'should handle PID 0');
        t.false(fs.existsSync(TEST_LOCK_PATH),
            'lock should be released after completion');
        t.end();
    }, TEST_LOCK_PATH);
});

test('edge case - lock file with negative PID', function (t) {
    cleanupLockFile();

    // Negative PIDs are valid for process groups in kill(), but
    // process.pid is always positive, so this indicates corrupted data
    fs.writeFileSync(TEST_LOCK_PATH, '-1234', 'utf8');

    var client = createMockUfdsClient();
    var log = createMockLogger();

    cleanup.cleanupExpiredCredentials(client, log, function (err) {
        t.ifError(err, 'should handle negative PID as corrupted data');
        t.false(fs.existsSync(TEST_LOCK_PATH),
            'lock should be released after completion');
        t.end();
    }, TEST_LOCK_PATH);
});

test('edge case - lock file with very large PID', function (t) {
    cleanupLockFile();

    // Very large PID (INT32_MAX) - likely doesn't exist
    fs.writeFileSync(TEST_LOCK_PATH, '2147483647', 'utf8');

    var client = createMockUfdsClient();
    var log = createMockLogger();

    cleanup.cleanupExpiredCredentials(client, log, function (err) {
        t.ifError(err, 'should handle very large PID');
        t.false(fs.existsSync(TEST_LOCK_PATH),
            'lock should be released after completion');
        t.end();
    }, TEST_LOCK_PATH);
});

test('edge case - lock file with only whitespace', function (t) {
    cleanupLockFile();

    // Lock file contains only whitespace characters
    fs.writeFileSync(TEST_LOCK_PATH, '   \n\t  ', 'utf8');

    var client = createMockUfdsClient();
    var log = createMockLogger();

    cleanup.cleanupExpiredCredentials(client, log, function (err) {
        t.ifError(err, 'should handle whitespace-only lock file');
        t.false(fs.existsSync(TEST_LOCK_PATH),
            'lock should be released after completion');
        t.end();
    }, TEST_LOCK_PATH);
});

test('edge case - lock file with PID and extra data', function (t) {
    cleanupLockFile();

    // Lock file has valid PID but also extra lines of data
    fs.writeFileSync(TEST_LOCK_PATH, '99999\nextra data\nmore lines', 'utf8');

    var client = createMockUfdsClient();
    var log = createMockLogger();

    cleanup.cleanupExpiredCredentials(client, log, function (err) {
        t.ifError(err, 'should handle PID with extra data');
        t.false(fs.existsSync(TEST_LOCK_PATH),
            'lock should be released after completion');
        t.end();
    }, TEST_LOCK_PATH);
});

test('edge case - lock file with PID and trailing newline', function (t) {
    cleanupLockFile();

    // Lock file has PID with trailing newline (common when using echo)
    fs.writeFileSync(TEST_LOCK_PATH, '99999\n', 'utf8');

    var client = createMockUfdsClient();
    var log = createMockLogger();

    cleanup.cleanupExpiredCredentials(client, log, function (err) {
        t.ifError(err, 'should handle PID with trailing newline');
        t.false(fs.existsSync(TEST_LOCK_PATH),
            'lock should be released after completion');
        t.end();
    }, TEST_LOCK_PATH);
});
