/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 */

/* Test the Boilerplate API endpoints */


var Replicator = require('../lib/index');
var REPLICATOR;

var bunyan = require('bunyan');

var LOG = bunyan.createLogger({
	name: 'replicator-test',
        stream: process.stdout,
        serializers: bunyan.stdSerializers,
	level: 'debug'
});

var LOCAL_UFDS = {
	url: 'ldap://' + (process.env.LOCAL_UFDS_IP || '127.0.0.1:1389'),
	maxConnections: 1,
	bindDN: 'cn=root',
	bindCredentials: 'secret'
};

var REMOTE_UFDS = {
	url: 'ldaps://' + (process.env.UFDS_IP || '10.99.99.14/ou=users,%20o=smartdc??sub?(!(objectclass=vm))'),
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

exports.step = function(t) {
	setTimeout(function () {
    	t.done();
	}, 2000);
};


exports.cleanup = function(t) {
    REPLICATOR.once('stopped', function () {
        t.done();
    });

    REPLICATOR.stop();
};
