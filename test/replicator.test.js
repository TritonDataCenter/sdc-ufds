/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 */

/* Test the Boilerplate API endpoints */


var assert = require('assert-plus');

var fixtures = require('./fixtures');
var Replicator = require('../lib/index');
var REPLICATOR;

var bunyan = require('bunyan');

var LOG = bunyan.createLogger({
	name: 'replicator-test',
        stream: process.stdout,
        serializers: bunyan.stdSerializers,
	level: 'debug'
});

var CUSTOMER_DN = 'uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc';
var REPLICATION_QUERY = '/ou=users,%20o=smartdc??sub?(&(!(objectclass=vm))(!(login=admin)))';

var LOCAL_UFDS = {
	url: 'ldap://' + (process.env.LOCAL_UFDS_IP || '127.0.0.1:1389'),
	maxConnections: 1,
	bindDN: 'cn=root',
	bindCredentials: 'secret'
};


var REMOTE_UFDS = {
	url: 'ldaps://' + (process.env.UFDS_IP || '10.99.99.14' + REPLICATION_QUERY),
	maxConnections: 1,
	bindDN: 'cn=root',
	bindCredentials: 'secret'
};


var REPLICATOR_OPTS = {
	log: LOG,
	localUfds: LOCAL_UFDS,
	remoteUfds: REMOTE_UFDS,
	checkpointDn: 'cn=replicator, datacenter=coal, o=smartdc'
};


exports.initReplicator = function(t) {
	REPLICATOR = new Replicator(REPLICATOR_OPTS);
	REPLICATOR.init();

	REPLICATOR.once('started', function () {
	    t.done();
	});
};


exports.bootstrap = function(t) {
	var remote = REPLICATOR.remoteUfds;

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


// Give the replicator time to catch up
exports.bootstrapCatchUp = function(t) {
	setTimeout(function () {
    	t.done();
	}, 180000);
};


// Create delete operations and let them replicate
exports.unbootstrap = function(t) {
	var remote = REPLICATOR.remoteUfds;

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


exports.unbootstrapCatchUp = function(t) {
	setTimeout(function () {
    	t.done();
	}, 3000);
};


exports.cleanup = function(t) {
    REPLICATOR.once('stopped', function () {
        t.done();
    });

	REPLICATOR.checkpoint.set(0, function(err) {
		assert.ifError(err);
		REPLICATOR.stop();
	});
};
