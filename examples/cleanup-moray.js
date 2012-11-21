/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * A brief overview of this source file: what is its purpose.
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
    host: process.env.MORAY_IP || '10.99.99.13',
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

