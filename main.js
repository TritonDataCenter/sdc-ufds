// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var cluster = require('cluster');
var os = require('os');

var Logger = require('bunyan');
var nopt = require('nopt');

// TODO: groups and blacklist

// --- Globals

var LOG = new Logger({
    name: 'ufds',
    stream: process.stdout,
    serializers: {
        err: Logger.stdSerializers.err
    }
});

var OPTS = {
    'certificate': String,
    'debug': Number,
    'file': String,
    'key': String,
    'port': Number,
    'help': Boolean,
    'single': Boolean
};

var SHORT_OPTS = {
    'c': ['--certificate'],
    'd': ['--debug'],
    'f': ['--file'],
    'k': ['--key'],
    'p': ['--port'],
    's': ['--single'],
    'h': ['--help']
};


// --- Helpers

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


function processConfig() {
    var _config,
        parsed = nopt(OPTS, SHORT_OPTS, process.argv, 2),
        file = parsed.file || __dirname + '/etc/ufds.config.json';

    if (parsed.help) {
        usage(0);
    }

    LOG.info({file: file}, 'Processing configuration file');

    try {

        _config = JSON.parse(fs.readFileSync(file, 'utf8'));

        if (_config.certificate && _config.key && !_config.port) {
            _config.port = 636;
        }

        if (!_config.port) {
            _config.port = 389;
        }

    } catch (e) {
        console.error('Unable to parse configuration file: ' + e.message);
        process.exit(1);
    }

    if (parsed.port) {
        _config.port = parsed.port;
    }

    if (parsed.debug) {
        LOG.level(parsed.debug > 1 ? 'trace' : 'debug');
    }

    _config.single = (parsed.single) ? true : false;

    if (parsed.certificate) {
        _config.certificate = parsed.certificate;
    }
    if (parsed.key) {
        _config.key = parsed.key;
    }

    if (_config.certificate) {
        _config.certificate = fs.readFileSync(_config.certificate, 'utf8');
    }
    if (_config.key) {
        _config.key = fs.readFileSync(_config.key, 'utf8');
    }

    LOG.debug('config processed: %j', _config);
    _config.log = LOG;
    return _config;
}


// --- Mainline

var config = processConfig();

// CAPI-169: Clustering intentionally disabled due to race condition on
// ldif bootstrap.
var ufds = require('./lib/ufds').createServer(config);
ufds.on('morayError', ufds.morayConnectCalback);
ufds.init(function () {
    return (true);
});
// Increase/decrease loggers levels using SIGUSR2/SIGUSR1:
var sigyan = require('sigyan');
sigyan.add([LOG, ufds.moray.log]);

