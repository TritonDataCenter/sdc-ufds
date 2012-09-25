// Copyright 2012 Joyent, Inc.  All rights reserved.



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
