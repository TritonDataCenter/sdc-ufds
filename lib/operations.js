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

var ldap = require('ldapjs');


/**
 * Creates a changes object from the parsed array in the changelog object
 */
function changesObject(array) {
	var i;
	var changes = [];

	for (i = 0; i < array.length; i++) {
		var change = new ldap.Change({
			operation: array[i].operation,
            modification: new ldap.Attribute({
                type: array[i].modification.type,
                vals: array[i].modification.vals
            })
        });

        changes.push(change);
	}

    return changes;
}



/**
 * Tests if replication filters match an entry
 */
function matches(replicator, parsedChanges) {

	for (var i = 0; i < replicator.queries.length; i++) {
		var query = replicator.queries[i];

		if (query.filter.matches(parsedChanges)) {
			return true;
		}
	}

	return false;
}



/**
 * Loads the entry from the local UFDS. When entry doesn't exist locally it
 * means that we just need to add it
 */
function getLocalEntry(replicator, entry, callback) {
	var log = replicator.log;
	var ufds = replicator.localUfds;

	var localEntry;
	var opts = { scope: 'base' };
	var targetdn = entry.object.targetdn;

	ufds.search(targetdn, opts, onSearch);

	function onSearch(err, res) {
		if (err) {
			return callback(err);
		}

		res.on('error', onErr);
		res.on('searchEntry', onSearchEntry);
		res.on('end', onSearchEnd);

		function onErr(err) {
            if (err.code === ldap.LDAP_NO_SUCH_OBJECT) {
                return callback();
            }

            log.fatal(err, 'Error searching for local entry');
			return callback(err);
		}

		function onSearchEntry(obj) {
			localEntry = obj;
		}

		function onSearchEnd(res) {
			if (!localEntry) {
				var err = new Error('No local entry but filter matched?');
				return callback(err);
			} else {
				return callback(null, localEntry);
			}
		}
	}
}



/**
 * If a local entry already exists we ignore it
 */
function add(replicator, entry, callback) {
	var log = replicator.log;
	var ufds = replicator.localUfds;

	// TODO: targetdn needs to take replication suffix into account
	var targetdn = entry.object.targetdn;

	// If it's a modify the entry is in parsedEntry
	var theEntry = entry.parsedEntry || entry.parsedChanges;
    // CAPI-243: We need to know when an entry is being replicated at ufds, so
    // we can skip some validations or adding attributes already added by
    // master ufds being replicated.
    theEntry._replicated = ['true'];
	ufds.add(targetdn, theEntry, function (err, res) {
		if (err) {
                    log.fatal(err, 'Could not add entry %s', targetdn, theEntry);
		    // Exit on these errors so svc goes into maintenance
		    if (err.name == 'EntryAlreadyExistsError' ||
		        err.name == 'ConstraintViolationError') {
                            process.exit(1);
		    }
                    return callback(err);
                }

		log.debug('Entry added %s', targetdn);
		return callback();
	});
}



/**
 * There are 5 scenarios:
 *
 * 1. Both modified and unmodified entries match the filter.
 *   - ufds.modify(targetdn, entry.parsedChanges)
 *
 * 2. Neither entry matches the filter.
 *   - ignore
 *
 * 3. The modified entry doesn't match the filter, but the unmodified entry does.
 *   - ufds.del(targetdn)
 *
 * 4. The modified entry matches the filter, but the unmodified entry does not.
 *   - replace, global entry overrides local entry
 *   - ufds.modify(targetdn, entry.parsedChanges)
 *
 * 5. The entry does not exist locally, but the modified entry matches the filter.
 *   - new entry that matches the replication filter
 *   - ufds.add(targetdn, entry.parsedEntry)
 */
function modify(replicator, entry, callback) {
	var log = replicator.log;
	var targetdn = entry.object.targetdn;

	getLocalEntry(replicator, entry, onLocalEntry);

	function onLocalEntry(err, localEntry) {
		if (err) {
			return callback(err);
		}

		var remoteMatch = matches(replicator, entry.parsedEntry);

		if (!localEntry) {
			// Scenario 5
			if (remoteMatch) {
				return add(replicator, entry, callback);
			// No local entry and replication filter doesn't match remote entry
			} else {
				return callback();
			}

		} else {

			var localMatch = matches(replicator, localEntry.object);

			// Scenario 1. Simple modify
			if (localMatch && remoteMatch) {
				log.debug('Local match and remote match for %s', targetdn);
				return modEntry(replicator, entry, callback);

			// Scenario 3. Entry used to match, we need to delete it
			} else if (localMatch && !remoteMatch) {
				log.debug('Local match and no remote match for %s', targetdn);
				return delEntry(replicator, entry, callback);

			// Scenario 4. Local entry doesn't match, remote has been updated
			} else if (!localMatch && remoteMatch) {
				log.debug('No local match and remote match for %s', targetdn);
				return modEntry(replicator, entry, callback);

			// Scenario 2. Skip
			} else {
				return callback();
			}
		}
	}
}



/*
 * Raw LDAP modify operation. Gets called by ops.mod when a targetdn matches
 * replication
 */
function modEntry(replicator, entry, callback) {
	var log = replicator.log;
	var ufds = replicator.localUfds;

	var targetdn = entry.object.targetdn;
	var changes = changesObject(entry.parsedChanges);

	ufds.modify(targetdn, changes, function (err, res) {
		if (err) {
                    log.fatal(err, 'Could not modify entry %s', targetdn,
                        theEntry);
		    // Exit on this error so svc goes into maintenance
		    if (err.name == 'ConstraintViolationError') {
                            process.exit(1);
		    }
                    return callback(err);
		}

		log.debug('Replicated entry modified %s', targetdn, changes);
		return callback();
	});
}



/*
 * Raw LDAP delete operation. Gets called by ops.del when a targetdn matches
 * replication
 */
function delEntry(replicator, entry, callback) {
	var log = replicator.log;
	var ufds = replicator.localUfds;

	var targetdn = entry.object.targetdn;

	ufds.del(targetdn, function (err, res) {
		if (err) {
			if (err.code && (err.code === ldap.LDAP_NOT_ALLOWED_ON_NON_LEAF)) {
				log.error('Local entry %s has child entries and cannot be ' +
					'deleted because of an LDAP_NOT_ALLOWED_ON_NON_LEAF ' +
					'error, ignoring local delete operation', targetdn);
				return callback();
			} else {
				return callback(err);
			}
		}

		log.debug('Replicated entry deleted %s', targetdn);
		return callback();
	});
}



/**
 * There are 3 scenarios:
 *
 * 1. The entry exists locally and matches the replication filter.
 *   - ufds.del(targetdn)
 *
 * 2. The entry doesn't exist locally.
 *   - ignore
 *
 * 3. The entry exists locally and doesn't match the replication filter.
 *   - ignore
 */
function del(replicator, entry, callback) {
	var log = replicator.log;
	var targetdn = entry.object.targetdn;

	getLocalEntry(replicator, entry, onLocalEntry);

	function onLocalEntry(err, localEntry) {
		if (err) {
			return callback(err);
		}

		// Scenario 2. No local entry, why bother
		if (!localEntry) {
			return callback();
		} else {
			var localMatch = matches(replicator, localEntry.object);

			// Scenario 1. Delete
			if (localMatch) {
				log.debug('Local match for deleting %s', targetdn);
				return delEntry(replicator, entry, callback);

			// Scenario 3. Doesn't match replication filter, ignore
			} else {
				return callback();
			}
		}
	}
}
