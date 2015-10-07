/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var sshpk = require('sshpk');
var ldap = require('ldapjs');

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
            // Just in case, fix extra spaces in keys [CAPI-194]:
            key = entry.openssh[0].replace(/(\s){2,}/g, '$1').trim();

            key = sshpk.parseKey(key, 'ssh');

            req.addAttribute(new ldap.Attribute({
                type: 'pkcs',
                vals: [key.toString('pkcs8')]
            }));

            if (!entry.fingerprint) {
                req.addAttribute(new ldap.Attribute({
                    type: 'fingerprint',
                    vals: [key.fingerprint('md5').toString('hex')]
                }));
            }

        } catch (e) {
            return next(new ldap.InvalidAttributeSyntaxError(e.toString()));
        }

        return next();
    }

};
