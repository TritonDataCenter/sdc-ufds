// Copyright 2012 Joyent, Inc.  All rights reserved.

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
