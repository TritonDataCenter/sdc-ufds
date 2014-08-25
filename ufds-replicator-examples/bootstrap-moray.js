/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */


var execFile = require('child_process').execFile;
var child;

var ldapUrl = process.LOCAL_UFDS_URL || 'ldap://127.0.0.1:1389';
var dataFile = process.DATA_FILE || 'data/bootstrap.ldif';

var execArgs = [
	'-H', ldapUrl,
	'-x',
	'-D', 'cn=root',
	'-w', 'secret',
	'-f', dataFile
];

var execEnv = {
	env: { 'LDAPTLS_REQCERT': 'allow' },
	cwd: process.cwd()
};

child = execFile('ldapadd', execArgs, execEnv, onExec);

function onExec(error, stdout, stderr) {
	if (stdout) {
		console.log('ldapp stdout:\n' + stdout);
	}

	if (stderr) {
        console.log('ldapadd stderr:\n' + stderr);
    }

    if (error !== null) {
      console.log('ldapadd exec error:\n' + error);
    }
}
