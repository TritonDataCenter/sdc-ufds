/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var assert = require('assert');
var crypto = require('crypto');
var sprintf = require('util').format;

var ldap = require('ldapjs');
var restify = require('restify');
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}



///--- Globals

var hidden = new ldap.Control({
    type: '1.3.6.1.4.1.38678.1',
    criticality: true
});

var AES_KEY = uuid().replace('-').substring(0, 16);

var OPERATORS_DN = 'cn=operators, ou=groups, o=smartdc';

var ResourceNotFoundError = restify.ResourceNotFoundError;


///--- Helpers

function _randomId(min, max) {
    if (!min) {
        min = 0;
    }
    if (!max) {
        max = Math.pow(2, 32) - 1;
    }

    return Math.floor(Math.random() * (max - min + 1)) + min;
}


function _merge(obj1, obj2) {
    Object.keys(obj2).forEach(function (k) {
        if (!obj1.hasOwnProperty(k)) {
            obj1[k] = obj2[k];
        }
    });

    return obj1;
}


// Damned legacy stuff ...
function _forgotPasswordCode(customerId) {
    var cipher = crypto.createCipher('aes-128-cbc', AES_KEY);
    var now = new Date();
    cipher.update('' + (now.getUTCMilliseconds));
    cipher.update('' + (now.getUTCSeconds() + 1));
    cipher.update('' + (now.getUTCMinutes() + 1));
    cipher.update('' + (now.getUTCDay() + 1));
    cipher.update('' + now.getUTCDate());
    cipher.update('' + (now.getUTCMonth() + 1));
    cipher.update('' + now.getUTCFullYear());
    cipher.update(customerId.replace('-', ''), 'utf8', 'hex');
    return cipher.final('hex');
}


function _translate(entry) {
    assert.ok(entry);

    var d = new Date().toISOString();
    var created_at = (entry.created_at) ?
        (new Date(parseInt(entry.created_at, 10)).toISOString()) : d;
    var updated_at = (entry.updated_at) ?
        (new Date(parseInt(entry.updated_at, 10)).toISOString()) : d;
    var customer = {
        id: _randomId(),
        uuid: entry.uuid,
        customer_id: entry.uuid,
        customer_uuid: entry.uuid,
        login: entry.login,
        email_address: entry.email,
        first_name: entry.givenname || entry.givenName,
        last_name: entry.sn,
        company_name: entry.company || null,
        approved_for_provisioning: entry.approved_for_provisioning || false,
        created_at: created_at,
        updated_at: updated_at
    };

    if (entry.address && entry.address.length) {
        if (!Array.isArray(entry.address)) {
            entry.address = [entry.address];
        }

        var i;
        for (i = 0; i < entry.address.length; i++) {
            customer['street_' + (i + 1)] = entry.address[i];
        }
    }

    if (!customer.street_1) {
        customer.street_1 = null;
    }

    if (!customer.street_2) {
        customer.street_2 = null;
    }

    if (entry.memberof) {
        if (Array.isArray(entry.memberof)) {
            if (entry.memberof.indexOf(OPERATORS_DN) !== -1) {
                customer.role_type = 2;
                customer.role = 2;
            }
        } else {
            if (entry.memberof === OPERATORS_DN) {
                customer.role_type = 2;
                customer.role = 2;
            }
        }
    }

    return _merge(customer, {
        city: entry.city || null,
        state: entry.state || null,
        postal_code: entry.postalcode || null,
        country: entry.country || null,
        phone_number: entry.phone || null,
        role_type: 1,
        role: 1,
        asset_id: null,
        legacy_id: null,
        deleted_at: null,
        alternate_email_address: null,
        forgot_password_code: entry.forgot_password_code ||
            _forgotPasswordCode(entry.uuid),
        activation_code: null,
        activated_at: entry._ctime
    });
}



///--- Exports

module.exports = {

    loadCustomers: function loadCustomers(ld,
                                          filter,
                                          translate,
                                          callback,
                                          base) {
        assert.ok(ld);
        assert.ok(filter);
        assert.ok(translate !== undefined);

        if (typeof (translate) === 'function') {
            base = callback;
            callback = translate;
            translate = true;
        }

        if (!base) {
            base = 'o=smartdc';
        }

        var log = ld.log;
        var opts = {
            scope: 'sub',
            filter: filter,
            attributes: [
                'login',
                'phone',
                'email',
                'cn',
                'givenname',
                'sn',
                'company',
                'address',
                'city',
                'state',
                'postalcode',
                'country',
                'memberof',
                'uuid',
                'userpassword',
                '_salt',
                'created_at',
                'updated_at',
                'approved_for_provisioning',
                'forgot_password_code'
            ]
        };

        log.debug({
            base: base,
            filter: opts.filter
        }, 'loadCustomers: starting search');

        ld.search(base, opts, function (err, entries) {
            if (err) {
                log.debug({
                    base: base,
                    filter: opts.filter,
                    err: err
                }, 'loadCustomers: error in search');
                callback(err);
                return;
            }

            entries.map(function (entry) {
                return (translate ? _translate(entry) : entry);
            });

            return callback(null, entries);
        });
    },

    loadCustomer: function loadCustomer(req, res, next) {
        assert.ok(req.ufds);
        if (!req.params.uuid) {
            if (req.params.login) {
                req.params.uuid = req.params.login;
            } else {
                return next();
            }
        }

        var log = req.log;
        var sent = false;
        function returnError(err) {
            if (!sent) {
                log.debug(err, 'loadCustomer: returning error');
                sent = true;
                next(new restify.InternalError(err.message));
            }
        }

        log.debug('LoadCustomer(%s) entered', req.params.uuid);
        req.ufds.getUser(req.params.uuid, function (err, user) {
            if (err) {
                return returnError(err);
            }
            req.customer = user;
            log.debug('LoadCustomer(%s) -> %j',
                              req.params.uuid,
                              user);
            if (!sent) {
                sent = true;
                if (!req.customer) {
                    next(new ResourceNotFoundError(req.params.uuid));
                } else {
                    next();
                }
            } else {
                next();
            }
        });
    },

    translateCustomer: _translate,

    forgotPasswordCode: _forgotPasswordCode,

    randomId: _randomId

};
