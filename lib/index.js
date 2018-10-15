/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * This file defines chains of handlers for the different
 * LDAP Operations supported by UFDS LDAP server.
 */

var db = require('./db');
var keys = require('./keys');
var owner = require('./owner');
var salt = require('./salt');
var schema = require('./schema');



///--- Helpers

function _array(arg) {
    if (!arg) {
        arg = [];
    }
    if (!Array.isArray(arg)) {
        arg = [arg];
    }
    return arg;
}


function buildChain(pre, chain) {
    return pre.concat(db.setup).concat(chain);
}



///--- Exports

module.exports = {

    add: function add(pre) {
        var chain = [
            db.authorize,
            keys.add,
            owner.add,
            salt.add,
            schema.add
        ].concat(db.add());

        return buildChain(_array(pre), chain);
    },


    bind: function bind(pre) {
        var chain = [salt.bind].concat(db.bind());

        return buildChain(_array(pre), chain);
    },


    compare: function compare(pre) {
        var chain = [db.authorize, salt.compare].concat(db.compare());

        return buildChain(_array(pre), chain);
    },


    del: function del(pre) {
        var chain = [db.authorize].concat(db.del(schema.del));

        return buildChain(_array(pre), chain);
    },


    modify: function modify(pre) {
        var chain = [
            db.authorize,
            keys.modify,
            salt.modify
        ].concat(db.modify(schema.modify));

        return buildChain(_array(pre), chain);
    },


    search: function search(pre) {
        var chain = [
            db.authorize,
            salt.search,
            owner.search
        ].concat(db.search());

        return buildChain(_array(pre), chain);
    },


    changelog: db.changelog,

    pre: db.pre

};
