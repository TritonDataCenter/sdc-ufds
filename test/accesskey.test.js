/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2025 Edgecast Cloud LLC.
 */

/**
 * @file accesskey.test.js
 * @brief Tests for accesskey schema validation including STS temporary
 *        credential fields.
 *
 * @section overview Overview
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
        return structuredClone(obj);
    }
    return JSON.parse(JSON.stringify(obj));
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
        expiration: ['2025-12-31T23:59:59.000Z'],
        principaluuid: ['930896af-bf8c-48d4-885c-6573a94b1853'],
        _owner: ['930896af-bf8c-48d4-885c-6573a94b1853']
    }
};


/**
 * @test validate permanent accesskey
 * @brief Verifies that a permanent (non-expiring) accesskey passes validation.
 */
test('validate permanent accesskey', function (t) {
    accesskey.validate(permanentEntry, config, undefined, function (err) {
        t.notOk(err);
        t.end();
    });
});


/**
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


/**
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


/**
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


/**
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


/**
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


/**
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
