// Copyright 2012 Joyent, Inc.  All rights reserved.

var add = require('./add');
var authorize = require('./authorize');
var bind  = require('./bind');
var changelog = require('./changelog');
var common = require('./common');
var compare = require('./compare');
var del = require('./del');
var mod = require('./mod');
var search = require('./search');



///--- Exports

module.exports = {

    add: add,

    bind: bind,

    compare: compare,

    del: del,

    modify: mod,

    search: search,

    setup: common.setup,

    changelog: changelog,

    authorize: authorize

};
