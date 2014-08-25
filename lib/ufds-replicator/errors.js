/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */


/*
 * Logs the error and stops execution of the current process\
 */
function ldapErrHandler(log, err) {
    if (err) {
        log.fatal(err, 'Unexpected error occurred');
    }
}


exports.ldapErrHandler = ldapErrHandler;
