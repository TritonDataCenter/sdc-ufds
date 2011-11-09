// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');

var ldap = require('ldapjs');



///--- Globals

var USERS = ldap.parseDN('ou=users, o=smartdc');
var MODDN_ERR = 'cannot rename a uuid entry';


///--- Functions

function parseOwner(dn) {
  if (!dn.childOf(USERS))
    return false;

  // Make a copy
  var _dn = dn.clone();
  _dn.pop();
  _dn.pop();
  var rdn = _dn.pop();
  return (typeof(rdn.uuid) === 'string' ? rdn.uuid : false);
}


///--- Exports

module.exports = {

  add: function(req, res, next) {
    var owner = parseOwner(req.dn);
    if (!owner)
      return next();

    req.addAttribute(new ldap.Attribute({
      type: '_owner',
      vals: [owner]
    }));

    return next();
  },


  modifyDN: function(req, res, next) {
    var owner = parseOwner(req.dn);
    if (owner && req.dn.length === 3)
      return next(new ldap.UnwillingToPerformError(MODDN_ERR));

    return next();
  },


  search: function(req, res, next) {
    var owner = parseOwner(req.dn);
    if (!owner)
      return next();

    var f = req.filter;
    req.filter = new ldap.AndFilter({
      filters: [
        f,
        new ldap.EqualityFilter({
          attribute: '_owner',
          value: owner
        })
      ]
    });

    return next();
  }

};
