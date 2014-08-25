/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var add = require('./add');
var authorize = require('./authorize');
var bind  = require('./bind');
var changelog = require('./changelog');
var common = require('./common');
var compare = require('./compare');
var del = require('./del');
var mod = require('./mod').mod;
var pre = require('./pre');
var search = require('./search');



///--- Exports

module.exports = {

    authorize: authorize,

    add: add,

    bind: bind,

    changelog: changelog,

    compare: compare,

    del: del,

    modify: mod,

    pre: pre,

    search: search,

    setup: common.setup

};
