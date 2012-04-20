// Copyright 2012 Joyent, Inc.  All rights reserved.

var httpSignature = require('http-signature');
var ldap = require('ldapjs');



///--- Globals

var sshToPEM = httpSignature.sshKeyToPEM;
var fingerprint = httpSignature.sshKeyFingerprint;



///--- API

module.exports = {

    add: function addKey(req, res, next) {
        var entry = req.toObject().attributes;
        var log = req.log;
        var key;
        var sdckey = false;

        log.debug({
            dn: req.dn.toString(),
            entry: entry
        }, 'Checking if we need to inject a PKCS attribute');

        for (var i = 0; i < (entry.objectclass || []).length; i++) {
            if (entry.objectclass[i].toLowerCase() === 'sdckey') {
                sdckey = true;
                break;
            }
        }
        if (!entry.openssh || entry.openssh.length === 0)
            return next();

        log.debug({
            dn: req.dn.toString(),
            entry: entry,
            sdckey: sdckey
        }, 'Inject?');

        if (!sdckey)
            return next();

        try {
            key = entry.openssh[0];
            req.addAttribute(new ldap.Attribute({
                type: 'pkcs',
                vals: [sshToPEM(key)]
            }));

            if (!entry.fingerprint) {
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
