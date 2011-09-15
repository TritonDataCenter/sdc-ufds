// Copyright 2011 Joyent, Inc.  All rights reserved.

var parser = require('./parser');
var validator = require('./validator');



///--- API

module.exports = {

  loadDirectory: parser.loadDirectory,

  validateAdd: validator.add,

  validateModify: validator.modify

};
