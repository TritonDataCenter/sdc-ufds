// Copyright 2012 Joyent, Inc.  All rights reserved.

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
    if (!min) min = 0;
    if (!max) max = Math.pow(2, 32) - 1;

    return Math.floor(Math.random() * (max - min + 1)) + min;
}


function _merge(obj1, obj2) {
    Object.keys(obj2).forEach(function (k) {
        if (!obj1.hasOwnProperty(k))
            obj1[k] = obj2[k];
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

        for (var i = 0; i < entry.address.length; i++) {
            customer['street_' + (i + 1)] = entry.address[i];
        }
    }

    if (!customer.street_1)
        customer.street_1 = null;

    if (!customer.street_2)
        customer.street_2 = null;

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

        if (!base)
            base = 'o=smartdc';

        var log = ld.log;
        var opts = {
            scope: 'sub',
            filter: filter,
            attributes: [
                'login',
                'phone',
                'email',
                'cn',
                'givenName',
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
        ld.search(base, opts, hidden, function (err, result) {
            if (err) {
                log.debug({
                    base: base,
                    filter: opts.filter,
                    err: err
                }, 'loadCustomers: error in search (starting)');
                callback(err);
                return;
            }

            var entries = [];
            var done = false;
            result.on('searchEntry', function (entry) {
                log.debug({
                    entry: entry.object
                }, 'loadCustomers: entry received');

                entries.push((translate ?
                              _translate(entry.object) :
                              entry.object));
            });

            result.on('error', function (err2) {
                result.removeAllListeners('searchEntry');
                result.removeAllListeners('end');

                log.debug({
                    base: base,
                    filter: opts.filter,
                    err: err
                }, 'loadCustomers: error in search (mid stream)');

                if (done)
                    return;

                done = true;
                callback(err2);
            });

            result.once('end', function () {
                log.debug({
                    base: base,
                    filter: opts.filter
                }, 'loadCustomers: search done');

                result.removeAllListeners('searchEntry');
                result.removeAllListeners('error');
                if (done)
                    return;

                done = true;
                callback(null, entries);
            });
        });
    },

    loadCustomer: function loadCustomer(req, res, next) {
        if (!req.params.uuid)
            return next();

        var log = req.log;
        var sent = false;
        function returnError(err) {
            if (!sent) {
                log.debug(err, 'loadCustomer: returning error');
                sent = true;
                next(new restify.InternalError(err.message));
            }
        }
        var opts = {
            scope: 'sub',
            filter: '(uuid=' + req.params.uuid + ')'
        };

        log.debug({
            filter: opts.filter
        }, 'LoadCustomer(%s) entered', req.params.uuid);
        req.ldap.search('o=smartdc', opts, hidden, function (e, result) {
            if (e) {
                log.debug({
                    err: e,
                    filter: opts.filter
                }, 'loadCustomer: error starting search');
                returnError(e);
                return;
            }

            result.once('searchEntry', function (entry) {
                log.debug({
                    entry: entry.object,
                    filter: opts.filter
                }, 'LoadCustomer(%s): entry found', req.params.uuid);
                req.customer = entry;
            });

            result.once('error', returnError);
            result.once('end', function () {
                if (req.customer) {
                    log.debug('LoadCustomer(%s) -> %j',
                              req.params.uuid,
                              req.customer.object);
                }

                if (!sent) {
                    sent = true;
                    if (!req.customer) {
                        next(new ResourceNotFoundError(req.params.uuid));
                    } else {
                        next();
                    }
                }
            });
        });
    },

    translateCustomer: _translate,

    forgotPasswordCode: _forgotPasswordCode,

    randomId: _randomId

};
