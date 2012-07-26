/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * A brief overview of this source file: what is its purpose.
 */


var assert = require('./assert');
var vasync = require('vasync');
var ldap = require('ldapjs');
var util = require('util');
var sprintf = require('util').format;

var assertArray = assert.assertArray;
var assertFunction = assert.assertFunction;
var assertNumber = assert.assertNumber;
var assertObject = assert.assertObject;
var assertString = assert.assertString;

var CHANGELOG = 'cn=changelog';


/*
 * Replicator constructor
 *
 * Required
 * - localUfds
 * - remoteUfds
 * - log
 *
 * Optional
 * - pollInterval
 */
function Replicator(options) {
	assertObject('options', options);
  	assertObject('options.log', options.log);
  	// assertObject('options.localUfds', options.localUfds);
  	assertObject('options.remoteUfds', options.remoteUfds);

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
	 * Remote UFDS client
	 */
	this.remoteUfdsCfg = options.remoteUfds;
	this.remoteUfdsCfg.log = this.log;
	this.initRemote();
}



Replicator.prototype.initRemote = function() {
	var self = this;
	var log = self.log;

	self.remoteUfds = ldap.createClient(self.remoteUfdsCfg);

	self.remoteUfds.on('error', function(err) {
		log.fatal({ err: err }, 'ldap client error');
		// process.exit(err);
	});

	self.remoteUfds.on('connect', function() {
		self.log.info("test");
		console.log("test");
		log.info('ldap client connected');

		var dn = self.remoteUfdsCfg.bindDN;
		var pw = self.remoteUfdsCfg.bindCredentials;

		self.remoteUfds.bind(dn, pw, function(err) {
	  		if (err) {
	    		log.fatal({ err: err }, 'unable to bind');
	    		process.exit(err);
	  		}

	  		log.info('ldap client bound!');
	  		// Get current change number
	  		// Start polling
    		log.info('start polling');
    		// setInterval(tryPoll, self.pollInterval, self);
    		// tryPoll(self);
		});
	});
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
	self.log.debug("\n" + CHANGELOG + "\n")
	var opts = {
		scope: 'sub',
		filter: filter
	};

	// throwSomething();

	log.info('searching %s with opts %j', CHANGELOG, opts);
	var entries = [];

	self.log.debug(filter)
	self.log.debug(CHANGELOG)

	self.remoteUfds.search(CHANGELOG, opts, function(err, res, count) {
		ldapErrHandler(self, err);

		// save the matching entries and sort.
		res.on('searchEntry', function(entry) {
			log.debug('search entry', entry.object.targetdn,
		    			entry.object.changenumber, entry.object.changetype);

			// INSERT ENTRY HANDLING CODE
		});

		res.on('err', function(err) {
			ldapErrHander(self, err);
		});

		res.on('end', function(res) {
			log.info('finished');
	    });
	});
}


function ldapErrHandler(self, err) {
	var log = self.log;
	if (err) {
		log.fatal({ err: err });
		// process.exit(err);
	}
}


function sort(a, b) {
	a = parseInt(a.object.changenumber, 10);
	b = parseInt(b.object.changenumber, 10);

	return a - b;
}


module.exports = Replicator;
