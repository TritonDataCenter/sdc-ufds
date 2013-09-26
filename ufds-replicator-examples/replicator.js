/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * A brief overview of this source file: what is its purpose.
 */


/*
 * Bootstrap the local UFDS tree with:
 *
 * LDAPTLS_REQCERT=allow ldapadd -H ldap://127.0.0.1:1389 \
 *		-x -D cn=root -w secret \
 *      -f data/bootstrap.ldif
 */

var assert = require('assert-plus');
var bunyan = require('bunyan');

var Replicator = require('../lib/index');

var LOG = bunyan.createLogger({
	name: 'sample-replicator',
        stream: process.stdout,
        serializers: bunyan.stdSerializers,
	level: process.LOG_LEVEL || 'debug'
});

var rep;

var USERS_QUERY = '/ou=users, o=smartdc??sub?';
var SERVERS_QUERY = '/ou=servers, datacenter=coal, o=smartdc??sub?';
var PACKAGES_QUERY = '/ou=packages, o=smartdc??sub?';

var LOCAL_UFDS = {
	url: process.env.LOCAL_UFDS_URL || 'ldap://127.0.0.1:1389',
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
	url: process.env.REMOTE_UFDS_URL || 'ldaps://10.99.99.18',
	queries: QUERIES_ONE,
	maxConnections: 1,
	bindDN: 'cn=root',
	bindCredentials: 'secret'
};

var REMOTE_TWO = {
	url: process.env.REMOTE_UFDS_URL || 'ldaps://10.99.99.18',
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


rep = new Replicator(REPLICATOR_OPTS);
rep.init();


rep.once('started', function () {
    LOG.info('Replicator has started!');
});

rep.once('error', function (err) {
    LOG.info(err, 'Replicator has thrown an error, exiting');
    process.exit(1);
});


rep.on('caughtup', function (id, cn) {
	LOG.info('Replicator %d has caught up with UFDS at changenumber %s', id, cn);
});


rep.once('stopped', function () {
	LOG.info('Replicator has stopped!');
	process.exit(1);
});


process.on('SIGINT', function () {
	rep.stop();
});

