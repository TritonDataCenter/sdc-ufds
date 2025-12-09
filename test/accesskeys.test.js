/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2025 Edgecast Cloud LLC.
 */

/*
 * @file accesskeys.test.js
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

const test = require('tape');
const accesskey = require('../schema/accesskey.js').createInstance()
const config = {
    ufds_is_master: true
};

const entry = {
    dn:'accesskeyid=6ea33abf502acd6ee6cbe5534e1fe4e0, ' +
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

const changedEntry = {
    dn: {
        rdns:[
            {accesskeyid: '6ea33abf502acd6ee6cbe5534e1fe4e0'},
            {uuid: '930896af-bf8c-48d4-885c-6573a94b1853'},
            {ou: 'users'},
            {o: 'smartdc'}
        ],
        rdnSpaced:true,
        length:4
    },
    attributes: {
        accesskeyid: ['6ea33abf502acd6ee6cbe5534e1fe4e0'],
        accesskeysecret: [
            'tdc_a5KqcLnh_q1-G6B302AULue6xc_-6B6ygUPbg3oWsWOH_CuY'
        ],
        created: ['1763666729070'],
        objectclass: ['accesskey'],
        status: ['Expired'],
        updated: ['1763669946252'],
        _owner: ['930896af-bf8c-48d4-885c-6573a94b1853'],
        _parent: [
            'uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc'
        ]
    }
};

const tempKeyEntry = {
    dn:'accesskeyid=MSTS4F2A1B3C9E7D8A6F, ' +
        'uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc',
    attributes: {
        accesskeyid: ['MSTS4F2A1B3C9E7D8A6F'],
        accesskeysecret: [
            'tdc_a5KqcLnh_q1-G6B302AULue6xc_-6B6ygUPbg3oWsWOH_CuY'
        ],
        created: ['1763666729070'],
        objectclass: ['accesskey'],
        status: ['Active'],
        updated: ['1763666729070'],
        credentialtype: ['temporary'],
        sessiontoken: ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.token'],
        expiration: [new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()],
        principaluuid: ['930896af-bf8c-48d4-885c-6573a94b1853'],
        _owner: ['930896af-bf8c-48d4-885c-6573a94b1853']
    }
};

function cloneObj(obj) {
    // No structuredClone until Node v17
    if (typeof (structuredClone) === 'function') {
        return structuredClone(obj);
    }
    return JSON.parse(JSON.stringify(obj));
}

/*
 * Permanent Access Key Tests
 */

test('validate accesskey (add valid key)', function (t) {
    accesskey.validate(entry, config, undefined, function (err) {
        t.notOk(err);
        t.end();
    })
});

test('validate accesskey (add key, invalid status)', function (t) {
    const invalidEntry = cloneObj(entry);
    invalidEntry.attributes.status = ['Bogus'];
    accesskey.validate(invalidEntry, config, undefined, function (err) {
        t.equal(err.name, 'ConstraintViolationError');
        t.equal(err.message,
            'status must be one of: Active, Inactive, Expired');
        t.end();
    })
});

test('validate accesskey (add key, invalid description)', function (t) {
    const invalidEntry = cloneObj(entry);
    invalidEntry.attributes.description = ['Lorem ipsum dolor sit amet ' +
        'consectetur adipiscing elit. Quisque faucibus ex sapien vitae ' +
        'pellentesque sem placerat. In id cursus mi pretium tellus duis ' +
        'convallis.'];
    accesskey.validate(invalidEntry, config, undefined, function (err) {
        t.equal(err.name, 'ConstraintViolationError');
        t.equal(err.message,
            'description must be 150 characters in length or less');
        t.end();
    })
});

test('validate accesskey (add key, invalid secret key)', function (t) {
    const invalidEntry = cloneObj(entry);
    invalidEntry.attributes.accesskeysecret = [
        // Changed a single char breaking the CRC
        'tdc_a5KqcLnh_q0-G6B312AULue6xc_-6B6ygUPbg3oWsWOH_CuY'
    ];
    accesskey.validate(invalidEntry, config, undefined, function (err) {
        t.equal(err.name, 'ConstraintViolationError');
        t.equal(err.message, 'accesskeysecret is invalid');
        t.end();
    })
});

