// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');

var Validator = require('../../lib/schema/validator');



///--- API

function WeakUnitTest() {
  Validator.call(this, {
    name: 'unittestanything'
  });
}
util.inherits(WeakUnitTest, Validator);


WeakUnitTest.prototype.validate = function(entry, callback) {
  assert.ok(entry);
  assert.ok(entry.dn);
  assert.ok(entry.attributes);
  return callback();
};


///--- Exports

module.exports = {
  createInstance: function() {
    return new WeakUnitTest();
  }
};
