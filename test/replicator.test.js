/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 */

/* Test the Boilerplate API endpoints */


var assert = require('assert-plus');

var fixtures = require('./fixtures');
var Replicator = require('../lib/index');
var rep;

var bunyan = require('bunyan');

var LOG = bunyan.createLogger({
	name: 'replicator-test',
        stream: process.stdout,
        serializers: bunyan.stdSerializers,
	level: 'info'
});

var CUSTOMER_DN = 'uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc';

var USERS_QUERY = '/ou=users, o=smartdc??sub?';
var SERVERS_QUERY = '/ou=servers, datacenter=coal, o=smartdc??sub?';
var PACKAGES_QUERY = '/ou=packages, o=smartdc??sub?';

var LOCAL_UFDS = {
	url: 'ldap://' + (process.env.LOCAL_UFDS_IP || '127.0.0.1:1389'),
	maxConnections: 1,
	bindDN: 'cn=root',
	bindCredentials: 'secret'
};

var QUERIES_ONE = [
	USERS_QUERY,
	SERVERS_QUERY
];

var QUERIES_TWO = [
	PACKAGES_QUERY
];

var REMOTE_ONE = {
	url: 'ldaps://' + (process.env.UFDS_IP || '10.99.99.14'),
	queries: QUERIES_ONE,
	maxConnections: 1,
	bindDN: 'cn=root',
	bindCredentials: 'secret'
};

var REMOTE_TWO = {
	url: 'ldaps://' + (process.env.UFDS_IP || '10.99.99.14'),
	queries: QUERIES_TWO,
	maxConnections: 1,
	bindDN: 'cn=root',
	bindCredentials: 'secret'
};

var REPLICATOR_OPTS = {
	log: LOG,
	localUfds: LOCAL_UFDS,
	remotes: [REMOTE_ONE, REMOTE_TWO],
	checkpointDn: 'cn=replicator, datacenter=coal, o=smartdc'
};


exports.initReplicator = function(t) {
	rep = new Replicator(REPLICATOR_OPTS);
	rep.init();

	rep.once('started', function () {
	    t.done();
	});
};


// // Give the replicators time to catch up
exports.catchUp = function(t) {
	var done = 0;

	rep.on('caughtup', function (id, cn) {
		done++;

		if (done == 2) {
			rep.removeAllListeners('caughtup');
			t.done();
		}
	});
};


exports.addUser = function(t) {
	var remote = rep.remotes[0].remoteUfds;

	var user = fixtures.user;
	var key = fixtures.key;

	remote.add(user.dn, user.object, function (errA, resA) {
		assert.ifError(errA);

		remote.add(key.dn, key.object, function (errB, resB) {
			assert.ifError(errB);

			t.done();
		});
	});
};


exports.catchUpAdd = function(t) {
	rep.once('caughtup', function (cn) {
		t.done();
	});
};


exports.getUser = function(t) {
	var local = rep.localUfds;

	var user = fixtures.user;
	var opts = {
		scope: 'sub',
		filter: '(objectclass=*)'
	};

	var entries = 0;

	local.search(user.dn, opts, function (err, res) {
		assert.ifError(err);

		res.on('searchEntry', function (entry) {
			assert.ok(entry);
			entries++;
		});

		res.on('end', function (res) {
			assert.equal(entries, 2);
			t.done();
		});
	});
};


exports.deleteUser = function(t) {
	var remote = rep.remotes[0].remoteUfds;

	var userDn = fixtures.user.dn;
	var keyDn = fixtures.key.dn;

	remote.del(keyDn, function (errA, resA) {
		assert.ifError(errA);

		remote.del(userDn, function (errB, resB) {
			assert.ifError(errB);

			t.done();
		});
	});
};


exports.catchUpDelete = function(t) {
	rep.once('caughtup', function (cn) {
		t.done();
	});
};


exports.cleanup = function(t) {
    rep.once('stopped', function () {
        t.done();
    });

	rep.stop();
};
