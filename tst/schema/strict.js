// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');

var Validator = require('../../lib/schema/validator');



///--- API

function StrictUnitTest() {
  Validator.call(this, {
    name: 'unittest',
    required: {
      dc: 1,
      cn: 2
    },
    optional: {
      sn: 3
    },
    strict: true
  });
}
util.inherits(StrictUnitTest, Validator);


StrictUnitTest.prototype.validate = function(entry, callback) {
  assert.ok(entry);
  assert.ok(entry.dn);
  assert.ok(entry.attributes);
  return callback();
};


///--- Exports

module.exports = {
  createInstance: function() {
    return new StrictUnitTest();
  }
};
