/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * UFDS CAPI main file.
 *
 * CAPI is the backwards compatible HTTP proxy for the UFDS LDAP server.
 * It's used by SmartLogin for SSH'ing smart machines.
 */

var path = require('path');

var nopt = require('nopt');
var Logger = require('bunyan');
var restify = require('restify');

var CAPI = require('./capi/server.js');

///--- Globals

var opts = {
    'certificate': String,
    'config': String,
    'debug': Boolean,
    'file': String,
    'key': String,
    'port': Number,
    'ufds': String,
    'help': Boolean
};

var shortOpts = {
    'c': ['--certificate'],
    'd': ['--debug'],
    'f': ['--file'],
    'k': ['--key'],
    'p': ['--port'],
    'h': ['--help'],
    'u': ['--ufds']
};

// --- Helpers

function usage(code, message) {
    var _opts = '';
    Object.keys(shortOpts).forEach(function (k) {
        var longOpt = shortOpts[k][0].replace('--', '');
        var type = opts[longOpt].name || 'string';
        if (type && type === 'boolean') {
            type = '';
        }
        type = type.toLowerCase();

        _opts += ' [--' + longOpt + ' ' + type + ']';
    });
    _opts += ' dn attribute value(s)';

    var msg = (message ? message + '\n' : '') +
        'usage: ' + path.basename(process.argv[1]) + _opts;

    process.stderr.write(msg + '\n');
    process.exit(code);
}

function processConfig() {
    var _config;
    var parsed = nopt(opts, shortOpts, process.argv, 2);
    var file = parsed.file || __dirname + '/etc/config.json';

    if (parsed.help) {
        usage(0);
    }

    try {
        _config = CAPI.processConfigFile(file);
    } catch (e) {
        console.error('Unable to parse configuration file: ' + e.message);
        process.exit(1);
    }

    if (parsed.debug) {
        _config.logLevel = 'debug';
    }

    _config.port = (process.env.PORT) ? process.env.PORT : _config.port;

    return _config;
}


///--- Mainline

(function main() {
    var cfg = processConfig();
    cfg.log = new Logger({
        name: 'capi',
        level: cfg.logLevel,
        stream: process.stdout,
        serializers: restify.bunyan.serializers
    });

    var capi = CAPI.createServer(cfg);

    capi.connect(function (err) {
        if (err) {
          process.exit(1);
        }
    });
}());
