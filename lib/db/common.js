// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');

var ldap = require('ldapjs');


///--- Globals

var parseDN = ldap.parseDN;


///--- Functions


function operationsError(err) {
    var msg = err && err.message ? err.message : '';
    return new ldap.OperationsError('Moray failure: ' + msg,
                                    null, operationsError);
}


function _error(err, req) {
    switch (err.name) {
    case 'ObjectNotFoundError':
        return new ldap.NoSuchObjectError(req ? req.dn.toString() : '');
    case 'UniqueAttributeError':
        return new ldap.ConstraintViolationError(err.message);
    default:
        return operationsError(err);
    }
}


function _exists(req) {
    return function exists(bucket, key, callback) {
        var client = req.moray,
            log = req.log,
            opts = { req_id: req.req_id };

        log.debug({bucket: bucket, key: key}, 'exists entered');
        return client.getObject(bucket, key, opts, function (err, obj) {
            if (err) {
                if (err.name === 'ObjectNotFoundError') {
                    return callback(null, false);
                }

                return callback(operationsError(err));
            }
            return callback(null, true);
        });
    };
}


function _get(req) {
    return function get(bucket, key, callback) {
        var client = req.moray,
            log = req.log,
            opts = { req_id: req.req_id };

        log.debug({bucket: bucket, key: key}, 'get entered');
        return client.getObject(bucket, key, opts, function (err, obj) {
            if (err) {
                return callback(_error(err, req));
            }

            log.debug({bucket: bucket, key: key, val: obj}, 'get done');
            return callback(null, obj);
        });
    };
}


function _put(req) {
    return function put(bucket, key, value, meta, callback) {
        if (typeof (meta) === 'function') {
            callback = meta;
            meta = {};
        }

        var client = req.moray,
            log = req.log,
            opts = {
                match: meta.etag,
                req_id: req.req_id,
                headers: meta.headers || {}
            };

        opts.headers['x-ufds-changelog-bucket'] = req.config.changelog.bucket;

        log.debug({bucket: bucket, key: key, opts: opts}, 'put entered');
        return client.putObject(bucket, key, value, opts, function (err) {
            if (err) {
                return callback(_error(err, req));
            }

            log.debug({bucket: bucket, key: key, val: value}, 'put done');
            return callback(null);
        });
    };
}


function _del(req) {
    return function del(bucket, key, meta, callback) {
        if (typeof (meta) === 'function') {
            callback = meta;
            meta = {};
        }

        var client = req.moray,
            log = req.log,
            opts = {
                match: meta.etag,
                req_id: req.req_id,
                headers: meta.headers || {}
            };

        opts.headers['x-ufds-changelog-bucket'] = req.config.changelog.bucket;

        log.debug({bucket: bucket, key: key, opts: opts}, 'del entered');
        return client.delObject(bucket, key, opts, function (err) {
            if (err) {
                return _error(err, req);
            }

            log.debug({bucket: bucket, key: key}, 'del done');
            return callback(null);
        });
    };
}


function _search(req) {
    return function search(bucket, filter, callback) {
        // Changelog needs special massage:
        var clog = (req.config.changelog &&
                bucket === req.config.changelog.bucket);

        var client = req.moray;
        var log = req.log;
        var opts = {
            no_count: true,    // See CAPI-440
            req_id: req.req_id
        };

        // CAPI-352: Hidden control should work as expected:
        if (req.controls.some(function (c) {
            return c.type === '1.3.6.1.4.1.38678.1';
        })) {
            req.hidden = true;
        }

        // CAPI-354: Make sure --sizeLimit option gets passed to moray:
        if (req.sizeLimit) {
            var limit = parseInt(req.sizeLimit, 10);
            if (!isNaN(limit)) {
                opts.limit = limit;
            }
        }
        if (clog) {
            // If we are searching changelog by "changenumber", we need to
            // replace it with an "_id":
            if (/changenumber/.test(filter)) {
                filter = filter.replace(/changenumber/g, '_id');
            }

            // CAPI-277: Redundant sorting value, just to make sure PostgreSQL
            // is searching and sorting as it should if multiple search indexes
            // are given:
            opts.sort =  {
                attribute: '_id',
                order: 'ASC'
            };

            // If we are searching changelog by "changetime", we need to go
            // for millisecs since epoch instead of ISO Date
            /* JSSTYLED */
            var RE = /changetime([<\=|>\=|\=|~\=]+)(\d{4}\-\d{2}\-\d{2}(T\d{2}\:\d{2}\:\d{2}(\.\d{1,3})*Z)*)/g;
            var d;
            var rest;
            if ((rest = RE.exec(filter)) !== null) {
                d = new Date(rest[2]).getTime();
                filter = filter.replace(RE, 'changetime' + rest[1] + d);
            }
        }

        var r = client.findObjects(bucket, filter, opts);
        var results = {};

        log.debug({bucket: bucket, filter: filter}, 'search entered');

        r.once('error', function (err) {
            return callback(err);
        });

        r.on('record', function (obj) {
            if (clog) {
                /* JSSTYLED */
                var k = obj.key.replace(/^change=(\S)+/,
                    'changenumber=' + obj._id + ',');
                var value = obj.value;
                value.changenumber = obj._id;
                value.changetime = new Date(value.changetime).toISOString();
                results[k] = value;
            } else {
                results[obj.key] = obj.value;
            }
        });

        r.on('end', function () {
            log.debug({
                bucket: bucket,
                filter: filter,
                results: results
            }, 'search done');
            return callback(null, results);
        });
    };
}


function _batch(req) {
    return function batch(data, meta, callback) {
        if (typeof (meta) === 'function') {
            callback = meta;
            meta = {};
        }

        var client = req.moray,
            log = req.log,
            opts = {
                match: meta.etag,
                req_id: req.req_id,
                headers: meta.headers || {}
            };

        opts.headers['x-ufds-changelog-bucket'] = req.config.changelog.bucket;

        log.debug({data: data, opts: opts}, 'batch entered');
        return client.batch(data, opts, function (err, m) {
            if (err) {
                return callback(_error(err, req));
            }

            log.debug({data: data, meta: m}, 'batch done');
            return callback(null, m);
        });
    };
}



///--- Exports

module.exports = {

    operationsError: operationsError,

    setup: function commonSetup(req, res, next) {
        req.key = req.dn.toString();

        req.exists = _exists(req);
        req.put = _put(req);
        req.get = _get(req);
        req.del = _del(req);
        req.search = _search(req);
        req.batch = _batch(req);
        return next();
    },

    ldapError: _error
};
