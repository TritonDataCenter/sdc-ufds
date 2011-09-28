// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');


var ldap = require('ldapjs');
var restify = require('restify');
var sprintf = require('sprintf').sprintf;
var uuid = require('node-uuid');

var util = require('./util');



///--- Globals

var LIST_FILTER = '(objectclass=sdcperson)';
var ID_FILTER = '(uuid=%s)';
var GET_FILTER = '(&' + ID_FILTER + LIST_FILTER + ')';
var FILTER = '(%s=%s)';
var WC_FILTER = '(%s=*%s*)';

var Change = ldap.Change;

var log = restify.log;



///--- API

module.exports = {

  list: function(req, res, next) {
    assert.ok(req.ldap);

    log.debug('ListCustomers: entered, params=%o', req.params);

    var reverse = false;
    var sort = false;
    var limit = false;
    var offset = false;
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
    var role_type = false;
    var keys = Object.keys(req.params);
    if (keys && keys.length) {
      filter = '(&';
      keys.forEach(function(k) {
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
          filter += '(objectclass=sdcperson)';
          role_type = req.params[k];
        default:
          break;
        }
      });
      filter += ')';
    } else {
      filter = LIST_FILTER;
    }

    var base = null;
    switch (role_type) {
    case '1':
      base = 'ou=customers, o=smartdc';
      break;
    case '2':
      base = 'ou=operators, o=smartdc';
      break;
    default:
      base = 'o=smartdc';
      break;
    }

    return util.loadCustomers(req.ldap, filter, function(err, customers) {
      if (err)
        return next(err);

      if (sort) {
        customers.sort(function(a, b) {
          function compare(a, b) {
            if (a[sort] < b[sort]) return -1;
            if (a[sort] > b[sort]) return 1;
            return 0;
          }

          var res = compare(a, b);
          if (reverse)
            res = res * -1;

          return res;
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


  create: function(req, res, next) {
    function sendError(errors) {
      if (req.xml) {
        errors = { errors: { error: errors } };
      } else {
        errors = { errors: errors };
      }
      res.send(409, errors);
      return next();
    }

    log.debug('CreateCustomer entered %o', req.params);

    var errors = [];

    if (req.params.customer) {
      if (typeof(req.params.customer) === 'object') {
        req.params = req.params.customer;
      } else if (typeof(req.params.customer) === 'string') {
        if (res._accept === 'application/json') {
          try {
            req.params = JSON.parse(req.params.customer);
          } catch (e) {
            return sendError([e.message]);
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
      return sendError(errors);

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

    var dn = sprintf('uuid=%s, ou=%s, o=smartdc',
                     customer.uuid[0],
                     (req.params.role && req.params.role === '2') ?
                     'operators' : 'customers');
    log.debug('CreateCustomer, saving: %s -> %o', dn, customer);
    return req.ldap.add(dn, customer, function(err) {
      if (err) {
        if (err instanceof ldap.EntryAlreadyExistsError) {
          return sendError(['Username is already taken']);
        } else if (err instanceof ldap.ConstraintViolationError) {
          return sendError([err.message + ' already exists']);
        } else {
          return sendError([err.toString()]);
        }
      }

      customer.dn = dn;
      customer = util.translateCustomer(customer);

      customer.forgot_password_code =
        util.forgotPasswordCode(customer.uuid[0]);

      if (req.xml)
        customer = { customer : customer };

      res.send(201, customer);
      return next();
    });
  },


  get: function(req, res, next) {
    log.debug('GetCustomer(%s) entered', req.uriParams.uuid);

    var filter;
    if (req.uriParams.uuid.indexOf('+') === -1)
      filter = sprintf(GET_FILTER, req.uriParams.uuid);

    if (!filter) {
      filter = '(&' + LIST_FILTER + '(|';
      req.uriParams.uuid.split('+').forEach(function(id) {
        filter += sprintf(ID_FILTER, id);
      });
      filter += '))';
    }

    util.loadCustomers(req.ldap, filter, function(err, customers) {
      if (err)
        return next(err);

      if (!customers.length)
        return next(new restify.ResourceNotFoundError(404, req.uriParams.id +
                                                     ' does not exist.'));

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

      log.debug('GetCustomer(%s) => %o', req.uriParams.uuid, result);
      res.send(200, result);
      return next();
    });
  },


  update: function(req, res, next) {
    assert.ok(req.customer);
    log.debug('UpdateCustomer entered %o', req.params);

    var errors = [];

    if (req.params.customer) {
      if (typeof(req.params.customer) === 'object') {
        req.params = req.params.customer;
      } else if (typeof(req.params.customer) === 'string') {
        if (res._accept === 'application/json') {
          try {
            req.params = JSON.parse(req.params.customer);
          } catch (e) {
            return sendError([e.message]);
          }
        }
      }
    }

    var changes = [];
    var address = [];
    var password = [];
    Object.keys(req.params).forEach(function(k) {
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
      };
      if (!_key)
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
      console.log('%j', password);
      if (password[0] !== password[1])
        return next(new restify.InvalidArgumentError(409,
                                                     'passwords do not match'));

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
      return next(new restify.MissingParameterError('no updates specified'));

    var _dn = req.customer.dn.toString();
    return req.ldap.modify(_dn, changes, function(err) {
      if (err)
        return next(new restify.InternalError(500, err.message));

      log.debug('UpdateCustomer(%s) => ok', req.uriParams.id);
      return next();
    });
  },


  del: function(req, res, next) {
    assert.ok(req.customer);
    assert.ok(req.ldap);

    log.debug('DeleteCustomer(%s): entered', req.uriParams.id);
    var filter = sprintf(GET_FILTER, req.uriParams.id)
    return req.ldap.del(req.customers.dn.toString(), function(err) {
      if (err)
        return next(new restify.UnknownError(500, err.message));

      log.debug('DeleteCustomer(%s) => gone', req.uriParams.id);
      res.send(200);
      return next();
    });
  }

};
