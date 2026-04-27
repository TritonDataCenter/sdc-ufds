/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2026 Edgecast Cloud LLC.
 */

/*
 * @file accesskey.test.js
 * @brief Tests for accesskey schema validation including STS temporary
 *        credential fields.
 *
 * @section Overview
 *
 * This test suite validates the accesskey schema which supports two types
 * of credentials:
 *
 * 1. **Permanent credentials**: Long-lived access keys that do not expire.
 *    Used for regular API access.
 *
 * 2. **Temporary credentials (STS)**: Short-lived credentials issued by the
 *    Security Token Service. These expire after a configured duration and
 *    require additional fields.
 *
 * 3. **Bucket Scoped credentials**: Permanent credentials which have
 *    a restricted set of permissions to a predefined list of buckets.
 *
 * @section sts_fields STS Temporary Credential Fields
 *
 * When `credentialtype` is set to `temporary`, the following additional
 * fields are required:
 *
 * - **sessiontoken**: A unique token that must be included with API requests
 *   alongside the accesskeyid and accesskeysecret. This provides an
 *   additional layer of security for temporary credentials.
 *
 * - **expiration**: ISO 8601 timestamp indicating when the credential
 *   expires. Must be in the future at creation time. After expiration,
 *   the credential is no longer valid for authentication and will be
 *   cleaned up by the cleanup job.
 *
 * - **principaluuid**: UUID of the user (principal) who owns or requested
 *   the temporary credential. In AWS STS terminology, the principal is
 *   the entity (user, role, or service) that is authenticated. This field
 *   links the temporary credential back to its owner for auditing and
 *   access control.
 *
 * - **assumedrole** (optional): If the credential was issued via
 *   AssumeRole, this contains the role ARN that was assumed.
 *
 * @section cleanup Credential Cleanup
 *
 * Expired temporary credentials are removed by the cleanup job which runs
 * periodically. The cleanup process:
 *
 * 1. Searches for entries where expiration <= current time
 * 2. Deletes each expired entry (validation is skipped for deletes)
 * 3. Rate limits deletions to avoid overloading Moray
 *
 * @see lib/cleanup-expired-credentials.js
 * @see schema/accesskey.js
 */

var test = require('tape');
var accesskey = require('../schema/accesskey.js').createInstance();
var config = {
    ufds_is_master: true
};

function cloneObj(obj) {
    // No structuredClone until Node v17
    if (typeof (structuredClone) === 'function') {
        return (structuredClone(obj));
    }
    return (JSON.parse(JSON.stringify(obj)));
}

// Test data
var permanentEntry = {
    dn: 'accesskeyid=6ea33abf502acd6ee6cbe5534e1fe4e0, ' +
        'uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc',
    attributes: {
        accesskeyid: ['6ea33abf502acd6ee6cbe5534e1fe4e0'],
        accesskeysecret: [
            'tdc_a5KqcLnh_q1-G6B302AULue6xc_-6B6ygUPbg3oWsWOH_CuY'
        ],
        created: ['1763666729070'],
        objectclass: ['accesskey'],
        status: ['Active'],
        updated: ['1763666729070'],
        _owner: ['930896af-bf8c-48d4-885c-6573a94b1853']
    }
};

var temporaryEntry = {
    dn: 'accesskeyid=7fa44bcg603bde7ff7dcf6645f2gf5f1, ' +
        'uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc',
    attributes: {
        accesskeyid: ['7fa44bcg603bde7ff7dcf6645f2gf5f1'],
        accesskeysecret: [
            'tdc_a5KqcLnh_q1-G6B302AULue6xc_-6B6ygUPbg3oWsWOH_CuY'
        ],
        created: ['1763666729070'],
        objectclass: ['accesskey'],
        status: ['Active'],
        updated: ['1763666729070'],
        credentialtype: ['temporary'],
        sessiontoken: ['test-session-token-12345'],
        expiration: ['2030-12-31T23:59:59.000Z'],
        principaluuid: ['930896af-bf8c-48d4-885c-6573a94b1853'],
        _owner: ['930896af-bf8c-48d4-885c-6573a94b1853']
    }
};


