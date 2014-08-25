/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var bunyan = require('bunyan');
var moray = require('moray');

var LOG = bunyan.createLogger({
	name: 'moray',
	level: 'info',
	stream: process.stdout,
	serializers: bunyan.stdSerializers
});

var client = moray.createClient({
    host: process.env.MORAY_IP || '10.99.99.17',
    port: 2020,
    log: LOG
});

client.on('error', function (err) {
	LOG.error(err);
	process.exit(1);
});


client.on('connect', function () {
	deleteChangelogBucket();
});


function deleteChangelogBucket() {
    client.delBucket('ufds_cn_changelog_two', function (err) {
        if (err) {
			LOG.error(err);
			process.exit(1);
        }

        deleteTreeBucket();
	});
}


function deleteTreeBucket() {
    client.delBucket('ufds_o_smartdc_two', function (err) {
        if (err) {
			LOG.error(err);
			process.exit(1);
        }

        LOG.info('Buckets deleted. Thanks.');
        process.exit(0);
	});
}

