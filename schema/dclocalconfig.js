/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

var assert = require('assert');
var util = require('util');

var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');


///--- Globals
var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

///--- API

function DcLocalConfig() {
    Validator.call(this, {
        name: 'dclocalconfig',
        required: {
            dclocalconfig: 1
        },
        optional: {
            defaultfabricsetup: 1,
            defaultnetwork: 1
        }
    });
}
util.inherits(DcLocalConfig, Validator);

DcLocalConfig.prototype.validate =
function validate(entry, config, changes, callback) {
    var attrs = entry.attributes;
    var errors = [];

    var defaultFabricSetup;
    var defaultNetwork;

    if (attrs.hasOwnProperty('dclocalconfig')) {
        var configDc = config.datacenter_name;
        var dclocalconfig = attrs.dclocalconfig[0];

        if (dclocalconfig !== configDc) {
            errors.push(
                util.format('dclocalconfig name must be: %s for this instance',
                 configDc));
        }

        var dn = (typeof (entry.dn) === 'string') ?
            ldap.parseDN(entry.dn) : entry.dn;

        if (dn.rdns[0].dclocalconfig && dn.rdns[0].dclocalconfig !== configDc) {
            errors.push(util.format(
                'dn: %s is invalid, dclocalconfig must be dclocalconfig=%s',
                dn, configDc));
        }

        if (changes && changes.some(function (c) {
            return c._modification.type === 'dclocalconfig' &&
                c._modification.vals.length === 1 &&
                c._modification.vals[0] !== config.datacenter_name;
        })) {
            errors.push('dclocalconfig cannot be modified');
        }
    }


    if (attrs.hasOwnProperty('defaultFabricSetup')) {
        defaultFabricSetup = attrs.defaultFabricSetup[0];

        if (defaultFabricSetup !== 'true' && defaultFabricSetup !== 'false') {
            errors.push('defaultFabricSetup must be one of: (true, false)');
        }
    }

    if (attrs.hasOwnProperty('defaultNetwork')) {
        defaultNetwork = attrs.defaultNetwork[0];

        if (!UUID_RE.test(defaultNetwork)) {
            errors.push('defaultNetwork must be a UUID');
        }
    }

    if (errors.length) {
        return callback(new ldap.ConstraintViolationError(errors.join('\n')));
    }
    return callback();
};

module.exports.createInstance = function createInstance() {
    return new DcLocalConfig();
};
