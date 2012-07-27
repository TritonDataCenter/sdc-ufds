/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * A brief overview of this source file: what is its purpose.
 */


function ldapErrHandler(log, err) {
	if (err) {
		log.fatal({ err: err });
		process.exit(err);
	}
}


exports.ldapErrHandler = ldapErrHandler;