/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * A brief overview of this source file: what is its purpose.
 */

module.exports = Checkpoint;

var assert = require('assert-plus');
var EventEmitter = require('events').EventEmitter;
var ldapjs = require('ldapjs');
var util = require('util');
var crypto = require('crypto');

var SEARCH_OPTIONS = {
	scope: 'base',
	filter: '(objectclass=sdcreplcheckpoint)'
};


/**
 * The checkpoint Object used to store the latest consumed change numbers from
 * the remote url. The checkpoint is stored in LDAP, and represents the last
 * changelog number replicated from the remote LDAP server. Emits an 'init'
 * event when instantiated.
 *
 * Create this object as follows:
 *
 *  var checkpoint = new Checkpoint();
 *  checkpoint.once('init', function(cn) {
 *      console.log('checkpoint has been initialized with changnumber', cn);
 *  })
 *  checkpoint.init();
 *
 */
function Checkpoint(options) {
	assert.object(options, 'options');
    assert.object(options.replicator, 'options.replicator');
    assert.string(options.url, 'options.url');
	assert.arrayOfString(options.queries, 'options.queries');

    EventEmitter.call(this);

	/**
	* The local UFDS client
	*/
	this.replicator = options.replicator;
	this.log = this.replicator.log;

	/**
	* The remote UFDS URL
	*/
	this.url = options.url;

	/**
	* The remote UFDS replication queries
	*/
	this.queries = options.queries;

	/**
	 * Initializes the checkpoint DN
	 */
	this.initCheckpointDn(options);
}

util.inherits(Checkpoint, EventEmitter);



/*
 * Accessor for the localUfds/client instance
 */
Checkpoint.prototype.client = function() {
    return this.replicator && this.replicator.localUfds;
};



/**
 * Initializes a new checkpoint entry
 */
Checkpoint.prototype.newEntry = function(changenumber) {
	var entry = {
		objectclass: 'sdcreplcheckpoint',
		changenumber: changenumber || 0,
		uid: this.urlHash,
		url: this.url,
		query: this.queries
	};

	return entry;
};



/**
 * Initializes the DN of the checkpoint. By default it has the following format
 *   uid = md5(url+queries)
 *
 * Another DN can be used if needed
 */
Checkpoint.prototype.initCheckpointDn = function(options) {
	var replstring = this.url + this.queries.join('');

	this.urlHash = crypto.createHash('md5')
                            .update(replstring)
                            .digest('hex');

	if (options.dn === '') {
		this.dn = 'uid=' + this.urlHash;
	} else {
		this.dn = 'uid=' + this.urlHash + ', ' + options.dn;
	}
};



/**
 * Initializes the checkpoint object, and sets the checkpoint to 0 if no
 * checkpoint exists.
 */
Checkpoint.prototype.init = function(callback) {
	var self = this;

	this.log.debug('Initializing checkpoint %s for url %s',
					this.dn,
					this.url);

	this.get(function (err, changenumber) {
		if (err) {
			return callback(err);
        }

        return callback(null, changenumber);
	});
};



/**
 * Gets the current checkpoint
 * @param {function} callback : function(err, changenumber).
 */
Checkpoint.prototype.get = function get(callback) {
	assert.func(callback, 'callback');

    var self = this;
    var ufds = this.client();

    ufds.search(this.dn, SEARCH_OPTIONS, onCheckpoint);

	function onCheckpoint(err, res) {
        if (err) {
            return callback(err);
        }

        res.on('searchEntry', function(entry) {
            var changenumber = entry.object.changenumber;
            self.log.debug('Got changenumber %s', changenumber);

            changenumber = parseInt(changenumber, 10);
            return callback(null, changenumber);
        });

        res.on('error', function(err) {
            if (err.code === ldapjs.LDAP_NO_SUCH_OBJECT) {
                self.log.debug('No checkpoint, initializing to 0');

                var entry = self.newEntry();

                ufds.add(self.dn, entry, function(err, res) {
                    if (err) {
                        return callback(err);
                    }

                    return callback(null, 0);
                });
            } else {
				self.log.fatal(err, 'Unable to fetch checkpoint');
                return callback(err);
			}
		});
    }
};



/**
 * Sets the current checkpoint
 * @param {int} changenumber : the changnumber to set the checkpoint to.
 * @param {function} callback : function().
 */
Checkpoint.prototype.set = function(changenumber, callback) {
	var self = this;
	var ufds = this.client();

	var change = new ldapjs.Change({
		type: 'replace',
		modification: {
			changenumber: changenumber
		}
	});

	ufds.modify(self.dn, change, function(err, res) {
		if (err) {
			self.log.fatal(err, 'Unable to set checkpoint to changenumber %s',
                changenumber);
			return callback(err);
		}

		self.log.debug('Checkpoint set to %s', changenumber);
		return callback();
	});
};