/*
 * @test validate permanent accesskey
 * @brief Verifies that a permanent (non-expiring) accesskey passes validation.
 */
test('validate permanent accesskey', function (t) {
    accesskey.validate(permanentEntry, config, undefined, function (err) {
        t.notOk(err);
        t.end();
    });
});


/*
 * @test validate temporary accesskey with all STS fields
 * @brief Verifies that a temporary credential with all required STS
 *        fields passes validation.
 */
test('validate temporary accesskey with all STS fields', function (t) {
    accesskey.validate(temporaryEntry, config, undefined, function (err) {
        t.notOk(err);
        t.end();
    });
});


/*
 * @test temporary accesskey missing sessiontoken
 * @brief Verifies that temporary credentials fail validation without
 *        a sessiontoken.
 */
test('temporary accesskey missing sessiontoken', function (t) {
    var invalidEntry = cloneObj(temporaryEntry);
    delete invalidEntry.attributes.sessiontoken;

    accesskey.validate(invalidEntry, config, undefined, function (err) {
        t.ok(err, 'should fail without sessiontoken');
        t.equal(err.name, 'ConstraintViolationError');
        t.ok(err.message.indexOf('sessiontoken') !== -1);
        t.end();
    });
});


/*
 * @test temporary accesskey missing expiration
 * @brief Verifies that temporary credentials fail validation without
 *        an expiration timestamp.
 */
test('temporary accesskey missing expiration', function (t) {
    var invalidEntry = cloneObj(temporaryEntry);
    delete invalidEntry.attributes.expiration;

    accesskey.validate(invalidEntry, config, undefined, function (err) {
        t.ok(err, 'should fail without expiration');
        t.equal(err.name, 'ConstraintViolationError');
        t.ok(err.message.indexOf('expiration') !== -1);
        t.end();
    });
});


/*
 * @test temporary accesskey missing principaluuid
 * @brief Verifies that temporary credentials fail validation without
 *        a principaluuid.
 */
test('temporary accesskey missing principaluuid', function (t) {
    var invalidEntry = cloneObj(temporaryEntry);
    delete invalidEntry.attributes.principaluuid;

    accesskey.validate(invalidEntry, config, undefined, function (err) {
        t.ok(err, 'should fail without principaluuid');
        t.equal(err.name, 'ConstraintViolationError');
        t.ok(err.message.indexOf('principaluuid') !== -1);
        t.end();
    });
});


/*
 * @test temporary accesskey with expired timestamp
 * @brief Verifies that temporary credentials cannot be created with
 *        an expiration time in the past.
 */
test('temporary accesskey with expired timestamp', function (t) {
    var invalidEntry = cloneObj(temporaryEntry);
    var past = new Date(Date.now() - 3600000).toISOString(); // -1 hour
    invalidEntry.attributes.expiration = [past];

    accesskey.validate(invalidEntry, config, undefined, function (err) {
        t.ok(err, 'should fail with past expiration');
        t.equal(err.name, 'ConstraintViolationError');
        t.ok(err.message.indexOf('future') !== -1);
        t.end();
    });
});


/*
 * @test temporary accesskey with invalid expiration format
 * @brief Verifies that expiration must be a valid ISO 8601 timestamp.
 */
test('temporary accesskey with invalid expiration format', function (t) {
    var invalidEntry = cloneObj(temporaryEntry);
    invalidEntry.attributes.expiration = ['not-a-valid-timestamp'];

    accesskey.validate(invalidEntry, config, undefined, function (err) {
        t.ok(err, 'should fail with invalid expiration');
        t.equal(err.name, 'ConstraintViolationError');
        t.ok(err.message.indexOf('valid ISO') !== -1);
        t.end();
    });
});


// ============================================================
// Per-bucket access key scope validation
// (must match node-mahi/lib/scope-schema.js contract)
// ============================================================

var VALID_SCOPE = JSON.stringify({
    version: 1,
    permissions: [
        { bucket: 'app-data', level: 'readwrite' },
        { bucket: 'logs-*', level: 'read' }
    ]
});


