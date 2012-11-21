/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * A brief overview of this source file: what is its purpose.
 */

var path = require('path');
var fs = require('fs');

var nopt = require('nopt');
var bunyan = require('bunyan');

var Replicator = require('../lib/index');


var LOG = bunyan.createLogger({
	name: 'ufds-replicator',
    stream: process.stdout,
    serializers: bunyan.stdSerializers
});


var OPTS = {
    'file': String,
    'help': Boolean
};


var SHORT_OPTS = {
    'f': ['--file'],
    'h': ['--help']
};


function usage(code, message) {
    var _opts = '', msg;
    Object.keys(SHORT_OPTS).forEach(function (k) {
        var longOpt = SHORT_OPTS[k][0].replace('--', ''),
            type = OPTS[longOpt].name || 'string';

        if (type && type === 'boolean') {
            type = '';
        }
        type = type.toLowerCase();

        _opts += ' [--' + longOpt + ' ' + type + ']';
    });

    msg = (message ? message + '\n' : '') +
        'usage: ' + path.basename(process.argv[1]) + _opts;

    console.error(msg);
    process.exit(code);
}


function errorAndExit(err, message) {
    LOG.fatal({err: err}, message);
    process.exit(1);
}


function processConfig() {
    var _config,
        parsed = nopt(OPTS, SHORT_OPTS, process.argv, 2),
        file = parsed.file || __dirname + '/config.sdc.json';

    if (parsed.help) {
        usage(0);
    }

    LOG.info({file: file}, 'Processing configuration file');

    try {
        _config = JSON.parse(fs.readFileSync(file, 'utf8'));

    } catch (e) {
        console.error('Unable to parse configuration file: ' + e.message);
        process.exit(1);
    }

    LOG.level(_config.logLevel || 'debug');

    LOG.debug('config processed: %j', _config);
    _config.log = LOG;
    return _config;
}


function main() {
    var config = processConfig();
	var rep;

	rep = new Replicator(config);
	rep.init();


	rep.once('started', function () {
        LOG.info('Replicator has started!');
	});


	rep.on('caughtup', function (id, cn) {
		LOG.info('Replicator %d has caught up with UFDS at changenumber %s', id, cn);
	});


	rep.once('stopped', function () {
		LOG.info('Replicator has stopped!');
		process.exit(0);
	});


	process.on('SIGINT', function () {
		rep.stop();
	});
}

process.on('uncaughtException', function (err) {
    console.log('UncaughtException happened.');
    LOG.fatal({err: err}, 'uncaughtException');
});

main();