test('validate accesskey (add key, invalid access key id)', function (t) {
    const invalidEntry = cloneObj(entry);
    invalidEntry.attributes.accesskeyid = ['nope'];
    accesskey.validate(invalidEntry, config, undefined, function (err) {
        t.equal(err.name, 'ConstraintViolationError');
        t.equal(err.message, 'accesskeyid: nope is invalid');
        t.end();
    })
});

test('validate accesskey (update accesskey status)', function (t) {
    const changes = [
        {_modification: {type: 'status'}},
        {_modification: {type:'updated'}}
    ];
    accesskey.validate(changedEntry, config, changes, function (err) {
        t.notOk(err);
        t.end();
    })
});

const readonlyAttrMsg = 'accesskeyid, accesskeysecret, created attributes can ' +
    'not be modified';

test('validate accesskey (update readonly created attr)', function (t) {
    const changes = [
        {_modification: {type:'created'}}
    ];
    accesskey.validate(changedEntry, config, changes, function (err) {
        t.equal(err.name, 'ConstraintViolationError');
        t.equal(err.message, readonlyAttrMsg);
        t.end();
    })
});

test('validate accesskey (update readonly accesskeyid attr)', function (t) {
    const changes = [
        {_modification: {type:'accesskeyid'}}
    ];
    accesskey.validate(changedEntry, config, changes, function (err) {
        t.equal(err.name, 'ConstraintViolationError');
        t.equal(err.message, readonlyAttrMsg);
        t.end();
    })
});

test('validate accesskey (update readonly accesskeysecret attr)', function (t) {
    const changes = [
        {_modification: {type:'accesskeysecret'}}
    ];
    accesskey.validate(changedEntry, config, changes, function (err) {
        t.equal(err.name, 'ConstraintViolationError');
        t.equal(err.message, readonlyAttrMsg);
        t.end();
    })
});

/*
 * Temporary Access Key Tests
 */

test('validate accesskey (add valid temporary key with expiration)', function (t) {
    accesskey.validate(tempKeyEntry, config, undefined, function (err) {
        t.notOk(err);
        t.end();
    })
});

test('validate accesskey (temporary key missing sessiontoken)', function (t) {
    const invalidEntry = cloneObj(tempKeyEntry);
    delete invalidEntry.attributes.sessiontoken;
    accesskey.validate(invalidEntry, config, undefined, function (err) {
        t.ok(err, 'should fail without sessiontoken');
        t.equal(err.name, 'ConstraintViolationError');
        t.ok(err.message.indexOf('sessiontoken') !== -1);
        t.end();
    })
});

test('validate accesskey (temporary key missing expiration)', function (t) {
    const invalidEntry = cloneObj(tempKeyEntry);
    delete invalidEntry.attributes.expiration;
    accesskey.validate(invalidEntry, config, undefined, function (err) {
        t.ok(err, 'should fail without expiration');
        t.equal(err.name, 'ConstraintViolationError');
        t.ok(err.message.indexOf('expiration') !== -1);
        t.end();
    })
});

test('validate accesskey (temporary key missing principaluuid)', function (t) {
    const invalidEntry = cloneObj(tempKeyEntry);
    delete invalidEntry.attributes.principaluuid;
    accesskey.validate(invalidEntry, config, undefined, function (err) {
        t.ok(err, 'should fail without principaluuid');
        t.equal(err.name, 'ConstraintViolationError');
        t.ok(err.message.indexOf('principaluuid') !== -1);
        t.end();
    })
});

test('validate accesskey (add temporary key with past expiration)', function (t) {
    const invalidEntry = cloneObj(tempKeyEntry);
    invalidEntry.attributes.expiration = [new Date('2020-01-01').toISOString()];
    accesskey.validate(invalidEntry, config, undefined, function (err) {
        t.equal(err.name, 'ConstraintViolationError');
        t.equal(err.message, 'expiration must be in the future');
        t.end();
    })
});

