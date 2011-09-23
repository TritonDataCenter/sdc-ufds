// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');

var restify = require('restify');
var sprintf = require('sprintf').sprintf;

var util = require('./util');



///--- Globals

var GET_FILTER = '(&(objectclass=sdcperson)(login=%s))';
var LOGIN_FILTER = '(&(objectclass=sdcperson)(login=%s))';
var EMAIL_FILTER = '(&(objectclass=sdcperson)(email=%s))';

var log = restify.log;



///--- API

module.exports = {

  getSalt: function(req, res, next) {
    assert.ok(req.ldap);

    log.debug('GetSalt(%s): entered', req.uriParams.login);
    var filter = sprintf(GET_FILTER, req.uriParams.login)
    util.loadCustomers(req.ldap, filter, false, function(err, customers) {
      if (err)
        return next(err);

      if (!customers.length)
        return next(new restify.ResourceNotFoundError(404, req.uriParams.login +
                                                     ' does not exist'));

      res.send(200, { salt: customers[0]._salt });
      return next();
    });
  },


  login: function(req, res, next) {
    assert.ok(req.ldap);

    log.debug('Login: entered params=%o', req.params);

    if (!req.params.login)
      return next(new restify.MissingParameterError(400, 'login is required'));
    if (!req.params.digest)
      return next(new restify.MissingParameterError(400, 'digest is required'));

    var filter = sprintf(LOGIN_FILTER, req.params.login);

    function callback(err, customers) {
      if (err)
        return next(err);

      if (!customers.length)
        return next(new restify.ResourceNotFoundError(404, req.params.login +
                                                      ' does not exist'));

      var result = null;
      if (customers[0].userpassword === req.params.digest) {
        result = util.translateCustomer(customers[0]);
        if (req.xml)
          result = { customer: result };
      }

      log.debug('Login(%s): => %o', req.params.login, result || {});
      res.send(200, result);
      return next();

    }

    return util.loadCustomers(req.ldap, filter, false, callback);
  },

  forgotPassword: function(req, res, next) {
    assert.ok(req.ldap);

    log.debug('ForgotPassword: entered params=%o', req.params);

    if (!req.params.email)
      return next(new restify.MissingParameterError('email is required'));

    var filter = sprintf(EMAIL_FILTER, req.params.email);

    function callback(err, customers) {
      if (err)
        return next(err);

      if (!customers.length)
        return next(new restify.ResourceNotFoundError(req.params.email +
                                                      ' does not exist'));

      if (req.xml)
        result = { customers: customers };

      log.debug('ForgotPassword(%s): => %o', req.params.email, result || {});
      res.send(200, result);
      return next();
    }

    return util.loadCustomers(req.ldap, filter, callback);
  }

};
