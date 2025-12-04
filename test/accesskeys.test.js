/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2025 Edgecast Cloud LLC.
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

function cloneObj(obj) {
    // No structuredClone until Node v17
    if (typeof (structuredClone) === 'function') {
        return structuredClone(obj);
    }
    return JSON.parse(JSON.stringify(obj));
}

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

const readonlyAttrMsg = 'acceskeyid, accesskeysecret, created attributes can ' +
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

test('validate accesskey (update readonly acceskeyid attr)', function (t) {
    const changes = [
        {_modification: {type:'acceskeyid'}}
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
