// Copyright 2011 Joyent, Inc.  All rights reserved.

var util = require('util');

var Validator = require('../lib/schema/validator');



///--- API

function Organization() {
  Validator.call(this, {
    name: 'organization',
    required: {
      o: 1
    },
    strict: true
  });
}
util.inherits(Organization, Validator);



///--- Exports

module.exports = {
  createInstance: function() {
    return new Organization();
  }
};
