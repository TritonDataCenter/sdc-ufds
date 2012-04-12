// Copyright 2012 Joyent, Inc.  All rights reserved.

var ldap = require('ldapjs');

var cache = require('./cache');



///--- Globals

var DN = ldap.DN;
var parseDN = ldap.parseDN;
var MEMBER_BASE_OPTS = {
  scope: 'base',
  filter: new ldap.PresenceFilter({attribute: 'objectclass'})
};



///--- Helpers

function memberOfOpts(dn) {
  return {
    scope: 'sub',
    filter: new ldap.EqualityFilter({
      attribute: 'uniquemember',
      value: dn.toString()
    }),
    attributes: ['dn']
  };
}



///--- API

function GroupManager(options) {
  if (typeof(options) !== 'object')
    throw new TypeError('options (object) required');
  if (!options.log4js)
    throw new TypeError('options.log4js (object) required');

  this.memberCache = cache.createCache(options.cache);
  this.memberOfCache = cache.createCache(options.cache);
  this.client = options.client;
  this.log = options.log4js.getLogger('GroupManager');
}


GroupManager.prototype.memberOf = function(dn, groupdn, callback) {
  assert.ok(dn);
  assert.ok(groupdn);
  assert.ok(callback);

  var self = this;

  var cacheKey = dn.toString() + '::' + groupdn.toString();
  var cacheVal = null;
  if ((cacheVal = this.memberCache.get(cacheKey)) !== null)
    return callback(null, cacheVal);

  this.client.search(groupdn, MEMBER_BASE_OPTS, function(err, res) {
    if (err)
      return callback(err);

    var done = false;
    res.on('searchEntry', function(entry) {
      if (done)
        return;

      for (var i = 0; i < entry.attributes.length; i++) {
        var a = entry.attributes[i];
        a.type = a.type.toLowerCase();
        if (a.type !== 'uniquemember' && a.type !== 'member')
          continue;

        for (var j = 0; j < a.vals.length; j++) {
          if (dn.toString() === a.vals[j]) {
            done = true;
            self.memberCache.put(cacheKey, true);
            return callback(null, true);
          }
        }
      }

    });
    res.on('error', function(err) {
      if (done)
        return;

      done = true;
      return callback(err);
    });
    res.on('end', function() {
      if (done)
        return;

      done = true;
      self.memberCache.put(cacheKey, false);
      return callback(null, false);
    });
  });
};


GroupManager.prototype.searchCallback = function(req, entry, callback) {
  assert.ok(req);
  assert.ok(callback);

  var log = this.log;

  if (req.attributes.indexOf('memberof') === -1 || !entry)
    return callback(null, entry);

  var cacheKey = entry.dn.toString();
  var cacheVal = null;
  if ((cacheVal = this.memberOfCache.get(cacheKey)) !== null) {
    entry.attributes.memberof = cacheVal;
    return callback(null, entry);
  }

  if (log.isTraceEnabled())
    log.trace('%s searchCallback searching $self', req.logId);

  var self = this;
  entry.attributes.memberof = [];
  this.client.search(req.suffix, memberOfOpts(entry.dn), function(err, res) {
    if (err)
      return callback(err, entry);

    var done = false;
    function _callback(err, entry) {
      if (done)
        return;

      done = true;
      return callback(err, entry);
    }

    res.on('error', function(err) {
      return _callback(err, null);
    });
    res.on('searchEntry', function(_entry) {
      entry.attributes.memberof.push(_entry.objectName.toString());
    });
    res.on('end', function() {
      self.memberCache.put(cacheKey, entry.attributes.memberof);
      return _callback(null, entry);
    });
  });
};


///--- Exported API

module.exports = {

  createGroupManager: function(options) {
    return new GroupManager(options);
  }

};