test('scope: valid scope accepted', function (t) {
    var entry = cloneObj(permanentEntry);
    entry.attributes.accesskeyscope = [VALID_SCOPE];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.notOk(err, 'valid scope should pass');
        t.end();
    });
});


test('scope: absent scope accepted (unrestricted)',
    function (t) {
    var entry = cloneObj(permanentEntry);
    /* no accesskeyscope attribute at all */

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.notOk(err,
            'missing scope = unrestricted, should pass');
        t.end();
    });
});


test('scope: invalid JSON rejected', function (t) {
    var entry = cloneObj(permanentEntry);
    entry.attributes.accesskeyscope = ['{bad json'];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.ok(err, 'invalid JSON should fail');
        t.ok(err.message.indexOf('invalid JSON') !== -1);
        t.end();
    });
});


test('scope: wrong version rejected', function (t) {
    var entry = cloneObj(permanentEntry);
    entry.attributes.accesskeyscope = [JSON.stringify({
        version: 2,
        permissions: [
            { bucket: 'bkt', level: 'read' }
        ]
    })];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.ok(err, 'version 2 should fail');
        t.ok(err.message.indexOf('version') !== -1);
        t.end();
    });
});


test('scope: permissions must be array', function (t) {
    var entry = cloneObj(permanentEntry);
    entry.attributes.accesskeyscope = [JSON.stringify({
        version: 1,
        permissions: 'not-an-array'
    })];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.ok(err, 'non-array permissions should fail');
        t.ok(err.message.indexOf('array') !== -1);
        t.end();
    });
});


test('scope: bucket too short rejected', function (t) {
    var entry = cloneObj(permanentEntry);
    entry.attributes.accesskeyscope = [JSON.stringify({
        version: 1,
        permissions: [
            { bucket: '', level: 'read' }
        ]
    })];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.ok(err, 'empty bucket name should fail');
        t.ok(err.message.indexOf('bucket') !== -1);
        t.end();
    });
});


test('scope: bucket too long rejected', function (t) {
    var entry = cloneObj(permanentEntry);
    /* 64 chars exceeds 63 max */
    var longName = '';
    for (var i = 0; i < 64; i++) {
        longName += 'a';
    }
    entry.attributes.accesskeyscope = [JSON.stringify({
        version: 1,
        permissions: [
            { bucket: longName, level: 'read' }
        ]
    })];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.ok(err, '64-char bucket name should fail');
        t.ok(err.message.indexOf('bucket') !== -1);
        t.end();
    });
});


test('scope: invalid bucket chars rejected',
    function (t) {
    var entry = cloneObj(permanentEntry);
    entry.attributes.accesskeyscope = [JSON.stringify({
        version: 1,
        permissions: [
            { bucket: 'UPPERCASE', level: 'read' }
        ]
    })];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.ok(err, 'uppercase bucket name should fail');
        t.ok(
            err.message.indexOf('dot-separated') !== -1,
            'should mention label format');
        t.end();
    });
});


test('scope: trailing wildcard accepted', function (t) {
    var entry = cloneObj(permanentEntry);
    entry.attributes.accesskeyscope = [JSON.stringify({
        version: 1,
        permissions: [
            { bucket: 'logs-*', level: 'read' }
        ]
    })];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.notOk(err, 'trailing wildcard should pass');
        t.end();
    });
});


test('scope: bare wildcard * accepted', function (t) {
    var entry = cloneObj(permanentEntry);
    entry.attributes.accesskeyscope = [JSON.stringify({
        version: 1,
        permissions: [
            { bucket: '*', level: 'full' }
        ]
    })];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.notOk(err, 'bare * should pass');
        t.end();
    });
});


test('scope: leading wildcard rejected', function (t) {
    var entry = cloneObj(permanentEntry);
    entry.attributes.accesskeyscope = [JSON.stringify({
        version: 1,
        permissions: [
            { bucket: '*-logs', level: 'read' }
        ]
    })];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.ok(err, 'leading wildcard should fail');
        t.ok(
            err.message.indexOf('last character') !== -1,
            'should mention wildcard position');
        t.end();
    });
});


