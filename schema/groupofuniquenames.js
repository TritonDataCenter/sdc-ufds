// Copyright 2011 Joyent, Inc.  All rights reserved.

var util = require('util');

var Validator = require('../lib/schema/validator');



///--- API

function GroupOfUniqueNames() {
  Validator.call(this, {
    name: 'groupofuniquenames',
    required: {
      uniquemember: 1000000
    },
    optional: {
      description: 1
    },
    strict: true
  });
}
util.inherits(GroupOfUniqueNames, Validator);


GroupOfUniqueNames.prototype.validate = function(entry, callback) {
  var members = entry.attributes.uniquemember;

  members.sort();
  for (var i = 0; i < members.length; i++) {
    if (members.indexOf(members[i], i + 1) !== -1) {
      return callback(new ldap.ConstraintViolationError(members[i] +
                                                        ' is not unique'));
    }
  }

  return callback();
};


///--- Exports

module.exports = {
  createInstance: function() {
    return new GroupOfUniqueNames();
  }
};
