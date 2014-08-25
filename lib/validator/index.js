/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

///--- Globals



var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;



///--- Exports


module.exports = {
    ipNumber: function (ipNum) {
        if (isNaN(ipNum) || ipNum > 4294967295 || ipNum < 0) {
            return false;
        }
        return true;
    },
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
