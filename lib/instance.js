/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * A brief overview of this source file: what is its purpose.
 */

module.exports = Instance;

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
 * Instance constructor
 *
 * Required
 * - localUfds
 * - remoteUfds
 * - replicationSuffix
 * - checkpointDn
 * - log
 * - pollInterval
 */
function Instance(options) {
	assert.object(options, 'options');
  	assert.object(options.log, 'options.log');
  	assert.object(options.localUfds, 'options.localUfds');
  	assert.object(options.remoteCfg, 'options.remoteCfg');
  	assert.number(options.pollInterval, 'options.pollInterval');
  	assert.number(options.queueSize, 'options.queueSize');

    EventEmitter.call(this);

    /**
     * Client Identifier
     */
    this.id = options.id;

  	/**
  	 * Bunyan Logger
  	 */
  	this.log = options.log;

	/**
	 * The interval to poll UFDS
	 */
	this.pollInterval = options.pollInterval;

	/**
	 * Indicates whether we are already polling UFDS
	 */
	this.currPolling = false;

	/**
	 * Indicates if we are seeing new changelog entries at the moment. When
	 * the upstream UFDS returns changelogs we will be catching up until the
	 * queue is drained and we don't get more changelogs in the next iteration
	 */
	this.caughtUp = false;

	/**
	 * There is a bug with res.sentEntries at the moment
	 */
	this.sentEntries = 0;


	/**
	 * The serial entry queue, ensure entries are processed serially.
	 */
	this.queue = vasync.queue(handleEntry, 1);

	/**
	 * Maximum number of entries to process per interval
	 */
	this.queueSize = options.queueSize;

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
	// this.replicationSuffix = options.replicationSuffix || '';

	/**
	 * Checkpoint DN
	 */
	this.checkpoint = null;
	this.checkpointDn = options.checkpointDn;

	/**
	 * Local UFDS client
	 */
	this.localUfds = options.localUfds;

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
	this.remoteCfg = options.remoteCfg;
	this.remoteUfds = null;
}

util.inherits(Instance, EventEmitter);



/*
 * Initializes the checkpoint for this instance. The checkpoints gets saved in
 * a specific tree and its uid will be calcualted based on the url and the
 * replication queries so two checkpoints are the same only if they are about
 * replication profile
 */
Instance.prototype.initCheckpoint = function(cb) {
	var self = this;
	var log = this.log;

	var chkOps = {
		ufds: this.localUfds,
		url: this.remoteCfg.url,
		queries: this.remoteCfg.queries,
		dn: this.checkpointDn
	};

	this.checkpoint = new Checkpoint(chkOps);
	this.checkpoint.init(onCheckpoint);

	function onCheckpoint(err, changenumber) {
	  	if (err) {
    		log.fatal('[%d] Unable to initialize checkpoint', self.id);
    		return cb(err);
	  	}

    	self.log.debug('Checkpoint initialized');
    	self.changenumber = changenumber;
    	self.searchnumber = changenumber;

	  	log.info('[%d] UFDS client bound!', self.id);
		self.timer = setInterval(tryPoll, self.pollInterval, self);
		tryPoll(self);

		return cb();
	}
};



/*
 * Entry point for initializing the replicator. After creating a new replicator
 * instance you just need to call this method while providing a cb(err) function
 * callback. initCheckpoint gets called if the connection to the remote client
 * was successful
 */
Instance.prototype.init = function(cb) {
	var self = this;
	var log = self.log;

	this.parseReplicationQueries();
	this.setupQueue();

	self.remoteUfds = ldap.createClient(self.remoteCfg);

	self.remoteUfds.on('error', function(err) {
		return cb(err);
	});

	var dn = self.remoteCfg.bindDN;
	var pw = self.remoteCfg.bindCredentials;

	self.remoteUfds.bind(dn, pw, function(err) {
	  	if (err) {
    		log.fatal('[%d] Unable to bind to UFDS', self.id);
    		return cb(err);
	  	}

        return self.initCheckpoint(cb);
	});
};



/*
 * Specific setup for the serial vasync queue. For now we just define the
 * function to be called when the queue is drained. It's very important since
 * this is where we make the jump to the last searchnumber
 */
Instance.prototype.setupQueue = function() {
	var self = this;

	// If we are not processing the queue we can continue with the search
	this.queue.drain = onDrain;

	function onDrain() {
		self.searchnumber = self.searchnumber + 1;

    	updateChangenumber(self, self.searchnumber, function() {
			self.currPolling = false;
			self.log.debug('[%d] Drained processing queue', self.id);
			self.log.debug('[%d] Updated changenumber to %s', self.id, self.changenumber);
	    });
	}
}



/*
 * Each instance can replicate data from one or more subtrees. A replication
 * is the query fragment of an LDAP replication URL. When these queries are
 * provided in the config, they need to be parsed for correctness and set some
 * default values when they are not present, such as default filter to be
 * (objectclass=*)
 */
Instance.prototype.parseReplicationQueries = function() {
	this.queries = [];

	assert.arrayOfString(this.remoteCfg.queries, 'remoteCfg.queries');

	for (var i = 0; i < this.remoteCfg.queries.length; i++) {
		var query = this.remoteCfg.queries[i];
		var url = this.remoteCfg.url + query;

		var replicationUrl = ldap.parseURL(url.replace(/\s/g, '%20'));

		// Be sure to require DN to replicate
		// For now we default the scope to sub and the filter to (objectclass=*)
		assert.string(replicationUrl.DN, 'Replication DN');

		var filter = replicationUrl.filter ||
								ldap.filters.parseString('(objectclass=*)')

		var scope = replicationUrl.scope || 'sub';

		this.queries.push({
			query: query,
			dn: ldap.parseDN(replicationUrl.DN),
			filter: filter,
			scope: scope
		});
	}
};



