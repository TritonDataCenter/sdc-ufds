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
var vasync = require('vasync');
var async = require('async');
var backoff = require('backoff');

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
	 * Retry options for connecting to each remote
	 */
    this.retry = options.retry || {};

	/**
	 * Initialization chain
	 */
	this.chain = [
		this.initLocal,
		this.initRemotes
	];
}

util.inherits(Replicator, EventEmitter);



/*
 * Initializes the execution of the replicator. Will call each method listed in
 * the this.chain array in order
 */
Replicator.prototype.init = function() {
	var self = this;
    var log = this.log;
    var retryOpts = this.retry;
    var retryBackoff;
	var i = -1;

	// We retry-backoff a connection to each of the remotes (plus the local
	// UFDS instance). After all of them are completed we can emit
	function next() {
		i++;

		if (self.chain[i]) {
			retryBackoff = backoff.call(self.chain[i].bind(self), {},
			function (err) {
				retryBackoff.removeAllListeners('backoff');

				// Emit error if you specified a max number of attempts
				// otherwise keep trying
				if (err) {
					log.error(err, 'could not connect after %d attempts',
					retryBackoff.getResults().length);
					self.emit('error', err);
				} else {
					log.debug('connected after %d attempts',
					retryBackoff.getResults().length);
					next();
				}
			});


            retryBackoff.setStrategy(new backoff.ExponentialStrategy({
                initialDelay: retryOpts.minTimeout || 100,
                maxDelay: retryOpts.maxTimeout || 60000
            }));

            retryBackoff.failAfter(retryOpts.retries || Infinity);
            retryBackoff.on('backoff', function onBackoff(number, delay) {
                var level;
                if (number === 0) {
                    level = 'info';
                } else if (number < 5) {
                    level = 'warn';
                } else {
                    level = 'error';
                }
                log[level]({
                    attempt: number,
                    delay: delay
                }, 'connect attempted');
            });

            retryBackoff.start();
		}
	}

	return next();
};



/*
 * Initializes a connection to the local UFDS instance
 */
Replicator.prototype.initLocal = function(_, cb) {
	var self = this;
	var log = self.log;

	this.localUfds = ldap.createClient(this.localUfdsCfg);

	this.localUfds.on('error', function(err) {
		log.fatal(err, 'Local UFDS client error');
		return cb(err);
	});

	var dn = this.localUfdsCfg.bindDN;
	var pw = this.localUfdsCfg.bindCredentials;

	this.localUfds.bind(dn, pw, function(err) {
		if (err) {
			log.fatal(err, 'Unable to bind to Local UFDS');
			return cb(err);
		}

		log.info('Local UFDS client bound!');
		return cb();
	});
};



/*
 * Initializes a connection to each of the remote UFDS instances. This function
 * will emit a 'started' event only when all of the remotes have successfully
 * bound to their correspondent servers
 */
Replicator.prototype.initRemotes = function(_, cb) {
	var self = this;
	var log = self.log;
	this.remotes = [];

	function defaultConfig() {
		return {
			pollInterval: self.pollInterval,
			queueSize: self.queueSize,
			checkpointDn: self.checkpointDn,
			log: log
		};
	}

    var clientId = 0;

    async.mapSeries(self.remoteCfgs, function (remoteCfg, nextIter) {

        var config = defaultConfig();
        config.id = clientId;
        config.remoteCfg = remoteCfg;
        config.localUfds = self.localUfds;

        var remote = new Instance(config);
        remote.init(onInit);
        self.remotes.push(remote);

        function onInit(err) {
            if (err) {
                return nextIter(err);
            } else {
                clientId++;
                return nextIter();
            }
        }

        remote.on('caughtup', function (id, changenumber) {
            self.emit('caughtup', id, changenumber);
        });


    }, function (err) {
        if (err) {
            return cb(err);
        } else {
            self.emit('started');
            return cb();
        }
    });
};



/*
 * Calls stop on each of the remote instances and emits 'stopped' when they all
 * have been unbound to their servers
 */
Replicator.prototype.stop = function() {
	var self = this;

	async.mapSeries(self.remotes, function (remote, nextIter) {

		remote.stop(function() {
			return nextIter();
		});

    }, function (err) {

        errors.ldapErrHandler(self.log, err);
		self.localUfds.unbind(function () {
			self.emit('stopped');
		});

    });
};


