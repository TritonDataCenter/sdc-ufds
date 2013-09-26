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
var once = require('once');

var Instance = require('./instance');
var errors = require('./errors');

var LDAP_PROXY_EVENTS = [
    'connect',
    'connectTimeout',
    'close',
    'end',
    'error',
    'socketTimeout',
    'timeout'
];

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

	function next() {
		i++;

		if (self.chain[i]) {
            self.chain[i].call(self, function (err) {
                if (err) {
                    self.emit('error', err);
                } else {
                    next();
                }
            });
		}
	}

	return next();
};



/*
 * Initializes a connection to the local UFDS instance
 */
Replicator.prototype.initLocal = function(cb) {
    var self = this;
    cb = once(cb);

    function connect() {
        self.connecting = self.createClient(function (err, client) {
            self.connecting = false;

            if (err) {
                cb(err);
                return;
            }

            if (self.closed && client) {
                client.unbind();
                return;
            }

            function handleClose() {
                if (self.localUfds && !self.connecting && !self.closed) {
                    self.log.warn(err, 'LDAP client disconnected');
                    self.localUfds = null;
                    connect();
                }
            }

            client.once('error', handleClose);
            client.once('close', handleClose);

            self.localUfds = client;
            cb();
        });
    }

    connect();
};


/*
 * Creates a new LDAP client
 */
Replicator.prototype.createClient = function(cb) {
    var self = this;
    var log = self.log;
    cb = once(cb);

    var dn = this.localUfdsCfg.bindDN;
    var pw = this.localUfdsCfg.bindCredentials;

    var retryOpts = this.retry;
    retryOpts.maxDelay = retryOpts.maxDelay || retryOpts.maxTimeout || 30000;
    retryOpts.retries = retryOpts.retries || Infinity;

    function _createClient(_, _cb) {

        var client = ldap.createClient(self.localUfdsCfg);
        client.once('connect', onConnect);
        client.on('error', onError);

        function onConnect() {
            client.removeListener('error', onError);
            log.trace('ldap: connected to local UFDS');

            client.bind(dn, pw, function(err) {
                if (err) {
                    log.error({
                        bindDN: dn,
                        err: err
                    }, 'Local UFDS: invalid credentials; aborting');
                    return _cb(err);
                }

                log.info({
                    bindDN: dn
                }, 'Local UFDS: connected and bound');
                client.socket.setKeepAlive(true);
                return _cb(null, client);
            });
        }

        function onError(err) {
            client.removeListener('connect', onConnect);
            log.fatal(err, 'Local UFDS client error');
            return _cb(err);
        }
    }

    var retry = backoff.call(_createClient, null, cb);
    retry.setStrategy(new backoff.ExponentialStrategy(retryOpts));
    retry.failAfter(retryOpts.retries);

    retry.on('backoff', function (number, delay) {
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
        }, 'ufds: connection attempt failed');
    });

    retry.start();
    return retry;
};




/*
 * Initializes a connection to each of the remote UFDS instances. This function
 * will emit a 'started' event only when all of the remotes have successfully
 * bound to their correspondent servers
 */
Replicator.prototype.initRemotes = function(cb) {
	var self = this;
	var log = self.log;
	this.remotes = [];

	function defaultConfig() {
		return {
            retry: self.retry,
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
        config.replicator = self;

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

    async.mapSeries(self.remotes || [], function (remote, nextIter) {
        remote.stop(function(err) {
            return nextIter(err);
        });
    }, function (err) {
        errors.ldapErrHandler(self.log, err);

        self.closed = true;
        if (!self.localUfds) {
            if (self.connecting) {
                self.connecting.abort();
            }
            return;
        }

        LDAP_PROXY_EVENTS.forEach(function reEmit(event) {
            self.localUfds.removeAllListeners(event);
        });

        self.localUfds.unbind(function (err) {
            if (err) {
                self.log.fatal(err, 'Error trying to unbind from Local');
            } else {
                self.emit('stopped');
            }
        });
    });
};