test('scope: middle wildcard rejected', function (t) {
    var entry = cloneObj(permanentEntry);
    entry.attributes.accesskeyscope = [JSON.stringify({
        version: 1,
        permissions: [
            { bucket: 'pre-*-suf', level: 'read' }
        ]
    })];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.ok(err, 'middle wildcard should fail');
        t.ok(
            err.message.indexOf('last character') !== -1,
            'should mention wildcard position');
        t.end();
    });
});


test('scope: invalid level rejected', function (t) {
    var entry = cloneObj(permanentEntry);
    entry.attributes.accesskeyscope = [JSON.stringify({
        version: 1,
        permissions: [
            { bucket: 'bkt', level: 'admin' }
        ]
    })];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.ok(err, 'invalid level should fail');
        t.ok(err.message.indexOf('level') !== -1);
        t.end();
    });
});


test('scope: all three levels accepted', function (t) {
    var entry = cloneObj(permanentEntry);
    entry.attributes.accesskeyscope = [JSON.stringify({
        version: 1,
        permissions: [
            { bucket: 'aaa', level: 'read' },
            { bucket: 'bbb', level: 'readwrite' },
            { bucket: 'ccc', level: 'full' }
        ]
    })];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.notOk(err,
            'read, readwrite, full should all pass');
        t.end();
    });
});


test('scope: duplicate bucket pattern rejected',
    function (t) {
    var entry = cloneObj(permanentEntry);
    entry.attributes.accesskeyscope = [JSON.stringify({
        version: 1,
        permissions: [
            { bucket: 'dup', level: 'read' },
            { bucket: 'dup', level: 'full' }
        ]
    })];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.ok(err, 'duplicate bucket should fail');
        t.ok(err.message.indexOf('duplicate') !== -1);
        t.end();
    });
});


test('scope: empty permissions array rejected',
    function (t) {
    var entry = cloneObj(permanentEntry);
    entry.attributes.accesskeyscope = [JSON.stringify({
        version: 1,
        permissions: []
    })];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.ok(err,
            'empty permissions array should fail');
        t.ok(err.message.indexOf('at least one') !== -1);
        t.end();
    });
});


test('scope: exactly 1000 entries accepted',
    function (t) {
    var entry = cloneObj(permanentEntry);
    var perms = [];
    for (var i = 0; i < 1000; i++) {
        perms.push({
            bucket: 'b-' + i,
            level: 'read'
        });
    }
    entry.attributes.accesskeyscope = [JSON.stringify({
        version: 1,
        permissions: perms
    })];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.notOk(err,
            'exactly 1000 entries should pass');
        t.end();
    });
});


test('scope: max 1000 entries enforced', function (t) {
    var entry = cloneObj(permanentEntry);
    var perms = [];
    for (var i = 0; i < 1001; i++) {
        perms.push({
            bucket: 'b-' + i,
            level: 'read'
        });
    }
    entry.attributes.accesskeyscope = [JSON.stringify({
        version: 1,
        permissions: perms
    })];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.ok(err, '1001 entries should fail');
        t.ok(err.message.indexOf('maximum') !== -1 ||
            err.message.indexOf('1000') !== -1);
        t.end();
    });
});


test('scope: oversized raw value rejected',
    function (t) {
    var entry = cloneObj(permanentEntry);
    /*
     * Create a string larger than 256 KiB.
     * Use a repeated character padded into a
     * valid-looking JSON wrapper.
     */
    var big = '{"version":1,"permissions":[';
    var pad = '{"bucket":"a","level":"read"},';
    while (big.length < (256 * 1024 + 1)) {
        big += pad;
    }
    big += '{"bucket":"z","level":"read"}]}';
    entry.attributes.accesskeyscope = [big];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.ok(err, 'oversized scope should fail');
        t.ok(err.message.indexOf('maximum size') !== -1);
        t.end();
    });
});


// ============================================================
// Exact bucket name: S3 naming enforcement
// (must match manta-buckets-api isValidBucketName)
// ============================================================

