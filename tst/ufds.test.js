// Copyright 2011 Joyent, Inc.  All rights reserved.

var httpSignature = require('http-signature');
var ldap = require('ldapjs');
var log4js = require('log4js');
var test = require('tap').test;
var uuid = require('node-uuid');



///--- Globals

var FIXTURES = {
  suffix: {
    'o=smartdc': {
      o: 'smartdc',
      objectclass: 'organization'
    }
  },
  ous: {
    'ou=users, o=smartdc': {
      ou: 'users',
      objectclass: 'organizationalUnit'
    },
    'ou=groups, o=smartdc': {
      ou: 'groups',
      objectclass: 'organizationalUnit'
    }
  },
  users: {
    'uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc': {
      login: 'admin',
      uuid: '930896af-bf8c-48d4-885c-6573a94b1853',
      userpassword: 'joypass123',
      email: 'nobody@joyent.com',
      cn: 'admin',
      sn: 'user',
      company: 'Joyent',
      address: ['Joyent, Inc.', '345 California Street, Suite 2000'],
      city: 'San Francisco',
      state: 'CA',
      postalCode: '94104',
      country: 'USA',
      phone: '+1 415 400 0600',
      objectclass: 'sdcPerson'
    }
  },
  groups: {
    'cn=operators, ou=groups, o=smartdc': {
      uniquemember: 'uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, ' +
        'o=smartdc',
      objectclass: 'groupOfUniqueNames'
    }
  }
};

var SSH_KEY = 'ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAQEA0A5Pf5Cq/' +
  'h8ogPytJE3MIcdtgjeK4qncz1wpxhOG/VldgnwoZmnv//a37e5MsJvJa7' +
  'E9mnIab9RaBzTkjvIH6KFG99OImizzeFqOAm/ixHx146qmuiNmdh7jn2u' +
  'HZlnkUAKLzNMQyHANwqmn5UuRzOhLRkUOLqPHXk0UFJSLvhnyXRerCsy/' +
  '2/1ckabwHlSJJ1HmYfS3a1lXRgQkdUo1ouULJQIzU214hp2xcmxCAZXTS' +
  'xWKeuDpZEAjIwg77qynySMo+yEuCL1oZrRrKVXLFhWcjdf9Rg+O8GpYdw' +
  '7JHg/ky2I5KCLT/dsysvdC72VcgjnSf0b73Vh35L/zQNiDiQ== mark@smartzero.local';
var SSH_KEY_FP = httpSignature.sshKeyFingerprint(SSH_KEY);
var client;



///--- Helpers

Array.prototype.asyncForEach = function(fn, callback) {
  if (!this.length)
    return callback(null);

  var remain = this.length;
  var error = null;

  return this.forEach(function(i) {
    fn(i, function(err) {
      if (error)
        return;
      if (err) {
        error = err;
        return callback(err);
      }
      if ((--remain === 0) && !error)
        return callback(null);
    });
  });
};



///--- Setup: spans a few methods

log4js.setGlobalLogLevel('Info');

test('create client', function(t) {
  client = ldap.createClient({
    url: 'ldaps://localhost:1636',
    log4js: log4js,
    reconnect: false
  });
  t.ok(client);
  t.end();
});


test('bind as admin', function(t) {
  client.bind('cn=root', 'secret', function(err) {
    t.ifError(err);
    t.end();
  });
});


test('add suffix', function(t) {
  Object.keys(FIXTURES.suffix).asyncForEach(function(k, callback) {
    client.add(k, FIXTURES.suffix[k], callback);
  }, function(err) {
    t.ifError(err);
    t.end();
  });
});


test('add ous', function(t) {
  Object.keys(FIXTURES.ous).asyncForEach(function(k, callback) {
    client.add(k, FIXTURES.ous[k], callback);
  }, function(err) {
    t.ifError(err);
    t.end();
  });
});


test('add users', function(t) {
  Object.keys(FIXTURES.users).asyncForEach(function(k, callback) {
    client.add(k, FIXTURES.users[k], callback);
  }, function(err) {
    t.ifError(err);
    t.end();
  });
});


test('add groups', function(t) {
  Object.keys(FIXTURES.groups).asyncForEach(function(k, callback) {
    client.add(k, FIXTURES.groups[k], callback);
  }, function(err) {
    t.ifError(err);
    t.end();
  });
});


///--- Start actual tests

test('assert salted password', function(t) {
  var opts = {
    scope: 'base',
    filter: '(objectclass=sdcperson)',
    attributes: ['*', 'memberof']
  };
  var hidden = new ldap.Control({
    type: '1.3.6.1.4.1.38678.1',
    criticality: true
  });
  var dn = Object.keys(FIXTURES.users)[0];
  client.search(dn, opts, hidden, function(err, res) {
    t.ifError(err);

    var user;
    res.on('searchEntry', function(entry) {
      t.ok(entry);
      t.equal(entry.object.dn, dn);
      user = entry.object;
      t.ok(user.userpassword);
      t.notEqual('joypass123', user.userpassword);
      t.ok(user._salt);
    });
    res.on('error', function(err) {
      t.fail(err);
    });
    res.on('end', function() {
      t.ok(user);
      t.end();
    });
  });
});


