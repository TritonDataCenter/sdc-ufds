/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 */

module.exports = Checkpoint;

var assert = require('assert-plus');
var EventEmitter = require('events').EventEmitter;
var ldapjs = require('ldapjs');
var util = require('util');
var crypto = require('crypto');
var sprintf = require('util').format;

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
	 * The search DN
	 */
	if (options.dn === '') {
        this.srch_dn = 'o=smartdc';
	} else {
        this.srch_dn = options.dn;
	}
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
 * The uid and query properties are no longer used but they are required in
 * the schema so we continue to provide values for compatibility.
 */
Checkpoint.prototype.newEntry = function(uid) {
	var entry = {
		objectclass: 'sdcreplcheckpoint',
		changenumber: 0,
		uid: uid,
		url: this.url,
		query: this.queries
	};

	return entry;
};



/**
 * Initializes the checkpoint object, and sets the checkpoint to 0 if no
 * checkpoint exists.
 */
Checkpoint.prototype.init = function(callback) {
	var self = this;

	this.log.debug('Initializing checkpoint for url %s', this.url);

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
    var srch_opts = {
        scope: 'sub',
        filter: sprintf('(&(objectclass=sdcreplcheckpoint)(url=%s))', this.url)
    };

    ufds.search(this.srch_dn, srch_opts, onCheckpoint);

	function onCheckpoint(err, res) {
        if (err) {
            return callback(err);
        }

        res.on('searchEntry', function(entry) {
            var fnd_dn = entry.object.dn;

            if (self.dn) {
                self.log.debug('Multiple entries for the same url, dn %s',
                    fnd_dn);
                return callback('Error: multiple entries for the same url');
            }

            var changenumber = entry.object.changenumber;
            self.log.debug('Got changenumber %s on dn %s', changenumber,
               fnd_dn);

            self.dn = fnd_dn;
            changenumber = parseInt(changenumber, 10);
            return callback(null, changenumber);
        });

        res.on('end', function() {
            if (!self.dn) {
                var urlHash = crypto.createHash('md5')
                    .update(self.url).digest('hex');
                var entry = self.newEntry(urlHash);

                self.dn = 'uid=' + urlHash + ', ' + self.srch_dn;

                self.log.debug('No checkpoint, initializing dn %s to 0',
                    self.dn);
                ufds.add(self.dn, entry, function(err, res) {
                    if (err) {
                        return callback(err);
                    }

                    return callback(null, 0);
                });
            }
        });

        res.on('error', function(err) {
            self.log.fatal(err, 'Unable to fetch checkpoint');
            return callback(err);
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

