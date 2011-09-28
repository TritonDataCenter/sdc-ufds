// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');


var ldap = require('ldapjs');
var restify = require('restify');
var sprintf = require('sprintf').sprintf;
var uuid = require('node-uuid');



///--- Globals

var LIMIT_DN = 'dclimit=%s, %s';

var Change = ldap.Change;
var log = restify.log;



///--- Helpers

function loadLimits(req, callback) {
  var opts = {
    filter: '(objectclass=capilimit)',
    scope: 'one'
  }
  var base = req.customer.dn.toString();
  return req.ldap.search(base, opts, function(err, res) {
    var done = false;
    if (err) {
      done = true;
      return callback(new restify.InternalError(err.toString()));
    }

    var entries = [];
    res.on('error', function(err) {
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
    res.on('searchEntry', function(entry) {
      var e = entry.toObject();

      delete e.dn;
      delete e.objectclass;
      Object.keys(e).forEach(function(k) {
        if (k === 'datacenter' || /^_.*/.test(k))
          return;

        entries.push({
          data_center: e.datacenter,
          zone_type: k,
          limit: parseInt(e[k], 10)
        });
      });
    });
    res.on('end', function(result) {
      if (done)
        return;
      done = true;
      return callback(null, entries);
    });
  });
}



///--- API


module.exports = {

  list: function(req, res, next) {
    assert.ok(req.customer);
    assert.ok(req.ldap);

    log.debug('ListLimits %s/%s entered', req.uriParams.uuid);

    return loadLimits(req, function(err, entries) {
      if (err)
        return next(err);

      if (req.xml)
        entries = { limits: { limit: entries } };

      log.debug('ListLimits %s/%s -> %o', req.uriParams.uuid, entries);
      res.send(200, entries);
      return next();
    });
  },

  put: function(req, res, next) {
    assert.ok(req.customer);
    assert.ok(req.ldap);

    log.debug('PutLimit /%s/%s/%s entered', req.uriParams.uuid,
              req.uriParams.dc, req.uriParams.dataset);

    var dn = sprintf(LIMIT_DN, req.uriParams.dc, req.customer.dn.toString());
    return loadLimits(req, function(err, entries) {
      if (err)
        return next(err);

      var exists = false;
      entries.forEach(function(e) {
        if (e.data_center === req.uriParams.dc)
          exists = e;
      });

      if (exists) {
        var mod = {};
        mod[req.uriParams.dataset] = req.body;
        var change = new Change({
          type: 'replace',
          modification: mod
        });
        return req.ldap.modify(dn, change, function(err) {
          if (err)
            return next(new restify.InternalError(err.message));

          log.debug('PutLimit %s modified -> %s', dn, req.body);
          res.send(200);
          return next();
        });
      }

      var entry = {
        datacenter: req.uriParams.dc,
        objectclass: 'capilimit'
      };
      entry[req.uriParams.dataset] = req.body;
      return req.ldap.add(dn, entry, function(err) {
        if (err)
          return next(new restify.InternalError(err.message));

        log.debug('PutLimit %s created -> %s', dn, req.body);
        res.send(201);
        return next();
      });
    });
  },


  del: function(req, res, next) {
    assert.ok(req.customer);
    assert.ok(req.ldap);

    log.debug('DeleteLimit %s/%s/%s entered',
              req.uriParams.uuid, req.uriParams.dc, req.uriParams.dataset);

    var dn = sprintf(LIMIT_DN, req.uriParams.dc, req.customer.dn.toString());
    return loadLimits(req, function(err, entries) {
      if (err)
        return next(err);

      var exists = false;
      entries.forEach(function(e) {
        if (e.data_center === req.uriParams.dc &&
            e.zone_type === req.uriParams.dataset)
          exists = e;
      });

      if (!exists)
        return next(new restify.ResourceNotFoundError(dn));

      console.log(exists);
      var mod = {};
      mod[req.uriParams.dataset] = exists.limit;
      var change = new Change({
        type: 'delete',
        modification: mod
      });
      return req.ldap.modify(dn, change, function(err) {
        if (err)
          return next(new restify.InternalError(err.message));

        log.debug('DeleteLimit %s: %s deleted', dn, req.uriParams.dataset);
        res.send(200);
        return next();
      });
    });
  }

};
