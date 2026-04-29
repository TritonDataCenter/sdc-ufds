/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 * Copyright 2026 Edgecast Cloud LLC.
 */

const util = require('util');

const ldap = require('ldapjs');
const accesskey = require('ufds/lib/accesskey');
const { DEFAULT_PREFIX, DEFAULT_BYTE_LENGTH } = accesskey;

const Validator = require('../lib/schema/validator');

const ID_RE = /^\w+$/;
const KEY_RE = /^[A-Za-z0-9_-]+$/;

const READONLY_ATTRS = ['accesskeyid', 'accesskeysecret', 'created'];

const STATUS_VALUES = ['Active', 'Inactive', 'Expired'];

/*
 * SCOPE CONTRACT: The constants and validation rules
 * below must match node-mahi/lib/scope-schema.js which
 * is the canonical source of truth for:
 *   - VALID_LEVELS: ['read', 'readwrite', 'full']
 *   - MAX_PERMISSIONS: 1000
 *   - Exact bucket names: full S3 naming rules
 *     (label structure, no IP lookalikes)
 *   - Wildcard prefixes: [a-z0-9][a-z0-9.\-]*
 *   - SCOPE_VERSION: 1
 *
 * If you change any of these values, update
 * scope-schema.js in node-mahi as well.
 */

/* Must match node-mahi scope-schema.js */
var VALID_LEVELS = ['read', 'readwrite', 'full'];

/* Must match node-mahi scope-schema.js */
var MAX_PERMISSIONS = 1000;

/*
 * Maximum raw string length (characters) for
 * accesskeyscope before JSON.parse.  Prevents
 * parsing arbitrarily large payloads on the LDAP
 * write path.  256K characters is generous for
 * 1000 permission entries (scope data is ASCII).
 */
var MAX_SCOPE_CHARS = 256 * 1024;

/*
 * Bucket label regex: a label is a sequence of
 * lowercase letters, numbers, and hyphens that does
 * not start or end with a hyphen.
 *
 * Matches manta-buckets-api/lib/buckets/common.js
 * bucketLabelRegexStr.
 */
var BUCKET_LABEL_RE_STR = '(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)';

/*
 * Full bucket name regex: one or more labels
 * separated by single periods.  No leading/trailing
 * periods, no consecutive periods.
 *
 * Matches manta-buckets-api bucketRegex.
 */
var BUCKET_NAME_RE = new RegExp(
    '^(?:' + BUCKET_LABEL_RE_STR + '\\.)*' + BUCKET_LABEL_RE_STR + '$'
);

/*
 * IP-address lookalike regex: four groups of 1-3
 * digits separated by periods.  S3 rejects these
 * even if they are not valid IP addresses.
 *
 * Matches manta-buckets-api resemblesIpRegex.
 */
var RESEMBLES_IP_RE = /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/;

/*
 * Loose prefix regex for wildcard scope patterns.
 * Only the prefix portion (before the trailing '*')
 * is validated.  We allow a trailing period or
 * hyphen here because 'logs-*' and 'us.east.*'
 * are legitimate prefix patterns even though
 * 'logs-' and 'us.east.' are not valid bucket
 * names on their own.
 */
var SCOPE_PREFIX_RE = /^[a-z0-9][a-z0-9.\-]*$/;

var MIN_BUCKET_NAME_LENGTH = 3;
var MAX_BUCKET_NAME_LENGTH = 63;

/*
 * Validate a scope bucket pattern.
 *
 * For exact names (no wildcard) the full S3 bucket
 * naming rules are enforced, matching the validation
 * in manta-buckets-api isValidBucketName:
 *   - 3-63 characters
 *   - labels separated by periods
 *   - each label starts/ends with alnum
 *   - no consecutive periods
 *   - no leading/trailing period or hyphen
 *   - must not resemble an IP address
 *
 * For wildcard patterns (trailing '*') only a
 * loose prefix check is applied since the prefix
 * does not need to be a complete bucket name.
 *
 * The bare pattern '*' matches all buckets.
 *
 * Wildcard grammar:
 *   '*'        — matches all buckets
 *   'prefix*'  — trailing wildcard
 *   'prefix-*' — trailing wildcard
 *   'exact'    — exact match, no wildcards
 *
 * Non-trailing wildcards are rejected:
 *   '*-logs'   — INVALID (leading wildcard)
 *   'pre-*-x'  — INVALID (middle wildcard)
 *
 * @param {string} pattern - The bucket pattern to
 *   validate.
 * @returns {string|null} Null if valid, or a string
 *   describing the failure reason.
 */
