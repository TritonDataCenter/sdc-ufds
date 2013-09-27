/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * A brief overview of this source file: what is its purpose.
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
