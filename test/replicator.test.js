/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 */

/* Test the Boilerplate API endpoints */


var Replicator = require('../lib/index');
var REPLICATOR;

var Logger = require('bunyan');

var LOG = new Logger({
	name: 'replicator-test',
    stream: process.stdout,
    serializers: Logger.stdSerializers,
	level: 'trace'
});

var REMOTE_UFDS = {
	url: 'ldaps://10.99.99.14',
	maxConnections: 1,
	bindDN: 'cn=root',
	bindCredentials: 'secret'
};

var REPLICATOR_OPTS = {
	log: LOG,
	remoteUfds: REMOTE_UFDS
};

exports.initReplicator = function(t) {
	REPLICATOR = new Replicator(REPLICATOR_OPTS);
    t.done();
};

exports.step = function(t) {
    t.done();
};

