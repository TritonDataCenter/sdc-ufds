// Copyright (c) 2014, Joyent, Inc. All rights reserved.

var ldap = require('ldapjs');
var once = require('once');

var CheckpointReqControl =
    require('../controls/index').CheckpointUpdateRequestControl;

function checkpoint(req, res, next) {
    // Record replication information about change, if available
    next = once(next);
    var matched = false;
    req.controls.forEach(function (control) {
        if (control.type === CheckpointReqControl.OID) {
            var parsed = new CheckpointReqControl({
                value: control.value
            });
            var dn = parsed.value.dn;
            var changenumber = parsed.value.changenumber;
            if (dn !== undefined && changenumber !== undefined) {
                matched = true;
                // Update the checkpoint record with the operation
                req.get(req.bucket, dn, function (err, val, meta) {
                    if (err) {
                        return next(err);
                    }
                    val.value.changenumber = changenumber;
                    req.objects.push({
                        bucket: req.bucket,
                        key: dn,
                        value: val.value
                    });
                    return next();
                });
            }
        }
    });
    if (!matched) {
        return next();
    }
}

module.exports = {
    checkpoint: checkpoint
};