test('scope: exact name under 3 chars rejected',
    function (t) {
    var entry = cloneObj(permanentEntry);
    entry.attributes.accesskeyscope = [JSON.stringify({
        version: 1,
        permissions: [
            { bucket: 'ab', level: 'read' }
        ]
    })];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.ok(err, '2-char exact name should fail');
        t.ok(err.message.indexOf('at least 3') !== -1,
            'should mention minimum length');
        t.end();
    });
});


test('scope: exact name with 3 chars accepted',
    function (t) {
    var entry = cloneObj(permanentEntry);
    entry.attributes.accesskeyscope = [JSON.stringify({
        version: 1,
        permissions: [
            { bucket: 'abc', level: 'read' }
        ]
    })];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.notOk(err, '3-char exact name should pass');
        t.end();
    });
});


test('scope: exact name consecutive periods rejected',
    function (t) {
    var entry = cloneObj(permanentEntry);
    entry.attributes.accesskeyscope = [JSON.stringify({
        version: 1,
        permissions: [
            { bucket: 'my..bucket', level: 'read' }
        ]
    })];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.ok(err,
            'consecutive periods should fail');
        t.ok(
            err.message.indexOf('dot-separated') !== -1,
            'should mention label format');
        t.end();
    });
});


test('scope: exact name trailing period rejected',
    function (t) {
    var entry = cloneObj(permanentEntry);
    entry.attributes.accesskeyscope = [JSON.stringify({
        version: 1,
        permissions: [
            { bucket: 'mybucket.', level: 'read' }
        ]
    })];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.ok(err, 'trailing period should fail');
        t.ok(
            err.message.indexOf('dot-separated') !== -1,
            'should mention label format');
        t.end();
    });
});


test('scope: exact name trailing hyphen rejected',
    function (t) {
    var entry = cloneObj(permanentEntry);
    entry.attributes.accesskeyscope = [JSON.stringify({
        version: 1,
        permissions: [
            { bucket: 'mybucket-', level: 'read' }
        ]
    })];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.ok(err, 'trailing hyphen should fail');
        t.ok(
            err.message.indexOf('dot-separated') !== -1,
            'should mention label format');
        t.end();
    });
});


test('scope: exact name resembling IP rejected',
    function (t) {
    var entry = cloneObj(permanentEntry);
    entry.attributes.accesskeyscope = [JSON.stringify({
        version: 1,
        permissions: [
            { bucket: '192.168.1.1', level: 'read' }
        ]
    })];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.ok(err, 'IP-like bucket name should fail');
        t.ok(
            err.message.indexOf('IP address') !== -1,
            'should mention IP address');
        t.end();
    });
});


test('scope: exact name with labels accepted',
    function (t) {
    var entry = cloneObj(permanentEntry);
    entry.attributes.accesskeyscope = [JSON.stringify({
        version: 1,
        permissions: [
            { bucket: 'my.bucket.name',
              level: 'read' }
        ]
    })];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.notOk(err,
            'dotted label bucket should pass');
        t.end();
    });
});


test('scope: wildcard prefix allows trailing hyphen',
    function (t) {
    var entry = cloneObj(permanentEntry);
    entry.attributes.accesskeyscope = [JSON.stringify({
        version: 1,
        permissions: [
            { bucket: 'logs-*', level: 'read' }
        ]
    })];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.notOk(err,
            'trailing hyphen in prefix should pass');
        t.end();
    });
});


test('scope: wildcard prefix allows trailing period',
    function (t) {
    var entry = cloneObj(permanentEntry);
    entry.attributes.accesskeyscope = [JSON.stringify({
        version: 1,
        permissions: [
            { bucket: 'us.east.*', level: 'read' }
        ]
    })];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.notOk(err,
            'trailing period in prefix should pass');
        t.end();
    });
});


test('scope: wildcard prefix single char accepted',
    function (t) {
    var entry = cloneObj(permanentEntry);
    entry.attributes.accesskeyscope = [JSON.stringify({
        version: 1,
        permissions: [
            { bucket: 'a*', level: 'read' }
        ]
    })];

    accesskey.validate(entry, config, undefined,
        function (err) {
        t.notOk(err,
            'single char wildcard prefix should pass');
        t.end();
    });
});
