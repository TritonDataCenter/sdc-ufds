// Copyright (c) 2014, Joyent, Inc. All rights reserved.


var CheckpointReqControl =
    require('../controls/index').ChangelogHintRequestControl;

function checkpoint(req, res, next) {
    // Record replication information about change, if available
    req.controls.forEach(function (control) {
        if (control.type === CheckpointReqControl.OID) {
            var parsed = new CheckpointReqControl({
                value: control.value
            });
            if (parsed.value.dn && parsed.value.changenumber) {
                // Update the checkpoint record with the operation
                req.objects.push({
                    bucket: req.bucket,
                    key: parsed.value.dn,
                    value: {
                        changenumber: parsed.value.changenumber
                    }
                });
            }
        }
    });

    return next();
}

module.exports = {
    checkpoint: checkpoint
};
