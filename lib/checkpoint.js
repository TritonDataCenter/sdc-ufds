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
  	assert.object(options.ufds, 'options.ufds');
  	assert.string(options.replicationUrl, 'options.replicationUrl');

  	EventEmitter.call(this);

	/**
	* The local UFDS client
	*/
	this.ufds = options.ufds;
	this.log = this.ufds.log;

	/**
	* The remote UFDS replication URL
	*/
	this.replicationUrl = options.replicationUrl;

	/**
	 * Initializes the checkpoint DN
	 */
	this.initCheckpointDn(options);
}

util.inherits(Checkpoint, EventEmitter);



/**
 * Initializes a new checkpoint entry
 */
Checkpoint.prototype.newEntry = function(changenumber) {
	var entry = {
		objectclass: 'sdcreplcheckpoint',
		changenumber: changenumber || 0,
		uid: this.urlHash,
		url: this.replicationUrl
	};

	return entry;
};



/**
 * Initializes the DN of the checkpoint. By default it has the following format
 *   uid = md5(url)
 *
 * Another DN can be used if needed
 */
Checkpoint.prototype.initCheckpointDn = function(options) {
	this.urlHash = crypto.createHash('md5')
	 	  			 	 .update(this.replicationUrl)
	 					 .digest('hex');

	if (options.dn == '') {
		this.dn = 'uid=' + this.urlHash;
	} else {
		this.dn = 'uid=' + this.urlHash + ', ' + options.dn;
	}
};



/**
 * Initializes the checkpoint object, and sets the checkpoint to 0 if no
 * checkpoint exists. Emits an init event once the checkpoint has been initialized
 */
Checkpoint.prototype.init = function(options) {
	var self = this;

	this.log.debug('Initializing checkpoint %s for url %s',
					this.dn,
					this.replicationUrl);

	this.get(function (changenumber) {
	  	self.emit('init', changenumber);
	});
};



/**
 * Gets the current checkpoint
 * @param {function} callback : function(changenumber).
 */
Checkpoint.prototype.get = function get(callback) {
	assert.func(callback, 'callback');

  	var self = this;
  	var ufds = this.ufds;

    ufds.search(this.dn, SEARCH_OPTIONS, onCheckpoint);

	function onCheckpoint(err, res) {
      	if (err) {
        	self.log.fatal('Unable to fetch checkpoint');
        	process.exit(1);
      	}

      	res.on('searchEntry', function(entry) {
        	var changenumber = entry.object.changenumber;
        	self.log.debug('Got changenumber %s', changenumber);

        	changenumber = parseInt(changenumber, 10);
        	return callback(changenumber);
      	});

      	res.on('error', function(err) {
        	if (err.code === ldapjs.LDAP_NO_SUCH_OBJECT) {
          		self.log.debug('No checkpoint, initializing to 0');

          		var entry = self.newEntry();

          		ufds.add(self.dn, entry, function(err, res) {
	            	if (err) {
	              		self.log.fatal('Unable to init checkpoint %s', err);
	              		process.exit(1);
	            	}
	            	return callback(0);
          		});
	        } else {
				self.log.fatal('Unable to fetch checkpoint %s', err);
          		process.exit(1);
			}
		});
    }
};

/**
 * Sets the current checkpoint
 * @param {int} changenumber : the changnumber to set the checkpoint to.
 * @param {function} callback : function(err, res).
 */
// Checkpoint.prototype.set = function set(changenumber, callback) {
//   var self = this;
//   self.log.debug('setting changenumber %s for dn %s', changenumber, this.dn);
//   // Assume the dn has been initialized, so modify the entry

//   var change = new ldapjs.Change({
//     type: 'replace',
//     modification: new ldapjs.Attribute({
//       type: 'value',
//       vals: changenumber
//     })
//   });

//   this.pool.acquire(function(err, client) {
//     if (err) {
//       self.log.fatal('unable to set checkpoint %s to changenumber %s',
//                      self.dn, changenumber, err);
//       process.exit(1);
//     }
//     client.modify(self.dn, change, function(err, res) {
//       if (err) {
//         self.log.fatal('unable to set checkpoint %s to changenumber %s',
//                        self.dn, changenumber, err);
//         process.exit(1);
//       }

//       self.log.debug('set checkpoint %s to %s', self.dn, changenumber);
//       self.pool.release(client);
//       return callback(err, res);
//     });
//   });
// };