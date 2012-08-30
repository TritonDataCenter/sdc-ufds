// Copyright 2012 Joyent, Inc.  All rights reserved.




///--- Triggers

function changelogAdd(req, cb) {
    if (req.headers['x-ufds-operation'] !== 'add') {
        return cb();
    }

    var bucket = req.headers['x-ufds-changelog-bucket'],
        crc = require('crc'),
        util = require('util'),
        microtime = require('microtime'),
        sprintf = util.format;

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
            },
            _value = JSON.stringify(value),
            etag = crc.hex32(crc.crc32(_value)),
            now = Math.round((microtime.now() / 1000)),
            sql = sprintf('INSERT INTO %s (_id, _key, _value, _etag, _mtime,' +
                      ' changenumber, targetdn) ' +
                      'VALUES ($1, $2, $3, $4, $5, $6, $7)',
                      bucket),
            values = [id, key, _value, etag, now,
                      value.changenumber, value.targetdn];


        return req.pg.query(sql, values, function (err2, result) {
                if (err2) {
                    req.log.debug({err: err2}, 'changelogAdd insert: failed');
                    return cb(err2);
                } else {
                    req.log.debug({
                        res: result
                    }, 'changelogAdd insert: done');
                    return cb();
                }
        });
    });
}


function changelogMod(req, cb) {
    if (req.headers['x-ufds-operation'] !== 'modify') {
        return cb();
    }

    var bucket = req.headers['x-ufds-changelog-bucket'],
        crc = require('crc'),
        util = require('util'),
        microtime = require('microtime'),
        sprintf = util.format;

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
            },
            _value = JSON.stringify(value),
            etag = crc.hex32(crc.crc32(_value)),
            now = Math.round((microtime.now() / 1000)),
            sql = sprintf('INSERT INTO %s (_id, _key, _value, _etag, _mtime,' +
                      ' changenumber, targetdn) ' +
                      'VALUES ($1, $2, $3, $4, $5, $6, $7)',
                      bucket),
            values = [id, key, _value, etag, now,
                      value.changenumber, value.targetdn];


        return req.pg.query(sql, values, function (err2, result) {
                if (err2) {
                    req.log.debug({err: err2}, 'changelogMod insert: failed');
                    return cb(err2);
                } else {
                    req.log.debug({
                        res: result
                    }, 'changelogMod insert: done');
                    return cb();
                }
        });
    });
}


function changelogDel(req, cb) {
    if (req.headers['x-ufds-operation'] !== 'delete') {
        return cb();
    }

    var bucket = req.headers['x-ufds-changelog-bucket'],
        crc = require('crc'),
        util = require('util'),
        microtime = require('microtime'),
        sprintf = util.format;

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
                changes: [req.headers['x-ufds-deleted-entry']],
                objectclass: ['changeLogEntry']
            },
            _value = JSON.stringify(value),
            etag = crc.hex32(crc.crc32(_value)),
            now = Math.round((microtime.now() / 1000)),
            sql = sprintf('INSERT INTO %s (_id, _key, _value, _etag, _mtime,' +
                      ' changenumber, targetdn) ' +
                      'VALUES ($1, $2, $3, $4, $5, $6, $7)',
                      bucket),
            values = [id, key, _value, etag, now,
                      value.changenumber, value.targetdn];


        return req.pg.query(sql, values, function (err2, result) {
                if (err2) {
                    req.log.debug({err: err2}, 'changelogDel insert: failed');
                    return cb(err2);
                } else {
                    req.log.debug({
                        res: result
                    }, 'changelogDel insert: done');
                    return cb();
                }
        });
    });
}


///--- Exports

module.exports = {

    add: changelogAdd,

    mod: changelogMod,

    del: changelogDel

};
