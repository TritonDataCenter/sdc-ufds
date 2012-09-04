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
var ops = require('./operations')

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
	 * Maximum number of entries to process per interval
	 */
	this.queueSize = options.queueSize || 49;

	/**
	 * The latest consumed changenumber. This number represents the latest entry
	 * that was actually consumed
	 */
	this.changenumber = 0;

	/**
	 * The latest received search entry changenumber. This number represents the
	 * latest entry that was received in the onSearchEntry callback.
	 */
	this.searchnumber = 0;

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

	// If we are not processing the queue we can continue with the search
	this.queue.drain = function() {
		self.searchnumber = self.searchnumber + 1;

    	updateChangenumber(self, self.searchnumber, function() {
			self.currPolling = false;
			self.log.debug('Drained processing queue');
			self.log.debug('Updated changenumber to %s', self.changenumber);
	    });
	}

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
    	self.searchnumber = changenumber;

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
};



/*
 * Fail early for replication: If it's an add and the changes don't match the
 * replication filter we return false. For the simple case where the targetdn
 * matches and the changetype is modify or delete we return true for now and
 * properly test if we need to replicate in the handleEntry function since we
 * need to read the local entry and do a couple more things
 */
Replicator.prototype.couldReplicate = function(targetdn, entry) {
	var changetype = entry.object.changetype;

	if (targetdn.childOf(this.replicationDN)) {
		if (changetype == 'modify') {
			// When replication filters have objectclasses in them we can 'fail'
			// early by testing if the objectclass is of our interest
			var objectFilter = { objectclass: entry.parsedEntry.objectclass };
			return this.replicationFilter.matches(objectFilter);

		// For deletes we can't take a look at the local entry first
		} else if (changetype == 'delete') {
			return true;

		} else if (changetype == 'add') {
			return this.replicationFilter.matches(entry.parsedChanges);
		}
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



/*
 * Sets a new checkpoint after a matching replication entry has been processed.
 *
 * Note that we don't mess with this.searchnumber here because the processing
 * queue moves slower than the onSearchEntry callback.
 */
function updateChangenumber(self, number, callback) {
	self.changenumber = number;
    self.checkpoint.set(self.changenumber, function(err) {
    	errors.ldapErrHandler(self.log, err);
      	return callback();
    });
}



function handleEntry(entry, callback) {
	var self = entry.self;
	var log = self.log;

	var changetype = entry.object.changetype;

  	switch (changetype) {
    	case 'add':
    		ops.add(self, entry, update);
    		break;
		case 'modify':
			ops.modify(self, entry, update);
			break;
		case 'delete':
			ops.del(self, entry, update);
			break;
    	default:
    		var err = new TypeError('changetype %s not supported for ' +
    								'object %s', changetype, entry.object);
			errors.ldapErrHandler(log, err);
    }

    function update(err) {
    	errors.ldapErrHandler(log, err);
    	var changenumber = parseInt(entry.object.changenumber, 10) + 1;

    	updateChangenumber(self, changenumber, function() {
	      	return callback();
	    });
    }
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
	var max = start + self.queueSize;

	var filter = sprintf('(&(changenumber>=%s)(changenumber<=%s))', start, max);

	var opts = {
		scope: 'sub',
		filter: filter
	};

	log.info('Searching %s with opts %j', CHANGELOG, opts);

	self.remoteUfds.search(CHANGELOG, opts, function (err, res) {
		onSearch(self, err, res);
	});
}


function onSearch(self, err, res) {
	errors.ldapErrHandler(self.log, err);

	var log = self.log;
	var entries = [];

	function onSearchEntry(entry) {
		log.trace('Search entry',
					entry.object.targetdn,
	    			entry.object.changenumber, entry.object.changetype);

		// Sets the current searchnumber
		self.searchnumber = parseInt(entry.object.changenumber, 10);

		var targetdn = ldap.parseDN(entry.object.targetdn);
		var changes = JSON.parse(entry.object.changes);
		entry.parsedChanges = changes;

		// - add changetypes have the object in the changes attribute
		// - modifies have it in the entry
		if (entry.object.entry) {
			entry.parsedEntry = JSON.parse(entry.object.entry);
		}

		// Evaluate for replication if it's children of the DN
		if (self.couldReplicate(targetdn, entry)) {
			log.trace('targetdn match for replication', targetdn.toString());
			entries.push(entry);
		}
	}

	function onSearchEnd(res) {
		// When the search returns nothing we can set currPolling to false
		// since the queue is empty at this point
		if (entries.length === 0) {

			// This is executed when we have hit the last changenumber in the
			// master UFDS changelog, basically there are no more entries
			if (self.changenumber == self.searchnumber) {
				log.debug('No new changelog entries');
				self.currPolling = false;

			// This is executed when a full queueSize didn't return any match
			// for us, so self.searchnumber > self.changenumber
			} else {
				self.searchnumber = self.searchnumber + 1;

		    	updateChangenumber(self, self.searchnumber, function() {
					self.currPolling = false;
					log.debug('No replication matches on this range');
					log.debug('Updated changenumber to %s', self.changenumber);
			    });
			}
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
				log.info('Finished search up to changenumber %s',
					self.searchnumber);
			}
		});
	}

	res.on('searchEntry', onSearchEntry);
	res.on('end', onSearchEnd);

	res.on('error', function(err) {
		errors.ldapErrHandler(self.log, err);
	});
}

function sort(a, b) {
	a = parseInt(a.object.changenumber, 10);
	b = parseInt(b.object.changenumber, 10);

	return a - b;
}

