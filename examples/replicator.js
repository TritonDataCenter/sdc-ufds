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
 * 		-f data/bootstrap.ldif
 */

var assert = require('assert-plus');
var bunyan = require('bunyan');

var Replicator = require('../lib/index');

var LOG = bunyan.createLogger({
	name: 'sample-replicator',
        stream: process.stdout,
        serializers: bunyan.stdSerializers,
	level: 'debug'
});

var rep;
var REPLICATION_QUERY = '/ou=users,%20o=smartdc??sub?';

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


rep = new Replicator(REPLICATOR_OPTS);
rep.init();


rep.once('started', function () {
    LOG.info('Replicator has started!');
});


rep.on('caughtup', function (cn) {
	LOG.info('Replicator has caught up with UFDS at changenumber %s', cn);
});


rep.once('stopped', function () {
	LOG.info('Replicator has stopped!');
	process.exit(1);
});


process.on('SIGINT', function () {
	rep.stop();
});

