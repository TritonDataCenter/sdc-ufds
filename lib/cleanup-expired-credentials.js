/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2025 Edgecast Cloud LLC.
 */

/*
 * Cleanup job for expired temporary credentials
 */

var assert = require('assert-plus');
var vasync = require('vasync');

function cleanupExpiredCredentials(ufdsClient, log, callback) {
    assert.object(ufdsClient, 'ufdsClient');
    assert.object(log, 'log');
    assert.func(callback, 'callback');

    var now = new Date().toISOString();
    
    // LDAP search for expired temporary credentials
    var filter = '(&(objectclass=accesskey)(credentialtype=temporary)(expiration<=' + now + '))';
    var opts = {
        scope: 'sub',
        filter: filter,
        attributes: ['dn', 'accesskeyid', 'expiration']
    };
    
    log.debug({filter: filter}, 'Searching for expired temporary credentials');
    
    ufdsClient.search('o=smartdc', opts, function(err, entries) {
        if (err) {
            log.error(err, 'Failed to search for expired credentials');
            return callback(err);
        }
        
        if (!entries || entries.length === 0) {
            log.debug('No expired temporary credentials found');
            return callback();
        }
        
        log.info({count: entries.length}, 'Found expired temporary credentials to delete');
        
        // Delete expired entries
        vasync.forEachParallel({
            func: function deleteExpired(entry, cb) {
                log.info({
                    dn: entry.dn,
                    accesskeyid: entry.accesskeyid,
                    expiration: entry.expiration
                }, 'Deleting expired temporary credential');
                
                ufdsClient.del(entry.dn, function(delErr) {
                    if (delErr) {
                        log.error({err: delErr, dn: entry.dn}, 
                                 'Failed to delete expired credential');
                    }
                    cb(delErr);
                });
            },
            inputs: entries
        }, function(deleteErr, results) {
            if (deleteErr) {
                log.error(deleteErr, 'Some credential deletions failed');
            } else {
                log.info({deleted: entries.length}, 
                        'Successfully deleted expired credentials');
            }
            callback(deleteErr);
        });
    });
}

function startCleanupInterval(ufdsClient, log, intervalMs) {
    intervalMs = intervalMs || 5 * 60 * 1000; // Default 5 minutes
    
    log.info({intervalMs: intervalMs}, 'Starting credential cleanup interval');
    
    function runCleanup() {
        cleanupExpiredCredentials(ufdsClient, log, function(err) {
            if (err) {
                log.error(err, 'Credential cleanup failed');
            }
        });
    }
    
    // Run immediately, then on interval
    runCleanup();
    return setInterval(runCleanup, intervalMs);
}

module.exports = {
    cleanupExpiredCredentials: cleanupExpiredCredentials,
    startCleanupInterval: startCleanupInterval
};