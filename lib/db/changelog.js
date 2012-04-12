// Copyright 2012 Joyent, Inc.  All rights reserved.




///--- Triggers

function changelogAdd(req, cb) {
    if (req.del || req.meta['x-ufds-operation'] !== 'add')
        return cb();

    var pg = req.pgClient;
    return pg.query(req.sql.GET_NEXT_SEQUENCE, function (err, rows) {
        if (err)
            return cb(err);

        var id = rows[0].nextval;
        var bucket = req.meta['x-ufds-changelog-bucket'];
        var db = req.objectManager;
        var key = 'changenumber=' + id + ', cn=changelog';
        var value = {
            targetdn: [req.key],
            changetype: ['add'],
            changenumber: [id + ''],
            changes: [JSON.stringify(req.value)],
            objectclass: ['changeLogEntry']
        };

        return db.put(bucket, key, value, function (err2, _) {
            return cb(err2);
        });
    });
}


function changelogMod(req, cb) {
    if (req.del || req.meta['x-ufds-operation'] !== 'modify')
        return cb();

    var pg = req.pgClient;
    return pg.query(req.sql.GET_NEXT_SEQUENCE, function (err, rows) {
        if (err)
            return cb(err);

        var id = rows[0].nextval;
        var bucket = req.meta['x-ufds-changelog-bucket'];
        var db = req.objectManager;
        var key = 'changenumber=' + id + ', cn=changelog';
        var value = {
            changenumber: [id + ''],
            changetype: ['modify'],
            changes: [req.meta['x-ufds-changes']],
            targetdn: [req.key],
            entry: [JSON.stringify(req.value)],
            objectclass: ['changeLogEntry']
        };

        return db.put(bucket, key, value, function (err2, _) {
            return cb(err2);
        });
    });
}


function changelogDel(req, cb) {
    if (!req.del)
        return cb();

    var pg = req.pgClient;
    return pg.query(req.sql.GET_NEXT_SEQUENCE, function (err, rows) {
        if (err)
            return cb(err);

        var id = rows[0].nextval;
        var bucket = req.meta['x-ufds-changelog-bucket'];
        var db = req.objectManager;
        var key = 'changenumber=' + id + ', cn=changelog';
        var value = {
            targetdn: [req.key],
            changetype: ['delete'],
            changenumber: [id + ''],
            objectclass: ['changeLogEntry']
        };

        return db.put(bucket, key, value, function (err2, _) {
            return cb(err2);
        });
    });
}



///--- Exports

module.exports = {

    add: changelogAdd,

    mod: changelogMod,

    del: changelogDel

};
