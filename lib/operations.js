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



/**
 * If a local entry already exists we ignore it
 */
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



/**
 * There are 5 scenarios:
 *
 * - Both modified and unmodified entries match the filter.
 * - Neither entry matches the filter.
 * - The modified entry doesn't match the filter, but the unmodified entry does.
 * - The modified entry matches the filter, but the unmodified entry does not.
 * - The entry does not exist locally, but the remote modified entry matches the filter.
 */
function modify(replicator, entry, callback) {
	return callback();
}



/**
 * There are 3 scenarios:
 *
 * - The entry exists locally and matches the replication filter.
 * - The entry doesn't exist locally.
 * - The entry exists locally and doesn't match the replication filter.
 */
function del(replicator, entry, callback) {
	return callback();
}
