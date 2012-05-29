// Copyright 2012 Joyent, Inc.  All rights reserved.

var util = require('util');
var ldap = require('ldapjs');

var Validator = require('../lib/schema/validator');


/* JSSTYLED */
var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/* JSSTYLED */
var ALIAS_RE = /^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$/;
var MAX_ZFS_IO = 1000;



///--- Validation helpers

function validUUID(uuid) {
    return UUID_RE.test(uuid);
}

function validAlias(alias) {
    return ALIAS_RE.test(alias);
}

function validNumber(attr) {
    var number = parseInt(attr, 10);
    return (number > 0 ? true : false);
}

function validBrand(brand) {
    return (brand == 'joyent-minimal' || brand == 'joyent' || brand == 'kvm');
}


var NUMBER_ATTRS = {
    max_physical_memory: 'Max. Physical Memory',
    max_swap: 'Swap',
    max_lwps: 'Lightweight Processes',
    quota: 'Disk',
    cpu_shares: 'CPU Shares',
    zfs_io_priority: 'ZFS IO Priority'
};



///--- API

function Machine() {
    Validator.call(this, {
        name: 'machine',
        required: {
            uuid: 1,
            brand: 1,
            max_physical_memory: 1,
            max_swap: 1,
            max_lwps: 1,
            quota: 1,
            cpu_shares: 1,
            zfs_io_priority: 1
        },
        optional: {
            alias: 1,
            ram: 1,
            zonepath: 1,
            dataset_uuid: 1,
            server_uuid: 1,
            autoboot: 1,
            datasets: 0,
            nics: 0,
            internal_metadata: 1,
            customer_metadata: 1,
            tags: 1,
            delegatedataset: 1,
            disks: 0,
            vcpus: 1,
            cpu_cap: 1,
            zone_state: 1,
            state: 1,
            create_timestamp: 1,
            last_modified: 1,
            destroyed: 1,
            zpool: 1
        }
    });
}
util.inherits(Machine, Validator);


Machine.prototype.validate = function validate(entry, callback) {
    var keys = Object.keys(NUMBER_ATTRS);
    var attrs = entry.attributes;
    var i;
    var errors = [];

    if (!validUUID(attrs.uuid[0])) {
        errors.push('Machine uuid: \'' + attrs.uuid[0] + '\' is invalid '
                    + '(must be a UUID)');
    }

    for (i = 0; i < keys.length; i++) {
        var key = keys[i];

        if (!validNumber(attrs[key][0])) {
            errors.push(NUMBER_ATTRS[key] + ': \'' + attrs[key][0] +
                        '\' is invalid (must be a positive number)');
        }
    }

    if (attrs.brand !== undefined &&
        typeof (attrs.brand[0]) === 'string' &&
        !validBrand(attrs.brand[0])) {

        errors.push('Machine brand: \'' + attrs.alias[0] + '\' is invalid, '
                    + 'must be either \'joyent\' or \'kvm\'');
    }


    if (parseInt(attrs.max_swap[0], 10) <
            parseInt(attrs.max_physical_memory[0], 10)) {
        errors.push('Swap: \'' + attrs.max_swap[0] + '\' is invalid '
                    + '(cannot be less than Max. Physical Memory: ' +
                    attrs.max_physical_memory[0] + ')');
    }

    if (attrs.ram !== undefined && !validNumber(attrs.ram[0])) {
        errors.push('RAM: \'' + attrs.ram[0] +
                    '\' is invalid (must be a positive number)');
    }

    if (attrs.zfs_io_priority[0] > MAX_ZFS_IO) {
        errors.push('ZFS IO Priority: \'' + attrs.zfs_io_priority[0] +
                    '\' is invalid (cannot be greater than ' + MAX_ZFS_IO +
                    ')');
    }

    if (attrs.alias !== undefined &&
        typeof (attrs.alias[0]) == 'string' &&
        !validAlias(attrs.alias[0])) {

        errors.push('Machine alias: \'' + attrs.alias[0] + '\' is invalid');
    }

    if (attrs.vcpus !== undefined && !validNumber(attrs.vcpus[0])) {
        errors.push('Virtual CPUs: \'' + attrs.vcpus[0] +
                    '\' is invalid (must be a positive number)');
    }

    if (attrs.cpu_cap !== undefined && !validNumber(attrs.cpu_cap[0])) {
        errors.push('CPU Cap: \'' + attrs.cpu_cap[0] +
                    '\' is invalid (must be a positive number)');
    }


    if (errors.length)
        return callback(new ldap.ConstraintViolationError(errors.join('\n')));

    return callback();
};



///--- Exports

module.exports = {
    createInstance: function createInstance() {
        return new Machine();
    }
};
