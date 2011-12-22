// Copyright 2011 Joyent, Inc.  All rights reserved.

var util = require('util');

var Validator = require('../lib/schema/validator');



///--- API

function Comment() {
  Validator.call(this, {
    name: 'comment',
    required: {
      commentid: 1,
      author: 1,
      body: 1
    }
  });
}
util.inherits(Comment, Validator);



///--- Exports

module.exports = {
  createInstance: function() {
    return new Comment();
  }
};
