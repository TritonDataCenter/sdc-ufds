// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var sprintf = require('util').format;

var ldap = require('ldapjs');
var restify = require('restify');
var uuid = require('node-uuid');

var util = require('./util');



///--- Globals

var LIST_FILTER = '(&(login=*)(objectclass=sdcperson))';
var ID_FILTER = '(uuid=%s)';
var GET_FILTER = '(&' + ID_FILTER + LIST_FILTER + ')';
var FILTER = '(%s=%s)';
var WC_FILTER = '(%s=*%s*)';
var OPERATORS_DN = 'cn=operators, ou=groups, o=smartdc';

var Change = ldap.Change;



///--- API

module.exports = {

    list: function list(req, res, next) {
        assert.ok(req.ldap);

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
                    filter += sprintf(WC_FILTER, 'cn', req.params[k]);
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

        var base = 'ou=users, o=smartdc';

        return util.loadCustomers(req.ldap, filter, function (err, customers) {
            if (err)
                return next(err);

            if (sort) {
                customers.sort(function (a, b) {
                    function compare(uno, dos) {
                        if (uno[sort] < dos[sort])
                            return -1;
                        if (uno[sort] > dos[sort])
                            return 1;
                        return 0;
                    }

                    var cmp = compare(a, b);
                    if (reverse)
                        cmp = cmp * -1;

                    return cmp;
                });
            }

            if (offset !== false)
                customers.splice(0, offset);

            if (limit !== false)
                customers = customers.splice(0, limit);

            var count = customers.length;
            if (req.xml)
                customers = { customers: { customer: customers } };

            log.debug('ListCustomers: returning %o', customers);
            res.send(200, customers, { 'X-Joyent-Resource-Count': count });
            return next();
        }, base);
    },


    create: function create(req, res, next) {
        var log = req.log;

        log.debug('CreateCustomer entered %o', req.params);

        var errors = [];

        if (req.params.customer) {
            if (typeof (req.params.customer) === 'object') {
                req.params = req.params.customer;
            } else if (typeof (req.params.customer) === 'string') {
                if (res._accept === 'application/json') {
                    try {
                        req.params = JSON.parse(req.params.customer);
                    } catch (e) {
                        return res.sendError([e.message]);
                    }
                }
            }
        }

        if (!req.params.login)
            errors.push('login is a required parameter');
        if (!req.params.password)
            errors.push('password is a required parameter');
        if (!req.params.email_address)
            errors.push('email_address is a required parameter');
        if (req.params.password_confirmation &&
            req.params.password_confirmation !== req.params.password)
            errors.push('password mis is a required parameter');

        if (errors.length)
            return res.sendError(errors);

        var customer = {
            uuid: uuid(),
            login: req.params.login,
            email: req.params.email_address,
            userpassword: req.params.password,
            objectclass: ['sdcperson']
        };

        if (req.params.first_name)
            customer.cn = req.params.first_name;
        if (req.params.last_name)
            customer.sn = req.params.last_name;
        if (req.params.company_name)
            customer.company = req.params.company_name;
        if (req.params.street_1)
            customer.address = [req.params.street_1];
        if (req.params.street_2 && customer.address)
            customer.address.push(req.params.street_2);
        if (req.params.city)
            customer.city = req.params.city;
        if (req.params.state)
            customer.state = req.params.state;
        if (req.params.postal_code)
            customer.postalcode = req.params.postal_code;
        if (req.params.country)
            customer.country = req.params.country;
        if (req.params.phone_number)
            customer.phone = req.params.phone_number;

        var dn = sprintf('uuid=%s, ou=users, o=smartdc', customer.uuid);
        log.debug('CreateCustomer, saving: %s -> %j', dn, customer);
        return req.ldap.add(dn, customer, function (err) {
            if (err) {
                if (err instanceof ldap.EntryAlreadyExistsError) {
                    return res.sendError(['Username is already taken']);
                } else if (err instanceof ldap.ConstraintViolationError) {
                    return res.sendError([err.message + ' already exists']);
                } else {
                    return res.sendError([err.toString()]);
                }
            }

            customer.dn = dn;
            customer = util.translateCustomer(customer);

            customer.forgot_password_code =
                util.forgotPasswordCode(customer.uuid[0]);

            function done() {
                if (req.xml)
                    customer = { customer : customer };

                res.send(201, customer);
                return next();
            }

            if (req.params.role !== '2')
                return done();

            var change = {
                operation: 'add',
                modification: {
                    uniquemember: dn.toString()
                }
            };
            return req.ldap.modify(OPERATORS_DN, change, function (err2) {
                if (err2) {
                    req.ldap.del(dn, function () {});
                    log.error('Unable to add %s to operators group.',
                              dn.toString());
                    return res.sendError([err2.toString()]);
                }

                return done();
            });

        });
    },


    get: function get(req, res, next) {
        var log = req.log;

        log.debug('GetCustomer(%s) entered', req.params.uuid);

        var filter;
        if (req.params.uuid.indexOf('+') === -1)
            filter = sprintf(GET_FILTER, req.params.uuid);

        if (!filter) {
            filter = '(&' + LIST_FILTER + '(|';
            req.params.uuid.split('+').forEach(function (id) {
                filter += sprintf(ID_FILTER, id);
            });
            filter += '))';
        }

        util.loadCustomers(req.ldap, filter, function (err, customers) {
            if (err)
                return next(err);

            if (!customers.length)
                return next(new restify.ResourceNotFoundError(req.params.id));

            var result;
            if (customers.length > 1) {
                result = customers;
                if (req.xml)
                    result = { customers: { customer: customers } };
            } else {
                result = customers[0];
                if (req.xml)
                    result = { customer: customers[0] };
            }

            log.debug('GetCustomer(%s) => %j', req.params.uuid, result);
            res.send(200, result);
            return next();
        });
    },


    update: function update(req, res, next) {
        assert.ok(req.customer);
        var log = req.log;

        log.debug('UpdateCustomer entered %j', req.params);

        if (req.params.customer) {
            if (typeof (req.params.customer) === 'object') {
                req.params = req.params.customer;
            } else if (typeof (req.params.customer) === 'string') {
                if (res._accept === 'application/json') {
                    try {
                        req.params = JSON.parse(req.params.customer);
                    } catch (e) {
                        return res.send([e.message]);
                    }
                }
            }
        }

        var changes = [];
        var address = [];
        var password = [];
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
                _key = 'cn';
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
            default:
                break;
            }
            if (!_key || !k || !req.params[k])
                return;

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
            if (password[0] !== password[1])
                return next(new restify.InvalidArgumentError('passwords do ' +
                                                             'not match'));

            changes.push(new Change({
                type: 'replace',
                modification: {
                    userpassword: [password[0]]
                }
            }));
        }

        if (address.length)
            changes.push(new Change({
                type: 'replace',
                modification: {
                    address: address
                }
            }));

        if (!changes.length)
            return next(new restify.MissingParameterError('no updates ' +
                                                          'specified'));

        var _dn = req.customer.dn.toString();
        return req.ldap.modify(_dn, changes, function (err) {
            if (err)
                return next(err);

            log.debug('UpdateCustomer(%s) => ok', req.params.id);
            return next();
        });
    },


    del: function del(req, res, next) {
        assert.ok(req.customer);
        assert.ok(req.ldap);

        var log = req.log;

        log.debug('DeleteCustomer(%s): entered', req.params.id);

        return req.ldap.del(req.customers.dn.toString(), function (err) {
            if (err)
                return next(err);

            log.debug('DeleteCustomer(%s) => gone', req.params.id);
            var change = {
                operation: 'delete',
                modification: {
                    uniquemember: req.customers.dn.toString()
                }
            };
            return req.ldap.modify(OPERATORS_DN, change, function () {
                // Ignore error, as it may not have existed in the group.
                res.send(200);
                return next();
            });
        });
    }

};
