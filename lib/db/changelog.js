// Copyright 2012 Joyent, Inc.  All rights reserved.




///--- Triggers

function changelogAdd(req, cb) {
    if (req.del || req.headers['x-ufds-operation'] !== 'add') {
        return cb();
    }

    var bucket = req.headers['x-ufds-changelog-bucket'];
    if (!bucket) {
        req.log.warn({
            meta: req.headers
        }, 'changelogAdd: bucket not provided, skipping');
        return cb();
    }
    /* BEGIN JSSTYLED */
    return req.pg.query("SELECT nextval('" + bucket + "__id_seq')",
            function (err, obj) {
    /* END JSSTYLED */
        if (err) {
            return cb(err);
        }

        var id = obj.rows[0].nextval,
            key = 'changenumber=' + id + ', cn=changelog',
            value = {
                targetdn: [req.key],
                changetype: ['add'],
                changenumber: [id],
                changes: [JSON.stringify(req.value)],
                objectclass: ['changeLogEntry']
            };

        req.log.warn({changelog: {
            key: key,
            id: id,
            value: value
        }}, 'changelogAdd PUT pending');

//        return db.put(bucket, key, value, function (err2, _) {
//            return cb(err2);
//        });

        return cb();
    });
}


function changelogMod(req, cb) {
    if (req.del || req.headers['x-ufds-operation'] !== 'modify') {
        return cb();
    }

    var bucket = req.headers['x-ufds-changelog-bucket'];
    if (!bucket) {
        req.log.warn({
            meta: req.headers
        }, 'changelogMod: bucket not provided, skipping');
        return cb();
    }

    /* BEGIN JSSTYLED */
    return req.pg.query("SELECT nextval('" + bucket + "__id_seq')",
            function (err, obj) {
    /* END JSSTYLED */
        if (err) {
            return cb(err);
        }

        var id = obj.rows[0].nextval,
            key = 'changenumber=' + id + ', cn=changelog',
            value = {
                changenumber: [id],
                changetype: ['modify'],
                changes: [req.headers['x-ufds-changes']],
                targetdn: [req.key],
                entry: [JSON.stringify(req.value)],
                objectclass: ['changeLogEntry']
            };

        req.log.warn({changelog: {
            key: key,
            id: id,
            value: value
        }}, 'changelogMod PUT pending');

//        return db.put(bucket, key, value, function (err2, _) {
//            return cb(err2);
//        });
        return cb();
    });
}


function changelogDel(req, cb) {
    if (!req.del) {
        return cb();
    }

    var bucket = req.headers['x-ufds-changelog-bucket'];
    if (!bucket) {
        req.log.warn({
            meta: req.headers
        }, 'changelogDel: bucket not provided, skipping');
        return cb();
    }

    /* BEGIN JSSTYLED */
    return req.pg.query("SELECT nextval('" + bucket + "__id_seq')",
            function (err, obj) {
    /* END JSSTYLED */
        if (err) {
            return cb(err);
        }

        var id = obj.rows[0].nextval,
            key = 'changenumber=' + id + ', cn=changelog',
            value = {
                targetdn: [req.key],
                changetype: ['delete'],
                changenumber: [id],
                changes: [JSON.stringify(req.delEntry)],
                objectclass: ['changeLogEntry']
            };

        req.log.warn({changelog: {
            key: key,
            id: id,
            value: value
        }}, 'changelogDel PUT pending');

//        return db.put(bucket, key, value, function (err2, _) {
//            return cb(err2);
//        });
        return cb();
    });
}


///--- Exports

module.exports = {

    add: changelogAdd,

    mod: changelogMod,

    del: changelogDel

};
