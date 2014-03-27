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

        var i;
        for (i = 0; i < (entry.objectclass || []).length; i++) {
            if (entry.objectclass[i].toLowerCase() === 'sdckey') {
                sdckey = true;
                break;
            }
        }
        if (!entry.openssh || entry.openssh.length === 0) {
            return next();
        }

        log.debug({
            dn: req.dn.toString(),
            entry: entry,
            sdckey: sdckey
        }, 'Inject?');

        if (!sdckey) {
            return next();
        }

        try {
            key = entry.openssh[0];
            // Just in case, fix extra spaces in keys [CAPI-194]:
            if (/\s{2,}/.test(key)) {
                key = key.replace(/(\s){2,}/, '$1');
            }
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