function validateScopeBucketPattern(pattern) {
    if (pattern === '*') {
        return null;
    }

    /*
     * Reject non-trailing wildcards: if '*' appears
     * anywhere except the last character, the pattern
     * is invalid.
     */
    var starPos = pattern.indexOf('*');
    if (starPos !== -1 && starPos !== pattern.length - 1) {
        return 'wildcard (*) only allowed' + ' as last character';
    }

    var isWildcard = pattern.charAt(pattern.length - 1) === '*';

    if (isWildcard) {
        /*
         * Wildcard pattern: validate the prefix
         * portion only with loose rules.
         */
        var prefix = pattern.substring(0, pattern.length - 1);
        if (prefix.length === 0) {
            return 'wildcard prefix must not' + ' be empty';
        }
        if (!SCOPE_PREFIX_RE.test(prefix)) {
            return (
                'prefix must contain only' +
                ' lowercase letters, numbers,' +
                ' hyphens, and periods');
        }
        return null;
    }

    /*
     * Exact name: enforce full S3 bucket naming
     * rules matching manta-buckets-api.
     */
    if (pattern.length < MIN_BUCKET_NAME_LENGTH) {
        return (
            'bucket name must be at least ' +
            MIN_BUCKET_NAME_LENGTH +
            ' characters');
    }
    if (RESEMBLES_IP_RE.test(pattern)) {
        return 'bucket name must not resemble' + ' an IP address';
    }
    if (!BUCKET_NAME_RE.test(pattern)) {
        return (
            'bucket name must be dot-separated' +
            ' labels of lowercase letters,' +
            ' numbers, and hyphens; labels' +
            ' must not start or end with' +
            ' a hyphen');
    }
    return null;
}

// --- API

function AccessKey() {
    Validator.call(this, {
        name: 'accesskey',
        required: {
            accesskeyid: 1,
            accesskeysecret: 1,
            status: 1,
            created: 1,
            updated: 1
        },
        optional: {
            description: 1,
            // STS temporary credential fields
            sessiontoken: 1,
            expiration: 1,
            principaluuid: 1,
            assumedrole: 1,
            credentialtype: 1,
            // Per-bucket access key scoping (JSON)
            accesskeyscope: 1
        },
        strict: true
    });
}
util.inherits(AccessKey, Validator);

/*
 * AccessKeys created before v7.5.0 will be missing required properties, have an
 * invalid accesskeysecret, and are unable to be used for authentication.
 * These AccessKeys weren't yet used anywhere within Triton but the undocumented
 * CloudAPI endpoints existed and its possible that some installations may have
 * some of these older entries. node-ufds and cloud-api will return
 * such keys as 'Inactive' but will need to be manually deleted from Moray as
 * UFDS's validation prevents updating or deleting these records:
 *
 * delobject ufds_o_smartdc \
 *   'accesskeyid=$ACCESSKEYID, uuid=$USER_UUID, ou=users, o=smartdc'
 *
 */

/*
 * Validate an access key entry.
 *
 * The operation parameter is passed down from lib/schema/index.js through
 * lib/schema/validator.js to allow operation-specific validation logic.
 * This is needed on the case of temporary credentials, as they require that
 * expiration be in the future for add/modify operations, but on delete we must
 * allow  expired credentials to be removed, as they are no longer useful.
 * Without knowing the operation type, we couldn't distinguish these cases.
 *
 * @param {Object} entry - The LDAP entry being validated
 * @param {Object} config - UFDS configuration
 * @param {Array|null} changes - Modifications (set for modify ops, null
 * for add/del)
 * @param {Function} callback - Callback function
 * @param {string} [operation] - Operation type: 'add', 'modify', or 'del'
 */
