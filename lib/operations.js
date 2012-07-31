/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * A brief overview of this source file: what is its purpose.
 */


module.exports = {
	add: add,
	modify: modify,
	del: del
};


function add(replicator, entry, callback) {
	var log = replicator.log;
	var ufds = replicator.localUfds;

	// TODO: targetdn needs to take replication suffix into account
	var targetdn = entry.object.targetdn;
	var theEntry = entry.parsedChanges;

	ufds.add(targetdn, theEntry, function (err, res) {
		// Ignore existing entries?
		if (err && err.name != 'EntryAlreadyExistsError') {
			log.fatal('Could not add entry %s', targetdn, theEntry);
			return callback(err);
		}

		log.debug('Entry replicatead %s', targetdn, theEntry);
		return callback();
	});
}

function modify(replicator, entry) {
	return callback();
}

function del(replicator, entry) {
	return callback();
}
