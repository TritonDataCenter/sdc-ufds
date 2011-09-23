// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var crypto = require('crypto');

var ldap = require('ldapjs');
var restify = require('restify');
var sprintf = require('sprintf').sprintf;
var uuid = require('node-uuid');



///--- Globals

var hidden = new ldap.Control({
  type: 'hidden',
  criticality: true
});
var log = restify.log;

var AES_KEY = uuid().replace('-').substring(0, 16);


///--- Helpers

function _randomId(min, max) {
  if (!min) min = 0;
  if (!max) max = Math.pow(2, 32) - 1;

  return Math.floor(Math.random() * (max - min + 1)) + min;
}


function _merge(obj1, obj2) {
  Object.keys(obj2).forEach(function(k) {
    if (!obj1.hasOwnProperty(k))
      obj1[k] = obj2[k];
  });

  return obj1;
}


//
// http://www.youtube.com/watch?v=J7RsYvRSyXs
//
// In the ghetto
// On a cold and gray Chicago mornin'
// Another little baby child is born
// In the ghetto
// (In the ghetto)
// And his mama cries
// because if there's one thing that she don't need
// it's another little hungry mouth to feed
// In the ghetto
//
// Basically, this lets a password token last up to a day, statelessly, since
// the client doesn't call capi back for a token.  Asking for a token at 23:59?
// fuck off.
//
function _forgotPasswordCode(customerId) {
  var cipher = crypto.createCipher('aes-128-cbc', AES_KEY);
  var now = new Date();
  cipher.update('' + (now.getUTCDay() + 1));
  cipher.update('' + now.getUTCDate());
  cipher.update('' + (now.getUTCMonth() + 1));
  cipher.update('' + now.getUTCFullYear());
  cipher.update(customerId.replace('-', ''), 'utf8', 'hex');
  return cipher.final('hex');
}


function _translate(entry) {
  assert.ok(entry);

  var customer = {
    id: _randomId(),
    uuid: entry.uuid,
    login: entry.login,
    email_address: entry.email,
    first_name: entry.cn,
    last_name: entry.sn,
    company_name: entry.company || null
  };

  if (entry.address && entry.address.length) {
    if (!Array.isArray(entry.address))
      entry.address = [entry.address];
    for (var i = 0; i < entry.address.length; i++)
      customer['street_' + (i + 1)] = entry.address[i];
  }

  if (!customer.street_1)
    customer.street_1 = null;

  if (!customer.street_2)
    customer.street_2 = null;

  var dn = ldap.parseDN(entry.dn);
  if (dn.childOf('ou=operators, o=smartdc'))
    customer.role_type = 2;

  return _merge(customer, {
    city: entry.city || null,
    state: entry.state || null,
    postal_code: entry.postalcode || null,
    country: entry.country || null,
    phone_number: entry.phone || null,
    role_type: 1,
    asset_id: null,
    legacy_id: null,
    deleted_at: null,
    alternate_email_address: null,
    forgot_password_code: _forgotPasswordCode(entry.uuid),
    activation_code: null,
    activated_at: entry._ctime,
    created_at: entry._ctime,
    updated_at: entry._mtime
  });
}



///--- Exports

module.exports = {

  loadCustomers: function loadCustomers(ldap, filter, translate, callback,
                                        base) {
    assert.ok(ldap);
    assert.ok(filter);
    assert.ok(translate !== undefined);

    if (typeof(translate) === 'function') {
      base = callback;
      callback = translate;
      translate = true;
    }

    if (!base)
      base = 'o=smartdc';

    var opts = {
      scope: 'sub',
      filter: filter
    };
    return ldap.search(base, opts, hidden, function(err, result) {
      if (err)
        return callback(new restify.InternalError(500, err.message));

      var entries = [];
      result.on('searchEntry', function(entry) {
        entries.push((translate ? _translate(entry.object) : entry.object));
      });
      result.on('end', function() {
        return callback(null, entries);
      });
    });
  },

  translateCustomer: _translate,

  forgotPasswordCode: _forgotPasswordCode

};