AccessKey.prototype.validate = function validate(
    entry,
    config,
    changes,
    callback,
    operation
) {
    const errors = [];

    // Skip validation when importing legacy entries:
    if (!config.ufds_is_master) {
        callback();
        return;
    }

    const id = entry.attributes.accesskeyid[0];
    const key = entry.attributes.accesskeysecret[0];

    if (!id || !ID_RE.test(id) || id.length < 16 || id.length > 128) {
        errors.push('accesskeyid: ' + id + ' is invalid');
    }

    if (
        !key ||
        !KEY_RE.test(key) ||
        !accesskey.validate(DEFAULT_PREFIX, DEFAULT_BYTE_LENGTH, key)) {
        errors.push('accesskeysecret is invalid');
    }

    if (
        entry.attributes.status &&
        STATUS_VALUES.indexOf(entry.attributes.status[0]) === -1) {
        errors.push('status must be one of: ' + STATUS_VALUES.join(', '));
    }

    if (
        entry.attributes.description &&
        entry.attributes.description[0] &&
        entry.attributes.description[0].length > 150) {
        errors.push('description must be 150 characters in length or less');
    }

    // Validate STS fields for temporary credentials
    var credentialType = entry.attributes.credentialtype
        ? entry.attributes.credentialtype[0]
        : 'permanent';

    if (credentialType === 'temporary') {
        // Session token is required for temporary credentials
        if (
            !entry.attributes.sessiontoken ||
            !entry.attributes.sessiontoken[0]) {
            errors.push('sessiontoken is required for temporary credentials');
        }

        // Expiration is required for temporary credentials
        if (!entry.attributes.expiration || !entry.attributes.expiration[0]) {
            errors.push('expiration is required for temporary credentials');
        } else {
            var exp = new Date(entry.attributes.expiration[0]);
            if (isNaN(exp.getTime())) {
                errors.push('expiration must be a valid ISO timestamp');
            } else if (operation !== 'del' && exp <= new Date()) {
                // On delete, skip this check: we need to delete expired
                // credentials, not reject them for being expired.
                errors.push('expiration must be in the future');
            }
        }

        // Principal UUID is required for temporary credentials
        if (
            !entry.attributes.principaluuid ||
            !entry.attributes.principaluuid[0]) {
            errors.push('principaluuid is required for temporary credentials');
        }
    }

    /**
     * Validate accesskeyscope if present.
     *
     * The scope is an optional JSON string that restricts
     * the access key to specific buckets. When absent or
     * null the key has unrestricted access (the default).
     *
     * Expected JSON structure:
     *   {
     *     'version': 1,
     *     'permissions': [
     *       { 'bucket': '<name>', 'level': '<level>' }
     *     ]
     *   }
     *
     * Invariants:
     *   - version must be exactly 1
     *   - permissions must be an array with 1..1000 entries
     *   - each entry must have a string bucket (1-63 chars) (AWS spec)
     *     and a level of 'read', 'readwrite', or 'full'
     *   - bucket names must use valid S3 characters
     *   - no duplicate bucket patterns
     *
     */
    if (entry.attributes.accesskeyscope && entry.attributes.accesskeyscope[0]) {
        var scopeRaw = entry.attributes.accesskeyscope[0];

        if (scopeRaw.length > MAX_SCOPE_CHARS) {
            errors.push(
                'accesskeyscope: raw value exceeds' +
                    ' maximum size of ' +
                    MAX_SCOPE_CHARS +
                    ' characters');
        }

        var scope;
        if (scopeRaw.length <= MAX_SCOPE_CHARS) {
            try {
                scope = JSON.parse(scopeRaw);
            } catch (e) {
                errors.push(
                    'accesskeyscope: invalid JSON' + ' format: ' + e.message);
                scope = null;
            }

            if (scope !== null) {
                if (scope.version !== 1) {
                    errors.push('accesskeyscope: version' + ' must be 1');
                }

                if (!Array.isArray(scope.permissions)) {
                    errors.push(
                        'accesskeyscope: permissions' + ' must be an array');
                } else {
                    if (scope.permissions.length === 0) {
                        errors.push(
                            'accesskeyscope:' +
                                ' permissions array' +
                                ' must contain at' +
                                ' least one entry');
                    } else if (scope.permissions.length > MAX_PERMISSIONS) {
                        errors.push(
                            'accesskeyscope:' +
                                ' permissions array' +
                                ' exceeds maximum' +
                                ' of ' +
                                MAX_PERMISSIONS +
                                ' entries');
                    } else {
                        /*
                         * Per-entry validation:
                         * only runs when array
                         * size is in bounds
                         * [1, MAX_PERMISSIONS].
                         */
                        for (var i = 0; i < scope.permissions.length; i++) {
                            var perm = scope.permissions[i];
                            var pfx =
                                'accesskeyscope:' + ' permissions[' + i + ']';

                            if (
                              (typeof (perm.bucket)) !== 'string' ||
                                perm.bucket.length < 1 ||
                                perm.bucket.length > MAX_BUCKET_NAME_LENGTH) {
                                errors.push(
                                    pfx +
                                        '.bucket must' +
                                        ' be a string' +
                                        ' (1-' +
                                        MAX_BUCKET_NAME_LENGTH +
                                        ' characters)');
                            } else {
                                var bucketErr = validateScopeBucketPattern(
                                    perm.bucket);
                                if (bucketErr) {
                                    errors.push(pfx + '.bucket: ' + bucketErr);
                                }
                            }

                            if (VALID_LEVELS.indexOf(perm.level) === -1) {
                                errors.push(
                                    pfx +
                                        '.level must' +
                                        ' be one of: ' +
                                        VALID_LEVELS.join(', '));
                            }
                        }

                        /* Duplicate bucket check */
                        var seen = {};
                        for (var j = 0; j < scope.permissions.length; j++) {
                            var b = scope.permissions[j].bucket;
                            if (b && seen[b]) {
                                errors.push(
                                    'accesskeyscope' +
                                        ': duplicate' +
                                        ' bucket' +
                                        ' pattern ' +
                                        b);
                                break;
                            }
                            seen[b] = true;
                        }
                    }
                }
            }
        }
    }

    if (
        changes &&
        changes.some(function (c) {
            return READONLY_ATTRS.indexOf(c._modification.type) !== -1; })) {
        errors.push(
            READONLY_ATTRS.join(', ') + ' attributes can not be modified');
    }

    if (errors.length) {
        callback(new ldap.ConstraintViolationError(errors.join('\n')));
        return;
    }

    callback();
};
// --- Exports

module.exports = {
    createInstance: function createInstance() {
        return new AccessKey();
    }
};
