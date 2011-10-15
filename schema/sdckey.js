// Copyright 2011 Joyent, Inc.  All rights reserved.

var util = require('util');

var Validator = require('../lib/schema/validator');



///--- API

function Metadata() {
  Validator.call(this, {
    name: 'sdckey',
    required: {
      name: 1,
      openssh: 1,
      fingerprint: 1,
      pkcs: 1
    },
    strict: true
  });
}
util.inherits(Metadata, Validator);



///--- Exports

module.exports = {
  createInstance: function() {
    return new Metadata();
  }
};
