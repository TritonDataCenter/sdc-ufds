// Copyright 2014 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var mod_util = require('util');
var sprintf = mod_util.format;

var ldap = require('ldapjs');
var restify = require('restify');
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}

var util = require('./util');
var salt = require('../lib/salt');


///--- Globals

var LIST_FILTER = '(&(login=*)(objectclass=sdcperson))';
var ID_FILTER = '(uuid=%s)';
var GET_FILTER = '(&' + ID_FILTER + LIST_FILTER + ')';
var FILTER = '(%s=%s)';
var WC_FILTER = '(%s=*%s*)';
var GROUPS = 'ou=groups, o=smartdc';
var OPERATORS_DN = 'cn=operators, ou=groups, o=smartdc';

var Change = ldap.Change;



///--- API

module.exports = {

    operators: function operators(req, res, next) {
        assert.ok(req.ufds);
        var log = req.log;
        log.debug('Preload Operators: entered');
        var opts = {
            scope: 'base',
            filter: '(objectclass=groupofuniquenames)'
        };

        return req.ufds.search(OPERATORS_DN, opts, function (err, entries) {
            if (err) {
                return next(err);
            }

            if (entries && entries.length && entries[0].uniquemember) {
                if (!Array.isArray(entries[0].uniquemember)) {
                    entries[0].uniquemember = [entries[0].uniquemember];
                }
                req.operator_dns = entries[0].uniquemember;
            }
            return next();
        });
    },

    list: function list(req, res, next) {
        assert.ok(req.ufds);

        var log = req.log;
        var reverse = false;
        var sort = false;
        var limit = false;
        var offset = false;

        log.debug({params: req.params}, 'ListCustomers: entered');

        if (req.params.reverse) {
            reverse = /^true$/i.test(req.params.reverse);
            delete req.params.reverse;
        }
        if (req.params.sort) {
            sort = req.params.sort;
            delete req.params.sort;
        }
        if (req.params.offset !== undefined) {
            offset = (parseInt(req.params.offset, 10) - 1) || 0;
            delete req.params.offset;
        }
        if (req.params.limit !== undefined) {
            limit = parseInt(req.params.limit, 10);
            delete req.params.limit;
        }
        var filter;

        var keys = Object.keys(req.params);
        if (keys && keys.length) {
            filter = '(&';
            keys.forEach(function (k) {
                switch (k) {
                case 'login':
                    filter += sprintf(FILTER, 'login', req.params[k]);
                    break;
                case 'phone_number':
                    filter += sprintf(FILTER, 'phone', req.params[k]);
                    break;
                case 'email_address':
                    filter += sprintf(WC_FILTER, 'email', req.params[k]);
                    break;
                case 'first_name':
                    filter += sprintf(WC_FILTER, 'givenname', req.params[k]);
                    break;
                case 'last_name':
                    filter += sprintf(WC_FILTER, 'sn', req.params[k]);
                    break;
                case 'company_name':
                    filter += sprintf(WC_FILTER, 'company', req.params[k]);
                    break;
                case 'street_1':
                case 'street_2':
                    filter += sprintf(WC_FILTER, 'address', req.params[k]);
                    break;
                case 'city':
                    filter += sprintf(WC_FILTER, 'city', req.params[k]);
                    break;
                case 'state':
                    filter += sprintf(WC_FILTER, 'state', req.params[k]);
                    break;
                case 'postal_code':
                    filter += sprintf(WC_FILTER, 'postalcode', req.params[k]);
                    break;
                case 'country':
                    filter += sprintf(WC_FILTER, 'country', req.params[k]);
                    break;
                case 'role_type':
                    filter += '(memberof=cn=operators, ou=groups, o=smartdc)';
                    break;
                default:
                    break;
                }
            });
            filter += ')';
        } else {
            filter = LIST_FILTER;
        }
        log.debug({filter: filter}, 'ListCustomers: LDAP filter');
        var base = 'ou=users, o=smartdc';

        return util.loadCustomers(req.ufds, filter, function (err, customers) {
            if (err) {
                return next(err);
            }

            if (sort) {
                customers.sort(function (a, b) {
                    function compare(uno, dos) {
                        if (uno[sort] < dos[sort]) {
                            return -1;
                        }
                        if (uno[sort] > dos[sort]) {
                            return 1;
                        }
                        return 0;
                    }

                    var cmp = compare(a, b);
                    if (reverse) {
                        cmp = cmp * -1;
                    }
                    return cmp;
                });
            }

            if (offset !== false) {
                customers.splice(0, offset);
            }

            if (limit !== false) {
                customers = customers.splice(0, limit);
            }

            // CAPI-254: Once we're done, flag operators properly:
            customers.forEach(function (c) {
                var c_dn = sprintf('uuid=%s, ou=users, o=smartdc', c.uuid);
                if (req.operator_dns && req.operator_dns.indexOf(c_dn) !== -1) {
                    c.role = 2;
                    c.role_type = 2;
                }
            });

            var count = customers.length;
            if (req.accepts('application/xml')) {
                customers = { customers: { customer: customers } };
            }

            log.debug({customers: customers}, 'ListCustomers: returning');
            res.send(200, customers, { 'X-Joyent-Resource-Count': count });
            return next();
        }, base);
    },


    create: function create(req, res, next) {
        assert.ok(req.ufds);
        var log = req.log;

        log.debug({params: req.params}, 'CreateCustomer: entered');

        var errors = [];

        if (req.params.customer) {
            if (typeof (req.params.customer) === 'object') {
                req.params = req.params.customer;
            } else if (typeof (req.params.customer) === 'string') {
                if (req.accepts('application/json') ||
                        req.is('application/json')) {
                    try {
                        req.params = JSON.parse(req.params.customer);
                    } catch (e) {
                        return next(res.sendError([e.message]));
                    }
                }
            }
        }

        if (!req.params.login) {
            errors.push('login is a required parameter');
        }
        if (!req.params.password) {
            errors.push('password is a required parameter');
        }
        if (!req.params.email_address) {
            errors.push('email_address is a required parameter');
        }
        if (req.params.password_confirmation &&
            req.params.password_confirmation !== req.params.password) {
            errors.push('password confirmation missmatch');
        }

        if (errors.length) {
            log.debug({errors: errors}, 'Create Customer: have errors!');
            res.sendError(errors);
            next(false);
            return;
        }

        var customer = {
            login: req.params.login,
            email: req.params.email_address,
            userpassword: req.params.password
        };

        customer.approved_for_provisioning =
            (req.params.approved_for_provisioning) ? true : false;

        var now = new Date().getTime();

        if (req.params.created_at) {
            customer.created_at = new Date(req.params.created_at).getTime();
        } else {
            customer.created_at = now;
        }

        if (req.params.updated_at) {
            customer.updated_at = new Date(req.params.updated_at).getTime();
        } else {
            customer.updated_at = now;
        }

        if (req.params.first_name) {
            customer.givenname = req.params.first_name;
        }
        if (req.params.last_name) {
            customer.sn = req.params.last_name;
        }
        if (req.params.first_name && req.params.last_name) {
            customer.cn = req.params.first_name + ' ' + req.params.last_name;
        }
        if (req.params.company_name) {
            customer.company = req.params.company_name;
        }
        if (req.params.street_1) {
            customer.address = [req.params.street_1];
        }
        if (req.params.street_2 && customer.address) {
            customer.address.push(req.params.street_2);
        }
        if (req.params.city) {
            customer.city = req.params.city;
        }
        if (req.params.state) {
            customer.state = req.params.state;
        }
        if (req.params.postal_code) {
            customer.postalcode = req.params.postal_code;
        }
        if (req.params.country) {
            customer.country = req.params.country;
        }
        if (req.params.phone_number) {
            customer.phone = req.params.phone_number;
        }

        log.debug({customer: customer}, 'CreateCustomer: saving');
        return req.ufds.addUser(customer, function (err, user) {
            if (err) {
                if (err.code === ldap.LDAP_ENTRY_ALREADY_EXISTS) {
                    return next(res.sendError(['Username is already taken']));
                } else if (err.code === ldap.LDAP_CONSTRAINT_VIOLATION) {
                    return next(res.sendError([err.message]));
                } else {
                    return next(res.sendError([err.toString()]));
                }
            }

            return req.ufds.updateUser(user, {
                forgot_password_code: util.forgotPasswordCode(user.uuid)
            }, function (er) {
                if (er) {
                    return next(res.sendError([er.toString()]));
                }

                customer = util.translateCustomer(user);

                var _done = false;
                function done() {
                    if (_done) {
                        return;
                    }

                    _done = true;
                    if (req.accepts('application/xml')) {
                        customer = { customer : customer };
                    }

                    res.send(201, customer);
                    next();
                }

                if (req.params.role !== '2') {
                    return done();
                }

                var change = {
                    operation: 'add',
                    modification: {
                        uniquemember: user.dn
                    }
                };
                return req.ufds.client.modify(OPERATORS_DN, change,
                        function (err2) {
                    if (err2) {
                        req.ldap.del(user.dn, function () {});
                        log.error('Unable to add %s to operators group.',
                                  user.dn);
                        return next(res.sendError([err2.toString()]));
                    }
                    // FIXME: using ufds.client bypasses logic to clear cache
                    req.ufds._newCache();
                    // Need to explicitly override role here, since we already
                    // translated customer before.
                    customer.role = 2;
                    customer.role_type = 2;

                    return done();
                });
            });

        });
    },


    get: function get(req, res, next) {
        var log = req.log;

        log.debug({uuid: req.params.uuid}, 'GetCustomer: entered');

        var filter;
        if (req.params.uuid.indexOf('+') === -1) {
            filter = sprintf(GET_FILTER, req.params.uuid);
        }

        if (!filter) {
            filter = '(&' + LIST_FILTER + '(|';
            req.params.uuid.split('+').forEach(function (id) {
                filter += sprintf(ID_FILTER, id);
            });
            filter += '))';
        }

        log.debug({filter: filter}, 'GetCustomer: filter');

        util.loadCustomers(req.ufds, filter, function (err, customers) {
            if (err) {
                return next(err);
            }

            if (!customers.length) {
                return next(new restify.ResourceNotFoundError(req.params.uuid));
            }

            var result;

            if (customers.length > 1) {
                result = customers;
                if (req.accepts('application/xml')) {
                    result = { customers: { customer: customers } };
                }
                log.debug({
                    uuid: req.params.uuid,
                    result: result
                }, 'GetCustomer: done');
                res.send(200, result);
                return next();
            }

            // Now load the groups it is in
            var c = customers[0];
            var dn = sprintf('uuid=%s, ou=users, o=smartdc', c.uuid);
            var opts = {
                scope: 'one',
                filter: sprintf(
                    '(&(objectclass=groupofuniquenames)(uniquemember=%s))',
                    dn)
            };
            return req.ufds.client.search(GROUPS, opts, function (gErr, gRes) {
                if (gErr) {
                    return next(gErr);
                }

                var groups = [];

                gRes.on('searchEntry', function (entry) {
                    groups.push(entry);
                });
                gRes.on('error', next);
                gRes.on('end', function () {

                    c.memberof = groups.map(function (v) {
                        return v.dn;
                    });

                    if (c.memberof.indexOf(OPERATORS_DN) !== -1) {
                        c.role_type = 2;
                        c.role = 2;
                    }

                    delete c.memberof;
                    result = c;
                    if (req.accepts('application/xml')) {
                        result = { customer: c };
                    }
                    log.debug({
                        uuid: req.params.uuid,
                        result: result
                    }, 'GetCustomer: done');
                    res.send(200, result);
                    return next();
                });
            });
        });
    },


    update: function update(req, res, next) {
        assert.ok(req.customer);
        var log = req.log;

        log.debug({params: req.params}, 'UpdateCustomer: entered');

        if (req.params.customer) {
            if (typeof (req.params.customer) === 'object') {
                req.params = req.params.customer;
            } else if (typeof (req.params.customer) === 'string') {
                if (req.accepts('application/json') ||
                        req.is('application/json')) {
                    try {
                        req.params = JSON.parse(req.params.customer);
                    } catch (e) {
                        return next(res.sendError([e.message]));
                    }
                }
            }
        }

        var changes = [];
        var address = [];
        var password = [];
        if (req.params.first_name && req.params.last_name) {
            req.params.cn = req.params.first_name + ' ' + req.params.last_name;
        }
        Object.keys(req.params).forEach(function (k) {
            var _key;
            switch (k) {
            case 'login':
                _key = k;
                break;
            case 'email_address':
                _key = 'email';
                break;
            case 'password':
            case 'password_confirmation':
                _key = 'userpassword';
                break;
            case 'first_name':
                _key = 'givenname';
                break;
            case 'last_name':
                _key = 'sn';
                break;
            case 'company_name':
                _key = 'company';
                break;
            case 'street_1':
            case 'street_2':
                _key = 'address';
                break;
            case 'city':
                _key = k;
                break;
            case 'state':
                _key = k;
                break;
            case 'postal_code':
                _key = 'postalcode';
                break;
            case 'country':
                _key = k;
                break;
            case 'phone_number':
                _key = 'phone';
                break;
            case 'cn':
                _key = 'cn';
                break;
            case 'approved_for_provisioning':
                _key = 'approved_for_provisioning';
                break;
            default:
                break;
            }
            if (!_key || !k || !req.params[k]) {
                return;
            }

            if (_key === 'address') {
                address.push(req.params[k]);
                return;
            } else if (_key === 'userpassword') {
                password.push(req.params[k]);
                return;
            }


            var mod = {};
            mod[_key] = [req.params[k]];
            changes.push(new Change({
                type: 'replace',
                modification: mod
            }));
        });

        if (password.length) {
            if (password[0] !== password[1]) {
                return next(new restify.InvalidArgumentError(
                            'passwords do not match'));
            }

            changes.push(new Change({
                type: 'replace',
                modification: {
                    userpassword: [password[0]]
                }
            }));
        }

        if (address.length) {
            changes.push(new Change({
                type: 'replace',
                modification: {
                    address: address
                }
            }));
        }

        if (!changes.length) {
            return next(new restify.MissingParameterError(
                        'no updates specified'));
        }

        var _dn = req.customer.dn.toString();
        return req.ufds.client.modify(_dn, changes, function (err) {
            if (err) {
                if (err.code === ldap.LDAP_CONSTRAINT_VIOLATION) {
                    return next(res.sendError([err.message]));
                } else {
                    return next(res.sendError([err.toString()]));
                }
            }

            // FIXME: using ufds.client bypasses logic to clear cache
            req.ufds._newCache();
            log.debug({id: req.params.uuid}, 'UpdateCustomer: ok');
            return next();
        });
    },


    forgot_password: function forgot_password(req, res, next) {
        assert.ok(req.customer);
        assert.ok(req.ufds);

        var log = req.log;
        var changes = [];

        log.debug({params: req.params}, 'forgot_password: entered');
        // If a request has been made to forgot_password, modify it:
        if (/\/forgot_password/.test(req.url)) {
            changes.push(new Change({
                type: 'replace',
                modification: {
                    forgot_password_code:
                        util.forgotPasswordCode(req.params.uuid)
                }
            }));
        }

        var _dn = req.customer.dn.toString();
        return req.ufds.client.modify(_dn, changes, function (err) {
            if (err) {
                if (err.code === ldap.LDAP_CONSTRAINT_VIOLATION) {
                    return next(res.sendError([err.message]));
                } else {
                    return next(res.sendError([err.toString()]));
                }
            }

            // FIXME: using ufds.client bypasses logic to clear cache
            req.ufds._newCache();
            log.debug({id: req.params.uuid}, 'forgot_password: ok');
            return next();
        });
    },

    del: function del(req, res, next) {
        assert.ok(req.customer);
        assert.ok(req.ufds);

        var log = req.log;

        log.debug({uuid: req.params.uuid}, 'DeleteCustomer: entered');

        return req.ufds.deleteUser(req.params.uuid, function (err) {
            if (err) {
                return next(err);
            }

            log.debug({uuid: req.params.uuid}, 'DeleteCustomer: gone');
            var change = {
                operation: 'delete',
                modification: {
                    uniquemember: req.customer.dn.toString()
                }
            };
            return req.ufds.client.modify(OPERATORS_DN, change, function () {
                // FIXME: using ufds.client bypasses logic to clear cache
                req.ufds._newCache();
                // Ignore error, as it may not have existed in the group.
                res.send(200);
                return next();
            });
        });
    }

};