test('bind as admin (like adminui does)', function(t) {
  var opts = {
    scope: 'one',
    filter: '(&(login=admin)(objectclass=sdcperson))',
    attributes: ['*', 'memberof']
  };
  var dn = Object.keys(FIXTURES.users)[0];
  client.search('ou=users, o=smartdc', opts, function(err, res) {
    t.ifError(err);
    var user;
    res.on('searchEntry', function(entry) {
      t.ok(entry);
      t.equal(entry.object.dn, dn);
      user = entry.object;
      t.ok(user.memberof);
      t.equal(user.memberof, Object.keys(FIXTURES.groups)[0]);
    });
    res.on('error', function(err) {
      t.fail(err);
    });
    res.on('end', function() {
      t.ok(user);
      client.bind(user.dn, 'joypass123', function(err) {
        t.ifError(err);
        t.end();
      });
    });
  });
});


test('add an ssh key', function(t) {
  var dn = 'fingerprint=' + SSH_KEY_FP + ', ' + Object.keys(FIXTURES.users)[0];
  var entry = {
    fingerprint: SSH_KEY_FP,
    name: uuid(),
    openssh: SSH_KEY,
    objectclass: 'sdckey'
  };
  client.add(dn, entry, function(err) {
    t.ifError(err);
    t.end();
  });
});


test('lookup ssh key', function(t) {
  var opts = {
    scope: 'base',
    filter: '(objectclass=sdckey)'
  };
  var dn = 'fingerprint=' + SSH_KEY_FP + ', ' + Object.keys(FIXTURES.users)[0];
  client.search(dn, opts, function(err, res) {
    t.ifError(err);
    var key;
    res.on('searchEntry', function(entry) {
      t.ok(entry);
      key = entry.object;
      t.ok(key.fingerprint);
      t.ok(key.openssh);
      t.ok(key.pkcs);
    });
    res.on('error', function(err) {
      t.fail(err);
    });
    res.on('end', function() {
      t.ok(key);
      t.end();
    });
  });
});


test('add a new customer', function(t) {
  var id = uuid();
  var dn = 'uuid=' + id + ', ou=users, o=smartdc';
  var entry = {
    login: 'unittest',
    uuid: id,
    userpassword: 'secret',
    email: 'dev@null.com',
    cn: 'Unit',
    sn: 'Tester',
    objectclass: 'sdcPerson'
  };

  client.add(dn, entry, function(err) {
    t.ifError(err);
    t.end();
  });
});


test('attempt to add a taken username', function(t) {
  var id = uuid();
  var dn = 'uuid=' + id + ', ou=users, o=smartdc';
  var entry = {
    login: 'unittest',
    uuid: id,
    userpassword: 'secret',
    email: 'dev@null.com',
    cn: 'Unit',
    sn: 'Tester',
    objectclass: 'sdcPerson'
  };

  client.add(dn, entry, function(err) {
    t.ok(err);
    t.ok(err instanceof ldap.ConstraintViolationError);
    t.end();
  });
});


///--- End actual tests

///--- Teardown methods
// Note riak deletion is where eventual consistency bites you in the ass, so
// here we just play some timeout games and hope for the best. If you want to
// change the wait time, just export RIAK_DELETE_WAIT=:seconds

test('cleanup ssh key', function(t) {
  var dn = 'fingerprint=' + SSH_KEY_FP + ', ' + Object.keys(FIXTURES.users)[0];
  client.del(dn, function(err) {
    t.ifError(err);
    setTimeout(function() { t.end(); },
               (process.env.RIAK_DELETE_WAIT || 3) * 1000);
  });
});


test('delete groups', function(t) {
  Object.keys(FIXTURES.groups).asyncForEach(function(k, callback) {
    client.del(k, callback);
  }, function(err) {
    t.ifError(err);
    setTimeout(function() { t.end(); },
               (process.env.RIAK_DELETE_WAIT || 3) * 1000);
  });
});


test('delete users', function(t) {
  var entries = [];
  var opts = {
    scope: 'sub',
    filter: '(login=*)',
    attributes: ['dn']
  }
  client.search('o=smartdc', opts, function(err, res) {
    t.ifError(err);

    res.on('searchEntry', function(entry) {
      entries.push(entry.dn);
    });
    res.on('error', function(err) {
      t.fail(err);
    });
    res.on('end', function() {
      t.ok(entries.length);
      entries.sort(function(a, b) {
        var dn = ldap.parseDN(a);
        if (dn.childOf(b)) return -1;
        if (dn.parentOf(b)) return 1;
        return 0;
      });

      var i = 0;
      function next(err) {
        t.ifError(err);
        if (++i < entries.length)
          return client.del(entries[i], next);

        setTimeout(function() { t.end(); },
                   (process.env.RIAK_DELETE_WAIT || 3) * 1000);
      }
      client.del(entries[i], next);
    })
  });
});


test('delete ous', function(t) {
  Object.keys(FIXTURES.ous).asyncForEach(function(k, callback) {
    client.del(k, callback);
  }, function(err) {
    t.ifError(err);
    setTimeout(function() { t.end(); },
               (process.env.RIAK_DELETE_WAIT || 3) * 1000);
  });
});


test('delete suffix', function(t) {
  Object.keys(FIXTURES.suffix).asyncForEach(function(k, callback) {
    client.del(k, callback);
  }, function(err) {
    t.ifError(err);
    t.end();
  });
});


test('unbind client', function(t) {
  client.unbind(function(err) {
    t.ifError(err);
    t.end();
  });
});
