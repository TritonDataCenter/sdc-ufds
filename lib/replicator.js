/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * A brief overview of this source file: what is its purpose.
 */

module.exports = Replicator;

var assert = require('assert-plus');
var EventEmitter = require('events').EventEmitter;
var vasync = require('vasync');
var ldap = require('ldapjs');
var util = require('util');
var sprintf = require('util').format;

var Checkpoint = require('./checkpoint');
var errors = require('./errors');

var CHANGELOG = 'cn=changelog';


/*
 * Replicator constructor
 *
 * Required
 * - localUfds
 * - remoteUfds
 * - replicationSuffix
 * - checkpointDn
 * - log
 *
 * Optional
 * - pollInterval
 */
function Replicator(options) {
	assert.object(options, 'options');
  	assert.object(options.log, 'options.log');
  	assert.object(options.localUfds, 'options.localUfds');
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
	this.queue = vasync.queue(handleEntry, 1);

	/**
	 * The latest consumed changenumber.
	 */
	this.changenumber = 0;

	/**
	 * Replication suffix
	 */
	this.replicationSuffix = options.replicationSuffix || '';

	/**
	 * Checkpoint DN
	 */
	this.checkpoint = null;
	this.checkpointDn = options.checkpointDn || '';

	/**
	 * Local UFDS client
	 */
	this.localUfdsCfg = options.localUfds;
	this.localUfdsCfg.log = this.log;

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
	this.parseReplicationUrl();

	this.remoteUfdsCfg.log = this.log;

	/**
	 * Initialization chain
	 */
	this.chain = [
		this.initLocal,
		this.initCheckpoint,
		this.initRemote
	];
}

util.inherits(Replicator, EventEmitter);



Replicator.prototype.init = function() {
	var self = this;
	var i = -1;

	function next() {
		i++;

		if (self.chain[i]) {
			self.chain[i].call(self, next);
		}
	}

	return next();
}



Replicator.prototype.initLocal = function(next) {
	var self = this;
	var log = self.log;

	self.localUfds = ldap.createClient(self.localUfdsCfg);

	self.localUfds.on('error', function(err) {
		log.fatal({ err: err }, 'Local UFDS client error');
		process.exit(err);
	});

	var dn = self.localUfdsCfg.bindDN;
	var pw = self.localUfdsCfg.bindCredentials;

	self.localUfds.bind(dn, pw, function(err) {
	  	if (err) {
	    		log.fatal({ err: err }, 'Unable to bind to Local UFDS');
	    		process.exit(err);
	  	}

	  	log.info('Local UFDS client bound!');

	  	return next();
	});
};



Replicator.prototype.initCheckpoint = function(next) {
	var self = this;

	var chkOps = {
		ufds: this.localUfds,
		replicationUrl: this.replicationUrl.href,
		dn: this.checkpointDn
	};

	this.checkpoint = new Checkpoint(chkOps);

	this.checkpoint.init(function (err, changenumber) {
		errors.ldapErrHandler(self.log, err);

    	self.log.debug('Checkpoint initialized');
    	self.changenumber = changenumber;

    	return next();
	});
};



Replicator.prototype.initRemote = function(next) {
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

		self.timer = setInterval(tryPoll, self.pollInterval, self);
		tryPoll(self);
        self.emit('started');

        return next();
	});
};



Replicator.prototype.parseReplicationUrl = function() {
	this.replicationUrl = ldap.parseURL(this.remoteUfdsCfg.url);

	// Be sure to require DN to replicate
	// For now we default the scope to sub and the filter to (objectclass=*)
	assert.string(this.replicationUrl.DN, 'Replication DN');

	this.replicationDN = ldap.parseDN(this.replicationUrl.DN);

	this.replicationFilter = this.replicationUrl.filter ||
							ldap.filters.parseString('(objectclass=*)')

	this.scope = this.replicationUrl.scope || 'sub';
}



Replicator.prototype.canReplicate = function(targetdn, entry) {
	var changetype = entry.object.changetype;
	var changes;

	if (changetype == 'add') {
		changes = entry.parsedChanges;
	} else if (changetype == 'modify') {
		changes = entry.parsedEntry;
	} else {
		// delete
		return false;
	}

	if ( ( targetdn.childOf(this.replicationDN) ||
		   targetdn.parentOf(this.replicationDN) ||
		   targetdn.equals(this.replicationDN) ) &&
		  this.replicationFilter.matches(changes) ) {
		return true;
	} else {
		return false;
	}
};



Replicator.prototype.stop = function stop() {
	var self = this;

	if (this.timer)
	    clearInterval(this.timer);

	this.remoteUfds.unbind(function () {
        self.localUfds.unbind(function () {
        	self.emit('stopped');
		});
	});
};



function handleEntry(entry, callback) {
	var self = entry.self;
	var log = self.log;

	var targetdn = ldap.parseDN(entry.object.targetdn);

	// HANDLE add-modify-delete

	self.changenumber = parseInt(entry.object.changenumber, 10) + 1;

    self.checkpoint.set(self.changenumber, function(err) {
    	errors.ldapErrHandler(log, err);

      	return callback();
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
	var max = start + 30;

	var filter = sprintf('(&(changenumber>=%s)(changenumber<=%s))', start, max);

	var opts = {
		scope: 'sub',
		filter: filter
	};

	log.info('Searching %s with opts %j', CHANGELOG, opts);

	self.remoteUfds.search(CHANGELOG, opts, function (err, res, count) {
		onSearch(self, err, res, count);
	});
}


function onSearch(self, err, res, count) {
	errors.ldapErrHandler(self.log, err);

	var log = self.log;
	var entries = [];

	function onSearchEntry(entry) {
		log.debug('Search entry',
					entry.object.targetdn,
	    			entry.object.changenumber, entry.object.changetype);

		var targetdn = ldap.parseDN(entry.object.targetdn);
		var changes = JSON.parse(entry.object.changes);
		entry.parsedChanges = changes;

		// add change types have the object in the changes attribute
		// modifies have it in the entry
		if (entry.object.entry) {
			entry.parsedEntry = JSON.parse(entry.object.entry);
		}

		// Replicate if:
		// - Parent DN
		// - The root DN itself
		// - Children of the DN
		// - Filter matches replication URL
		if (self.canReplicate(targetdn, entry)) {
			log.info('targetdn match for replication', targetdn.toString());
			entries.push(entry);
		}
	}

	function onSearchEnd(res) {
		if (entries.length === 0) {
			log.info('No new entries');
			self.currPolling = false;
		}

		entries.sort(sort);
		entries.forEach(function(entry, index) {
			try {
		  		entry.self = self;
		  		self.queue.push(entry);
			} catch (e) {
		  		log.error({ err: err });
		  		throw e;
			}

			if (index === entries.length - 1) {
				log.info('Finished search for changenumber %s', self.changenumber);
		  		self.currPolling = false;
			}
		});
	}

	res.on('searchEntry', onSearchEntry);
	res.on('end', onSearchEnd);

	res.on('err', function(err) {
		errors.ldapErrHandler(self.log, err);
	});
}

function sort(a, b) {
	a = parseInt(a.object.changenumber, 10);
	b = parseInt(b.object.changenumber, 10);

	return a - b;
}

