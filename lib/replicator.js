/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * A brief overview of this source file: what is its purpose.
 */


var assert = require('assert-plus');
var EventEmitter = require('events').EventEmitter;
var vasync = require('vasync');
var ldap = require('ldapjs');
var util = require('util');
var sprintf = require('util').format;

var CHANGELOG = 'cn=changelog';


/*
 * Replicator constructor
 *
 * Required
 * - localUfds
 * - remoteUfds
 * - replicationSuffix
 * - log
 *
 * Optional
 * - pollInterval
 */
function Replicator(options) {
	assert.object(options, 'options');
  	assert.object(options.log, 'options.log');
  	// assert.object(options.localUfds, 'options.localUfds');
  	assert.object(options.remoteUfds, 'options.remoteUfds');

    EventEmitter.call(this);

  	/**
  	 * Bunyan Logger
  	 */
  	this.log = options.log;

	/**
	 * The interval to poll UFDS
	 */
	this.pollInterval = options.pollInterval || 1000;

	/**
	 * Indicates whether we are already polling UFDS
	 */
	this.currPolling = false;

	/**
	 * The serial entry queue, ensure entries are processed serially.
	 */
	// this.queue = vasync.queue(parseEntry, 1);

	/**
	 * The latest consumed changenumber.
	 */
	this.changenumber = 0;

	/**
	 * Replication suffix
	 */
	this.replicationSuffix = options.replicationSuffix || '';

	/**
	 * Remote UFDS client
	 *
	 * The replication url has the following form:
	 * ldapurl = scheme://[hostport]/dn?attributes?scope?filter?extensions
	 *
	 * - dn: root dn to replicate from
	 * - attributes: attributes to return
	 * - scope: one, base or sub
	 * - filter: ldap filter
	 * - extensions: ladp extensions
	 *
	 * For now we will focus on dn, scope and filter only
	 */
	this.remoteUfdsCfg = options.remoteUfds;
	this.replicationUrl = ldap.parseURL(this.remoteUfdsCfg.url);

	// Be sure to require DN to replicate
	// For now we default the scope to sub and the filter to (objectclass=*)
	assert.string(this.replicationUrl.DN, 'Replication DN');
	this.remoteDN = ldap.parseDN(this.replicationUrl.DN);
	this.scope = this.replicationUrl.scope || 'sub';

	this.remoteUfdsCfg.log = this.log;
	this.initRemote();
}

util.inherits(Replicator, EventEmitter);



Replicator.prototype.initRemote = function() {
	var self = this;
	var log = self.log;

	self.remoteUfds = ldap.createClient(self.remoteUfdsCfg);

	self.remoteUfds.on('error', function(err) {
		log.fatal({ err: err }, 'UFDS client error');
		process.exit(err);
	});

	var dn = self.remoteUfdsCfg.bindDN;
	var pw = self.remoteUfdsCfg.bindCredentials;

	self.remoteUfds.bind(dn, pw, function(err) {
	  	if (err) {
	    		log.fatal({ err: err }, 'Unable to bind to UFDS');
	    		process.exit(err);
	  	}

	  	log.info('UFDS client bound!');

	  	// HERE Get current changenumber

		self.timer = setInterval(tryPoll, self.pollInterval, self);
		tryPoll(self);
        self.emit('started');
	});
}



Replicator.prototype.stop = function stop() {
	var self = this;

	if (this.timer)
	    clearInterval(this.timer);

	this.remoteUfds.unbind(function () {
        self.emit('stopped');
	});
};



Replicator.prototype.handleEntry = function (entry) {
	var log = this.log;

	var targetdn = ldap.parseDN(entry.targetdn);
	var changes = JSON.parse(entry.changes);
}


function tryPoll(self) {
	try {
		poll(self);
	} catch (e) {
		self.log.error({ e: e });
		throw e;
	}
}

function poll(self) {
	var log = self.log;
	if (self.currPolling) {
	    return;
	}

	self.currPolling = true;

	var start = parseInt(self.changenumber, 10);
	var max = start + 10;

	var filter = sprintf('(&(changenumber<=%s))', max);

	var opts = {
		scope: 'sub',
		filter: filter
	};

	log.info('Searching %s with opts %j', CHANGELOG, opts);
	var entries = [];

	self.remoteUfds.search(CHANGELOG, opts, function(err, res, count) {
		ldapErrHandler(self, err);

		// save the matching entries and sort.
		res.on('searchEntry', function(entry) {
			log.debug('Search entry',
						entry.object.targetdn,
		    			entry.object.changenumber, entry.object.changetype);
      		self.handleEntry(entry.object)
		});

		res.on('err', function(err) {
			ldapErrHander(self, err);
		});

		res.on('end', function(res) {
			log.info('Finished search');
	    });
	});
}


function ldapErrHandler(self, err) {
	var log = self.log;
	if (err) {
		log.fatal({ err: err });
		process.exit(err);
	}
}


function sort(a, b) {
	a = parseInt(a.object.changenumber, 10);
	b = parseInt(b.object.changenumber, 10);

	return a - b;
}


module.exports = Replicator;
