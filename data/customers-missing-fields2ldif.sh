#!/usr/bin/env node
// -*- mode: js -*-
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var fs = require('fs');
var path = require('path');

var directory;
var admin_uuid;

var blacklist_email = {};
var email_addrs = {};
var CustomerIdMap = {};
var cust_uuids = {};
var cust_logins = {};
///--- Helpers

function err_and_exit() {
    console.error.apply(arguments);
    process.exit(1);
}

function usage(msg, code) {
    if (typeof(msg) === 'string') {
        console.error(msg);
    }

    console.error('%s <directory> <admin uuid>', path.basename(process.argv[1]));
    process.exit(code || 0);
}


function process_argv() {
    if (process.argv.length < 4) {
        usage(null, 1);
    }

    try {
        var stats = fs.statSync(process.argv[2]);
        if (!stats.isDirectory()) {
            usage(process.argv[2] + ' is not a directory', 1);
        }
    } catch (e) {
        usage(process.argv[2] + ' is invalid: ' + e.toString(), 1);
    }

    directory = process.argv[2];
    admin_uuid = process.argv[3];
}


function read_lines(file, callback) {
    return fs.readFile(file, 'utf8', function (err, data) {
        if (err) {
            return callback(err);
        }

        return callback(null, data.split('\n'));
  });
}


function transform_blacklist(file, callback) {
    return read_lines(file, function (err, lines) {
        if (err) {
            return err_and_exit('Error loading keys file: %s', err.toString());
        }

        var change = {
            dn: 'cn=blacklist, o=smartdc',
            email: [],
            objectclass: 'emailblacklist'
        };

        lines.forEach(function (line) {
            var pieces = line.split('\t');
            if (pieces.length < 2) {
                return;
            }

            change.email.push(pieces[1]);
            blacklist_email[pieces[1]] = 1;
        });

        return callback(change.email.length ? [change] : []);
  });
}


function transform_customers_upgrade(file, callback) {
    return read_lines(file, function (err, lines) {
        if (err) {
            return err_and_exit('Error loading customers file: %s', err.toString());
        }

        var changes = [];
        lines.forEach(function (line) {
            var pieces = line.split('\t');
            if (pieces.length < 26) {
                return;
            }

            if (pieces[26] !== '\\N') {
                return console.error('%s was a deleted user, skipping.', pieces[6]);
            }

            // skip customers with blacklisted email addresses
            if (pieces[13] in blacklist_email) {
                console.error('%s was a blacklisted user, skipping', pieces[6]);
                return;
            }

            var uuid = pieces[5];
            CustomerIdMap[pieces[4]] = uuid;

            // duplicate uuids is a fatal error
            if (uuid in cust_uuids) {
                return err_and_exit('ERROR: %s duplicate uuid', uuid);
            }
            cust_uuids[uuid] = 1;

            // duplicate login is a fatal error
            if (pieces[6] in cust_logins) {
                return err_and_exit('ERROR: %s duplicate login', pieces[6]);
            }
            cust_logins[pieces[6]] = 1;

            var eaddr;
            // handle duplicate email addresses
            if (pieces[13] in email_addrs) {
                
                var ecomp = pieces[13].split('@');
                if (ecomp.length !== 2) {
                    return console.error('%s invalid email address, skipping',
                            pieces[13]);
                }
                eaddr = ecomp[0] + '+' + pieces[6] + '@' + ecomp[1];
                console.error('%s duplicate email, new addr %s', pieces[13], eaddr);
            } else {
                eaddr = pieces[13];
            }
            email_addrs[eaddr] = 1;

            console.log('dn: uuid=' + uuid + ', ou=users, o=smartdc');
            console.log('changetype: modify');
            console.log('add: approved_for_provisioning');
            console.error('"' + pieces[12] + '"');
            var d = Date.now();
            var approved_for_provisioning = (pieces[12] !== 't') ? 'false' : 'true';
            console.log('approved_for_provisioning: ' + approved_for_provisioning);
            console.log('-');
            console.log('add: created_at');
            var created_at =  (pieces[24] === '\\N') ? d : new Date(pieces[24]).getTime();
            console.log('created_at: ' + created_at);
            console.log('-');
            console.log('add: updated_at');
            var updated_at =  (pieces[24] === '\\N') ? d : new Date(pieces[25]).getTime();
            console.log('updated_at: ' + updated_at);
            console.log();
        });
        return callback(changes);
    });
}


///--- Mainline

process_argv();

fs.readdir(directory, function (err, files) {
    if (err) {
        return err_and_exit('Unable to read %s: %s', directory, err.toString());
    }

    console.log('version: 1\n');
    function callback(changes) {
        return;
    }

    // Load blacklist first, so we can find out which customers to skip
    transform_blacklist(directory + '/blacklists.dump', function (changes) {
        callback(changes); // print these out

        // Load customers second, so we can map id -> uuid
        transform_customers_upgrade(directory + '/customers.dump', function (changes) {
            callback(changes); // Still print these out
        });
    });
});
