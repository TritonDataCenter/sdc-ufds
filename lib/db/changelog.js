// Copyright 2012 Joyent, Inc.  All rights reserved.




///--- Triggers

function changelogAdd(req, cb) {
    if (req.headers['x-ufds-operation'] !== 'add') {
        cb();
        return;
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
        cb();
        return;
    }
    /* JSSTYLED */
    var q = req.pg.query("SELECT nextval('" + bucket + "_serial')");

    q.once('error', function (err) {
        req.log.debug(err, 'changelogAdd select nextval: failed');
        cb(err);
    });

    var id;
    q.once('row', function (r) {
        id = r.nextval;
    });

    q.once('end', function () {
        var key = 'changenumber=' + id + ', cn=changelog',
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


        var q2 = req.pg.query(sql, values);
        q2.once('error', function (err) {
            req.log.debug(err, 'changelogAdd insert: failed');
            cb(err);
        });
        q2.once('end', function () {
            req.log.debug('changelogAdd insert: done');
            cb();
        });
    });
}


function changelogMod(req, cb) {
    if (req.headers['x-ufds-operation'] !== 'modify') {
        cb();
        return;
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
        cb();
        return;
    }

    /* JSSTYLED */
    var q = req.pg.query("SELECT nextval('" + bucket + "_serial')");

    q.once('error', function (err) {
        req.log.debug(err, 'changelogAdd select nextval: failed');
        cb(err);
    });

    var id;
    q.once('row', function (r) {
        id = r.nextval;
    });

    q.once('end', function () {
        var key = 'changenumber=' + id + ', cn=changelog',
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

        var q2 = req.pg.query(sql, values);
        q2.once('error', function (err) {
            req.log.debug(err, 'changelogMod insert: failed');
            cb(err);
        });
        q2.once('end', function () {
            req.log.debug('changelogMod insert: done');
            cb();
        });
    });
}


function changelogDel(req, cb) {
    if (req.headers['x-ufds-operation'] !== 'delete') {
        cb();
        return;
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
        cb();
        return;
    }

    /* JSSTYLED */
    var q = req.pg.query("SELECT nextval('" + bucket + "_serial')");

    var id;
    q.once('row', function (r) {
        id = r.nextval;
    });

    q.once('end', function () {
        var key = 'changenumber=' + id + ', cn=changelog',
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

        var q2 = req.pg.query(sql, values);
        q2.once('error', function (err) {
            req.log.debug(err, 'changelogDel insert: failed');
            cb(err);
        });
        q2.once('end', function () {
            req.log.debug('changelogDel insert: done');
            cb();
        });
    });
}


///--- Exports

module.exports = {

    add: changelogAdd,

    mod: changelogMod,

    del: changelogDel

};