/*
 * Fail early for replication: If it's an add and the changes don't match the
 * replication filter we return false. For the simple case where the targetdn
 * matches and the changetype is modify or delete we return true for now and
 * properly test if we need to replicate in the handleEntry function since we
 * need to read the local entry and do a couple more things
 */
Instance.prototype.couldReplicate = function(targetdn, entry) {
	var changetype = entry.object.changetype;

	// Does any of our queries match the entry?
	// Return true for the first match, by the time we exit the loop we can
	// return false since none of the queries matches the entry
	for (var i = 0; i < this.queries.length; i++) {
		var query = this.queries[i];

		if (targetdn.childOf(query.dn)) {
			if (changetype == 'modify') {

				// When replication filters have objectclasses in them we can
				// 'fail' early by testing if the objectclass is of our interest
				var objectFilter = { objectclass: entry.parsedEntry.objectclass };
				if (query.filter.matches(objectFilter)) {
					return true;
				}

			// For deletes we can't take a look at the local entry first
			} else if (changetype == 'delete') {
				return true;

			} else if (changetype == 'add') {
				if (query.filter.matches(entry.parsedChanges)) {
					return true;
				}
			}
		}
	}

	return false;
};



/*
 * Stops replicating data from the remote instance. To ensure we wait until
 * pending operations finish executing we only return when unbind has returned
 */
Instance.prototype.stop = function(cb) {
	var self = this;

	if (this.timer)
	    clearInterval(this.timer);

	this.remoteUfds.unbind(function () {
		return cb();
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



/*
 * This funciton gets called by the vasync serial queue. Entries are processed
 * in order. After sucessfully processing an entry we update the current change
 * number in the checkpoint DN.
 */
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



/*
 * Main execution loop
 */
function tryPoll(self) {
	try {
		poll(self);
	} catch (e) {
		self.log.error({ e: e });
		throw e;
	}
}



/*
 * Poll function. This function will return immediately when the serial queue
 * is processing entries, so a bottleneck is avoided every time pollInterval
 * wants to trigger a new search. As long as we are not processing entries
 * we should be able to make new searches on the remote. Note that the search is
 * done with an upper limit (and it is configurable)
 */
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

	log.debug('[%d] Searching %s with opts %j', self.id, CHANGELOG, opts);

	self.remoteUfds.search(CHANGELOG, opts, function (err, res) {
		onSearch(self, err, res);
	});
}



/*
 * On Search callback. Gets executed when the client has received a response
 * from the remote UFDS server. If there is an error in the response we want to
 * stop execution immediately.
 */
function onSearch(self, err, res) {
	errors.ldapErrHandler(self.log, err);

	var log = self.log;
	var entries = [];

	self.sentEntries = 0;


	/*
	 * Inside this function we evaluate if the received entry can be pushed to
	 * the serial queue
	 */
	function onSearchEntry(entry) {
		log.trace('[%d] Search entry', self.id,
					entry.object.targetdn,
	    			entry.object.changenumber, entry.object.changetype);

		// BUG in UFDS. Doing this while it gets fixed
		self.sentEntries++;

		// On first new entry we are again catching up with the upstream UFDS
		if (self.caughtUp)
			self.caughtUp = false;

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
			log.trace('[%d] targetdn match for replication', self.id, targetdn.toString());
			entries.push(entry);
		}
	}


	/*
	 * When a search ends we need to check how many entries need to be pushed
	 * to the queue and if the replicator has caught up with the remote UFDS
	 * changelog.
	 */
	function onSearchEnd(res) {
		// When the search returns nothing we can set currPolling to false
		// since the queue is empty at this point
		if (entries.length === 0) {

			// This is executed when we have hit the last changenumber in the
			// master UFDS changelog, basically there are no more entries
			if (self.changenumber == self.searchnumber &&
				self.sentEntries == 0) {
				log.debug('[%d] No new changelog entries', self.id);

				if (self.currPolling)
					self.currPolling = false;

				if (!self.caughtUp) {
					self.caughtUp = true;
					self.emit('caughtup', self.id, self.changenumber);
				}

			// This is executed when a full queueSize didn't return any match
			// for us, so self.searchnumber > self.changenumber
			} else {
				self.searchnumber = self.searchnumber + 1;

		    	updateChangenumber(self, self.searchnumber, function() {
					self.currPolling = false;
					log.debug('[%d] No replication matches on this range', self.id);
					log.debug('[%d] Updated changenumber to %s', self.id, self.changenumber);
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
				log.info('[%d] Finished search up to changenumber %s',
					self.id, self.searchnumber);
			}
		});
	}

	res.on('searchEntry', onSearchEntry);
	res.on('end', onSearchEnd);

	res.on('error', function(err) {
		errors.ldapErrHandler(self.log, err);
	});
}



/*
 * Sorts an array by changenumber of an entry
 */
function sort(a, b) {
	a = parseInt(a.object.changenumber, 10);
	b = parseInt(b.object.changenumber, 10);

	return a - b;
}