test('validate accesskey (add temporary key with invalid expiration format)', function (t) {
    const invalidEntry = cloneObj(tempKeyEntry);
    invalidEntry.attributes.expiration = ['not-a-valid-date'];
    accesskey.validate(invalidEntry, config, undefined, function (err) {
        t.equal(err.name, 'ConstraintViolationError');
        t.equal(err.message, 'expiration must be a valid ISO timestamp');
        t.end();
    })
});

test('validate accesskey (update expiration on temporary key)', function (t) {
    const changedTempEntry = cloneObj(tempKeyEntry);
    changedTempEntry.dn = {
        rdns:[
            {accesskeyid: 'MSTS4F2A1B3C9E7D8A6F'},
            {uuid: '930896af-bf8c-48d4-885c-6573a94b1853'},
            {ou: 'users'},
            {o: 'smartdc'}
        ],
        rdnSpaced:true,
        length:4
    };
    changedTempEntry.attributes.expiration = [new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()];
    changedTempEntry.attributes.updated = ['1763670000000'];
    changedTempEntry.attributes._parent = [
        'uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc'
    ];

    const changes = [
        {_modification: {type: 'expiration'}},
        {_modification: {type: 'updated'}}
    ];
    accesskey.validate(changedTempEntry, config, changes, function (err) {
        t.notOk(err);
        t.end();
    })
});

test('validate accesskey (update temporary key status to Inactive)', function (t) {
    const changedTempEntry = cloneObj(tempKeyEntry);
    changedTempEntry.dn = {
        rdns:[
            {accesskeyid: 'MSTS4F2A1B3C9E7D8A6F'},
            {uuid: '930896af-bf8c-48d4-885c-6573a94b1853'},
            {ou: 'users'},
            {o: 'smartdc'}
        ],
        rdnSpaced:true,
        length:4
    };
    changedTempEntry.attributes.status = ['Inactive'];
    changedTempEntry.attributes.updated = ['1763670000000'];
    changedTempEntry.attributes._parent = [
        'uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc'
    ];

    const changes = [
        {_modification: {type: 'status'}},
        {_modification: {type: 'updated'}}
    ];
    accesskey.validate(changedTempEntry, config, changes, function (err) {
        t.notOk(err);
        t.end();
    })
});

test('validate accesskey (update temporary key status to Expired)', function (t) {
    const changedTempEntry = cloneObj(tempKeyEntry);
    changedTempEntry.dn = {
        rdns:[
            {accesskeyid: 'MSTS4F2A1B3C9E7D8A6F'},
            {uuid: '930896af-bf8c-48d4-885c-6573a94b1853'},
            {ou: 'users'},
            {o: 'smartdc'}
        ],
        rdnSpaced:true,
        length:4
    };
    changedTempEntry.attributes.status = ['Expired'];
    changedTempEntry.attributes.updated = ['1763670000000'];
    changedTempEntry.attributes._parent = [
        'uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc'
    ];

    const changes = [
        {_modification: {type: 'status'}},
        {_modification: {type: 'updated'}}
    ];
    accesskey.validate(changedTempEntry, config, changes, function (err) {
        t.notOk(err);
        t.end();
    })
});

test('validate accesskey (update temporary key description)', function (t) {
    const changedTempEntry = cloneObj(tempKeyEntry);
    changedTempEntry.dn = {
        rdns:[
            {accesskeyid: 'MSTS4F2A1B3C9E7D8A6F'},
            {uuid: '930896af-bf8c-48d4-885c-6573a94b1853'},
            {ou: 'users'},
            {o: 'smartdc'}
        ],
        rdnSpaced:true,
        length:4
    };
    changedTempEntry.attributes.description = ['Temporary session key'];
    changedTempEntry.attributes.updated = ['1763670000000'];
    changedTempEntry.attributes._parent = [
        'uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc'
    ];

    const changes = [
        {_modification: {type: 'description'}},
        {_modification: {type: 'updated'}}
    ];
    accesskey.validate(changedTempEntry, config, changes, function (err) {
        t.notOk(err);
        t.end();
    })
});

