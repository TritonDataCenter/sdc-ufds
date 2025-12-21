/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2025 Edgecast Cloud LLC.
 */

/*
 * Unit tests for lib/cleanup-expired-credentials.js
 * Tests batch processing of expired temporary credentials
 */

var test = require('tape');
var EventEmitter = require('events').EventEmitter;
var uuidv4 = require('uuid/v4');
var cleanup = require('../lib/cleanup-expired-credentials');

function uuid() {
    return (uuidv4());
}

// Mock bunyan logger
function createMockLogger() {
    return {
        debug: function () {},
        info: function () {},
        error: function () {},
        warn: function () {}
    };
}

// Mock UFDS client that simulates LDAP search and delete operations
function createMockUfdsClient(entries, deleteErrors) {
    deleteErrors = deleteErrors || {};
    var deletedDNs = [];

    return {
        search: function (base, opts, callback) {
            var res = new EventEmitter();

            setImmediate(function () {
                callback(null, res);

                setImmediate(function () {
                    var remaining = entries.slice(0, opts.sizeLimit ||
                        entries.length);

                    remaining.forEach(function (entry) {
                        res.emit('searchEntry', {object: entry});
                    });

                    // Remove emitted entries for next search
                    entries.splice(0, remaining.length);

                    res.emit('end');
                });
            });

            return (res);
        },

        del: function (dn, callback) {
            deletedDNs.push(dn);

            setImmediate(function () {
                if (deleteErrors[dn]) {
                    callback(new Error('Delete failed for ' + dn));
                } else {
                    callback();
                }
            });
        },

        getDeletedDNs: function () {
            return (deletedDNs);
        }
    };
}

// Generate mock expired credential entries
function generateExpiredCredentials(count) {
    var entries = [];
    var now = new Date();
    var expired = new Date(now.getTime() - (24 * 60 * 60 * 1000));

    for (var i = 0; i < count; i++) {
        var userUuid = uuid();
        entries.push({
            dn: 'accesskeyid=AKIA' + i + ', uuid=' + userUuid +
                ', ou=users, o=smartdc',
            accesskeyid: 'AKIA' + i,
            expiration: expired.toISOString()
        });
    }

    return (entries);
}

/* --- Test single batch (< 1000 credentials) --- */

test('single batch - all credentials deleted', function (t) {
    var entries = generateExpiredCredentials(500);
    var client = createMockUfdsClient(entries);
    var log = createMockLogger();

    cleanup.cleanupExpiredCredentials(client, log, function (err) {
        t.ifError(err, 'should not error');
        t.equal(client.getDeletedDNs().length, 500,
            'should delete all 500 credentials');
        t.end();
    });
});

test('single batch - empty (no credentials)', function (t) {
    var entries = [];
    var client = createMockUfdsClient(entries);
    var log = createMockLogger();

    cleanup.cleanupExpiredCredentials(client, log, function (err) {
        t.ifError(err, 'should not error');
        t.equal(client.getDeletedDNs().length, 0,
            'should delete zero credentials');
        t.end();
    });
});

/* --- Test multiple batches (> 1000 credentials) --- */

test('multiple batches - 2500 credentials across 3 batches', function (t) {
    var entries = generateExpiredCredentials(2500);
    var client = createMockUfdsClient(entries);
    var log = createMockLogger();

    cleanup.cleanupExpiredCredentials(client, log, function (err) {
        t.ifError(err, 'should not error');
        t.equal(client.getDeletedDNs().length, 2500,
            'should delete all 2500 credentials');
        t.end();
    });
});

test('multiple batches - exactly 2000 credentials (2 batches)',
    function (t) {
    var entries = generateExpiredCredentials(2000);
    var client = createMockUfdsClient(entries);
    var log = createMockLogger();

    cleanup.cleanupExpiredCredentials(client, log, function (err) {
        t.ifError(err, 'should not error');
        t.equal(client.getDeletedDNs().length, 2000,
            'should delete all 2000 credentials');
        t.end();
    });
});

test('multiple batches - exactly 1000 credentials (1 batch)', function (t) {
    var entries = generateExpiredCredentials(1000);
    var client = createMockUfdsClient(entries);
    var log = createMockLogger();

    cleanup.cleanupExpiredCredentials(client, log, function (err) {
        t.ifError(err, 'should not error');
        t.equal(client.getDeletedDNs().length, 1000,
            'should delete all 1000 credentials');
        t.end();
    });
});

/* --- Test error handling --- */

test('error handling - partial batch failures', function (t) {
    var entries = generateExpiredCredentials(10);
    var deleteErrors = {};

    // Make entries 3 and 7 fail to delete
    deleteErrors[entries[3].dn] = true;
    deleteErrors[entries[7].dn] = true;

    var client = createMockUfdsClient(entries, deleteErrors);
    var log = createMockLogger();

    cleanup.cleanupExpiredCredentials(client, log, function (err) {
        t.ok(err, 'should return error when deletions fail');
        t.ok(err.message.indexOf('Failed to delete 2') !== -1,
            'error should mention 2 failed deletions');
        t.equal(client.getDeletedDNs().length, 10,
            'should attempt all deletions despite failures');
        t.end();
    });
});

test('error handling - all deletions fail', function (t) {
    var entries = generateExpiredCredentials(5);
    var deleteErrors = {};

    entries.forEach(function (entry) {
        deleteErrors[entry.dn] = true;
    });

    var client = createMockUfdsClient(entries, deleteErrors);
    var log = createMockLogger();

    cleanup.cleanupExpiredCredentials(client, log, function (err) {
        t.ok(err, 'should return error when all deletions fail');
        t.ok(err.message.indexOf('Failed to delete 5') !== -1,
            'error should mention 5 failed deletions');
        t.end();
    });
});

test('error handling - failures across multiple batches', function (t) {
    var entries = generateExpiredCredentials(1500);
    var deleteErrors = {};

    // Fail entry 500 (batch 1) and entry 1200 (batch 2)
    deleteErrors[entries[500].dn] = true;
    deleteErrors[entries[1200].dn] = true;

    var client = createMockUfdsClient(entries, deleteErrors);
    var log = createMockLogger();

    cleanup.cleanupExpiredCredentials(client, log, function (err) {
        t.ok(err, 'should return error when deletions fail');
        t.ok(err.message.indexOf('Failed to delete 2') !== -1,
            'error should mention 2 failed deletions across batches');
        t.end();
    });
});

/* --- Test search error handling --- */

test('search error - LDAP search failure', function (t) {
    var client = {
        search: function (base, opts, callback) {
            setImmediate(function () {
                callback(new Error('LDAP connection failed'));
            });
        }
    };

    var log = createMockLogger();

    cleanup.cleanupExpiredCredentials(client, log, function (err) {
        t.ok(err, 'should return error when search fails');
        t.ok(err.message.indexOf('LDAP connection failed') !== -1,
            'should propagate search error');
        t.end();
    });
});

test('search error - search emits error event', function (t) {
    var client = {
        search: function (base, opts, callback) {
            var res = new EventEmitter();

            setImmediate(function () {
                callback(null, res);

                setImmediate(function () {
                    res.emit('error', new Error('Search timeout'));
                });
            });

            return (res);
        }
    };

    var log = createMockLogger();

    cleanup.cleanupExpiredCredentials(client, log, function (err) {
        t.ok(err, 'should return error when search emits error');
        t.ok(err.message.indexOf('Search timeout') !== -1,
            'should propagate search error event');
        t.end();
    });
});
