// Copyright 2012 Joyent, Inc.  All rights reserved.

var util = require('util');

var Validator = require('../lib/schema/validator');



///--- API

function Referral() {
  Validator.call(this, {
    name: 'referral',
    required: {
      ref: 1
    },
    strict: true
  });
}
util.inherits(Referral, Validator);



///--- Exports

module.exports = {
  createInstance: function() {
    return new Referral();
  }
};
