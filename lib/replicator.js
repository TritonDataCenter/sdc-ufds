/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * A brief overview of this source file: what is its purpose.
 */

module.exports = Replicator;

var assert = require('assert-plus');
var EventEmitter = require('events').EventEmitter;
var ldap = require('ldapjs');
var util = require('util');

var Instance = require('./instance');
var errors = require('./errors');



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
  	assert.arrayOfObject(options.remotes, 'options.remotes');

    EventEmitter.call(this);

  	/**
  	 * Bunyan Logger
  	 */
  	this.log = options.log;

	/**
	 * Default connection variables. See instance.js
	 */
	this.pollInterval = options.pollInterval || 1000;
	this.queueSize = options.queueSize || 50;
	this.checkpointDn = options.checkpointDn || '';

	/**
	 * Local UFDS client
	 */
	this.localUfdsCfg = options.localUfds;
	this.localUfdsCfg.log = this.log;

	/**
	 * Remote UFDS clients
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
	this.remoteCfgs = options.remotes;

	/**
	 * Initialization chain
	 */
	this.chain = [
		this.initLocal,
		this.initRemotes
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

	this.localUfds = ldap.createClient(this.localUfdsCfg);

	this.localUfds.on('error', function(err) {
		log.fatal({ err: err }, 'Local UFDS client error');
		process.exit(1);
	});

	var dn = this.localUfdsCfg.bindDN;
	var pw = this.localUfdsCfg.bindCredentials;

	this.localUfds.bind(dn, pw, function(err) {
	  	if (err) {
    		log.fatal({ err: err }, 'Unable to bind to Local UFDS');
    		process.exit(1);
	  	}

	  	log.info('Local UFDS client bound!');
	  	return next();
	});
};



Replicator.prototype.initRemotes = function(next) {
	var self = this;
	var log = self.log;
	this.remotes = [];

	var clientsBound = 0;
	var totalClients = this.remoteCfgs.length;

	function defaultConfig() {
		return {
			pollInterval: self.pollInterval,
			queueSize: self.queueSize,
			checkpointDn: self.checkpointDn,
			log: log
		}
	}

	for (var i = 0; i < totalClients; i++) {
		var config = defaultConfig();
		config.id = i;
		config.remoteCfg = this.remoteCfgs[i];
		config.localUfds = this.localUfds;

		var remote = new Instance(config);
		remote.init(onInit);
		self.remotes.push(remote);

		function onInit(err) {
			errors.ldapErrHandler(self.log, err);

			clientsBound++;

			if (totalClients == clientsBound) {
    			self.emit('started');
				return next();
			}
		}

		remote.on('caughtup', function (id, changenumber) {
			self.emit('caughtup', id, changenumber);
		});
	}
};



Replicator.prototype.stop = function() {
	var self = this;

	// 1 client + n remotes
	var clientsStopped = 0;
	var totalClients = this.remoteCfgs.length + 1;

	for (var i = 0; i < this.remoteCfgs.length; i++) {
		this.remotes[i].stop(function() {
			clientsStopped++;

			if (clientsStopped == totalClients) {
        		self.emit('stopped');
			}
		});
	}

	this.localUfds.unbind(function () {
		clientsStopped++;

		if (clientsStopped == totalClients) {
    		self.emit('stopped');
		}
	});
};


