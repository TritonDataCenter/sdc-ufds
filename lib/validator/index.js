/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var ipaddr = require('ipaddr.js');

///--- Globals



var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;



///--- Exports


module.exports = {
    subnet: function (cidr) {
        try {
            var parts = ipaddr.parseCIDR(cidr)
            var ip = parts[0];
            var plen = parts[1];
            if (ip.kind() === 'ipv4') {
                return plen >= 1 && plen <= 32;
            } else if (ip.kind() === 'ipv6') {
                return plen >= 1 && plen <= 128;
            } else {
                return false;
            }
        } catch (e) {
            return false;
        }
    },
    ipAddr: ipaddr.isValid,
    UUID: function (uuid) {
        return UUID_RE.test(uuid);
    },
    bool: function (b) {
        if (b == 'true' || b == 'false') {
            return true;
        }
        return false;
    }
};
