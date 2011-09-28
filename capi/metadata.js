// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');


var ldap = require('ldapjs');
var restify = require('restify');
var sprintf = require('sprintf').sprintf;
var uuid = require('node-uuid');

var util = require('./util');



///--- Globals

var MD_DN = 'metadata=%s, %s';

var Change = ldap.Change;
var log = restify.log;



///--- Helpers

function loadMetadata(req, notFoundOk, callback) {
  if (typeof(notFoundOk) !== 'boolean') {
    callback = notFoundOk;
    notFoundOk = false;
  }
  var base = sprintf(MD_DN, req.uriParams.appkey, req.customer.dn.toString());
  var opts = {
    filter: '(objectclass=capimetadata)',
    scope: 'base'
  }
  req.ldap.search(base, opts, function(err, _res) {
    var done = false;
    if (err) {
      done = true;
      return callback(new restify.InternalError(err.toString()));
    }

    var entry = {};
    _res.on('error', function(err) {
      if (done)
        return;
      done = true;
      if (err instanceof ldap.NoSuchObjectError) {
        if (notFoundOk)
          return callback(null);

        return callback(new restify.ResourceNotFoundError(req.url));
      }

      return callback(new restify.InternalError(err.toString()));
    });
    _res.on('searchEntry', function(_entry) {
      entry = _entry.toObject();
      // clear out the stuff we don't need
      delete entry.dn;
      delete entry.cn;
      delete entry.objectclass;
    });
    _res.on('end', function(result) {
      if (done)
        return;
      done = true;
      return callback(null, entry);
    });
  });
}


///--- API


module.exports = {

  list: function(req, res, next) {
    assert.ok(req.customer);
    assert.ok(req.ldap);

    log.debug('GetMetadataKeys %s/%s entered',
              req.uriParams.uuid, req.uriParams.appkey);

    return loadMetadata(req, function(err, entry) {
      if (err)
        return next(err);

      var keys = Object.keys(entry);

      if (req.xml)
        keys = { keys: { key: keys } };

      log.debug('GetMetadataKeys %s/%s -> %o',
                req.uriParams.uuid, req.uriParams.appkey, keys);
      res.send(200, keys);
      return next();
    });
  },

  put: function(req, res, next) {
    assert.ok(req.ldap);

    var dn = sprintf(MD_DN, req.uriParams.appkey, req.customer.dn.toString());

    log.debug('PutMetadataKey %s/%s/%s entered',
              req.uriParams.uuid, req.uriParams.appkey, req.uriParams.key);
    return loadMetadata(req, true, function(err, entry) {
      if (err)
        return next(err);

      if (!entry) {
        log.debug('PutMetadataKey %s/%s/%s: need to add', req.uriParams.uuid,
                  req.uriParams.appkey, req.uriParams.key);
        entry = {
          cn: [req.uriParams.appkey],
          objectclass: ['capimetadata']
        };
        entry[req.uriParams.key] = [req.body];
        return req.ldap.add(dn, entry, function(err) {
          if (err)
            return next(new restify.InternalError(err.toString()));

          log.debug('PutMetadataKey %s/%s/%s: added', req.uriParams.uuid,
                    req.uriParams.appkey, req.uriParams.key);
          res.send(201);
          return next();
        });
      }

      var mod = {};
      mod[req.uriParams.key] = [req.body];
      var change = new Change({
        type: 'replace',
        modification: mod
      });

      log.debug('PutMetadataKey %s/%s/%s: updating', req.uriParams.uuid,
                req.uriParams.appkey, req.uriParams.key);
      return req.ldap.modify(dn, change, function(err) {
        if (err)
          return next(new restify.InternalError(err.toString()));

        log.debug('PutMetadataKey %s/%s/%s: updated', req.uriParams.uuid,
                  req.uriParams.appkey, req.uriParams.key);
        res.send(entry[req.uriParams.key] ? 200 : 201);
        return next();
      });
    });
  },

  get: function(req, res, next) {
    assert.ok(req.ldap);

    log.debug('GetMetadataKey %s/%s/%s entered',
              req.uriParams.uuid, req.uriParams.appkey, req.uriParams.key);
    return loadMetadata(req, function(err, entry) {
      if (err)
        return next(err);

      if (!entry[req.uriParams.key])
        return next(new restify.ResourceNotFoundError(req.uriParams.key));

      // force this on the client, like a true CAPI would!
      res._accept = 'text/plain';
      var value = entry[req.uriParams.key];
      log.debug('GetMetadataKey %s/%s/%s -> %s',
                req.uriParams.uuid, req.uriParams.appkey, req.uriParams.key,
                value);
      res.send(200, value);
      return next();
    });
  },

  del: function(req, res, next) {
    assert.ok(req.customer);
    assert.ok(req.ldap);

    log.debug('DeleteMetadataKey %s/%s/%s entered',
              req.uriParams.uuid, req.uriParams.appkey, req.uriParams.key);

    return loadMetadata(req, function(err, entry) {
      if (err)
        return next(err);

      if (!entry[req.uriParams.key])
        return next(new restify.ResourceNotFoundError(req.uriParams.key));

      var mod = {};
      mod[req.uriParams.key] = entry[req.uriParams.key];
      var change = new Change({
        type: 'delete',
        modification: mod
      });

      var dn = sprintf(MD_DN, req.uriParams.appkey, req.customer.dn.toString());
      log.debug('DeletMetadataKey %s: deleting %s', dn, req.uriParams.key);
      return req.ldap.modify(dn, change, function(err) {
        if (err)
          return next(new restify.InternalError(err.toString()));

        log.debug('DeleteMetadataKey %s deleted %s', dn, req.uriParams.key);
        res.send(200);
        return next();
      });
    });
  },

};
