// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var crypto = require('crypto');

var httpSignature = require('http-signature');
var ldap = require('ldapjs');
var log4js = require('log4js');



///--- Globals

var sshToPEM = httpSignature.sshKeyToPEM;
var fingerprint = httpSignature.sshKeyFingerprint;

var log = log4js.getLogger('keys');


///--- API

module.exports = {

  add: function addKey(req, res, next) {
    assert.ok(req.object);

    var i;

    var entry = req.object.attributes;

    if (!entry.openssh || !entry.openssh.length || !entry.objectclass)
      return next();

    var sdckey = false;
    for (var i = 0; i < entry.objectclass.length; i++) {
      if (entry.objectclass[i].toLowerCase() === 'sdckey') {
        sdckey = true;
        break;
      }
    }

    if (!sdckey)
      return next();

    try {
      var key = entry.openssh[0];
      req.addAttribute(new ldap.Attribute({
        type: 'pkcs',
        vals: [sshToPEM(key)]
      }));

      if (!req.toObject().attributes.fingerprint) {
        req.addAttribute(new ldap.Attribute({
          type: 'fingerprint',
          vals: [fingerprint(key)]
        }));
      }
    } catch (e) {
      return next(new ldap.InvalidAttributeSyntaxError(e.toString()));
    }

    return next();
  }

};