/*
 * Temporary Key Readonly Attribute Tests
 */

test('validate accesskey (temporary key - cannot modify accesskeyid)', function (t) {
    const changedTempEntry = cloneObj(tempKeyEntry);
    changedTempEntry.dn = {
        rdns:[
            {accesskeyid: 'MSTS4F2A1B3C9E7D8A6F'},
            {uuid: '930896af-bf8c-48d4-885c-6573a94b1853'},
            {ou: 'users'},
            {o: 'smartdc'}
        ],
        rdnSpaced:true,
        length:4
    };
    changedTempEntry.attributes._parent = [
        'uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc'
    ];

    const changes = [
        {_modification: {type: 'accesskeyid'}}
    ];
    accesskey.validate(changedTempEntry, config, changes, function (err) {
        t.equal(err.name, 'ConstraintViolationError');
        t.equal(err.message, readonlyAttrMsg);
        t.end();
    })
});

test('validate accesskey (temporary key - cannot modify accesskeysecret)', function (t) {
    const changedTempEntry = cloneObj(tempKeyEntry);
    changedTempEntry.dn = {
        rdns:[
            {accesskeyid: 'MSTS4F2A1B3C9E7D8A6F'},
            {uuid: '930896af-bf8c-48d4-885c-6573a94b1853'},
            {ou: 'users'},
            {o: 'smartdc'}
        ],
        rdnSpaced:true,
        length:4
    };
    changedTempEntry.attributes._parent = [
        'uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc'
    ];

    const changes = [
        {_modification: {type: 'accesskeysecret'}}
    ];
    accesskey.validate(changedTempEntry, config, changes, function (err) {
        t.equal(err.name, 'ConstraintViolationError');
        t.equal(err.message, readonlyAttrMsg);
        t.end();
    })
});

test('validate accesskey (temporary key - cannot modify created)', function (t) {
    const changedTempEntry = cloneObj(tempKeyEntry);
    changedTempEntry.dn = {
        rdns:[
            {accesskeyid: 'MSTS4F2A1B3C9E7D8A6F'},
            {uuid: '930896af-bf8c-48d4-885c-6573a94b1853'},
            {ou: 'users'},
            {o: 'smartdc'}
        ],
        rdnSpaced:true,
        length:4
    };
    changedTempEntry.attributes._parent = [
        'uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc'
    ];

    const changes = [
        {_modification: {type: 'created'}}
    ];
    accesskey.validate(changedTempEntry, config, changes, function (err) {
        t.equal(err.name, 'ConstraintViolationError');
        t.equal(err.message, readonlyAttrMsg);
        t.end();
    })
});

test('validate accesskey (temporary key - can modify mutable fields together)', function (t) {
    const changedTempEntry = cloneObj(tempKeyEntry);
    changedTempEntry.dn = {
        rdns:[
            {accesskeyid: 'MSTS4F2A1B3C9E7D8A6F'},
            {uuid: '930896af-bf8c-48d4-885c-6573a94b1853'},
            {ou: 'users'},
            {o: 'smartdc'}
        ],
        rdnSpaced:true,
        length:4
    };
    changedTempEntry.attributes.status = ['Inactive'];
    changedTempEntry.attributes.description = ['Updated description'];
    changedTempEntry.attributes.expiration = [new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()];
    changedTempEntry.attributes.updated = ['1763670000000'];
    changedTempEntry.attributes._parent = [
        'uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc'
    ];

    const changes = [
        {_modification: {type: 'status'}},
        {_modification: {type: 'description'}},
        {_modification: {type: 'expiration'}},
        {_modification: {type: 'updated'}}
    ];
    accesskey.validate(changedTempEntry, config, changes, function (err) {
        t.notOk(err, 'should allow modifying mutable fields');
        t.end();
    })
});
