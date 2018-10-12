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
var asn1 = require('asn1');

///--- API

module.exports = {

    modify: function modifyKey(req, res, next) {
        var i;
        for (i = req.changes.length - 1; i >= 0; i--) {
            var c = req.changes[i];
            if (c.operation === 'delete') {
                continue;
            }
            if (c.modification.type === 'attested' ||
                c.modification.type === 'ykserial' ||
                c.modification.type === 'ykpinrequired' ||
                c.modification.type === 'yktouchrequired') {

                return next(new ldap.InvalidAttributeSyntaxError(
                    'Modifying attestation data for an sdckey is not allowed'));
            }
        }

        next();
    },

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

            // Delete the old pkcs attribute, in case it's a lie
            if (entry.pkcs) {
                req.attributes.splice(req.indexOf('pkcs'), 1);
            }
            req.addAttribute(new ldap.Attribute({
                type: 'pkcs',
                vals: [key.toString('pkcs8')]
            }));

            // If fingerprint is a lie though we have big problems
            var fp = key.fingerprint('md5').toString('hex');
            if (!entry.fingerprint || entry.fingerprint.length === 0) {
                req.addAttribute(new ldap.Attribute({
                    type: 'fingerprint',
                    vals: [fp]
                }));
            } else if (fp !== entry.fingerprint[0]) {
                throw new Error('Calculated fingerprint (' + fp + ') for ' +
                    'this key does not match the given one (' +
                    entry.fingerprint + ')');
            }

        } catch (e) {
            return next(new ldap.InvalidAttributeSyntaxError(e.toString()));
        }

        if (entry.attested) {
            req.attributes.splice(req.indexOf('attested'), 1);
        }

        if (entry.ykserial) {
            req.attributes.splice(req.indexOf('ykserial'), 1);
        }
        if (entry.ykpinrequired) {
            req.attributes.splice(req.indexOf('ykpinrequired'), 1);
        }
        if (entry.yktouchrequired) {
            req.attributes.splice(req.indexOf('yktouchrequired'), 1);
        }

        var attested = false;

        if (entry.attestation && entry.attestation.length > 0) {
            try {
                var chain = entry.attestation.map(function (pem) {
                    return (sshpk.parseCertificate(pem, 'pem'));
                });
            } catch (e) {
                return next(new ldap.InvalidAttributeSyntaxError(e.toString()));
            }

            if (!chain[0].subjectKey.fingerprint('sha512').matches(key)) {
                return next(new ldap.InvalidAttributeSyntaxError(
                    'First attestation certificate must match subject key'));
            }

            for (i = 0; i < chain.length; ++i) {
                log.debug({
                    subject: chain[i].subjects[0].toString(),
                    issuer: chain[i].issuer.toString(),
                    purposes: chain[i].purposes
                }, 'cert in attestation chain at %d', i);
                if (chain[i].isExpired()) {
                    return next(new ldap.InvalidAttributeSyntaxError(
                        'Attestation certificate ' + i + ' has expired'));
                }
                if (i > 0 && chain[i].purposes &&
                    chain[i].purposes.indexOf('ca') === -1) {

                    return next(new ldap.InvalidAttributeSyntaxError(
                        'Attestation chain certificate ' + i + ' is not a CA'));
                }
            }
            for (i = 0; i < (chain.length - 1); ++i) {
                if (!chain[i].isSignedBy(chain[i + 1])) {
                    return next(new ldap.InvalidAttributeSyntaxError(
                        'Attestation certificate ' + i + ' not signed by next' +
                        ' in chain'));
                }
            }
            var last = chain[chain.length - 1];
            var ca = req.config.attestation.ca_certs.filter(function (maybeCA) {
                return (last.isSignedBy(maybeCA));
            })[0];

            if (ca === undefined) {
                return next(new ldap.InvalidAttributeSyntaxError(
                    'Failed to find CA: ' + last.issuer.toString()));
            }

            var caBasicCons = ca.getExtension('2.5.29.19');
            if (caBasicCons && caBasicCons.pathLen &&
                (chain.length - 1) > caBasicCons.pathLen) {

                return next(new ldap.InvalidAttributeSyntaxError(
                    'Attestation chain too long for CA ' +
                    ca.issuer.toString()));
            }

            attested = true;

            var serialExt = chain[0].getExtension('1.3.6.1.4.1.41482.3.7');
            if (serialExt !== undefined) {
                var der = new asn1.Ber.Reader(serialExt.data);
                req.addAttribute(new ldap.Attribute({
                    type: 'ykserial',
                    vals: [der.readInt()]
                }));
            }

            var policyExt = chain[0].getExtension('1.3.6.1.4.1.41482.3.8');
            if (policyExt !== undefined) {
                req.addAttribute(new ldap.Attribute({
                    type: 'ykpinrequired',
                    vals: [policyExt.data[0] > 1]
                }));
                req.addAttribute(new ldap.Attribute({
                    type: 'yktouchrequired',
                    vals: [policyExt.data[1] > 1]
                }));
            }
        }

        req.addAttribute(new ldap.Attribute({
            type: 'attested',
            vals: [attested]
        }));

        return next();
    }

};
