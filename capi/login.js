// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');

var restify = require('restify');
var sprintf = require('sprintf').sprintf;

var util = require('./util');



///--- Globals

var GET_FILTER = '(&(objectclass=sdcperson)(login=%s))';
var LOGIN_FILTER = '(&(objectclass=sdcperson)(login=%s))';
var EMAIL_FILTER = '(&(objectclass=sdcperson)(email=%s))';

var BadRequestError = restify.BadRequestError;
var ResourceNotFoundError = restify.ResourceNotFoundError;


///--- API

module.exports = {

    getSalt: function getSalt(req, res, next) {
        assert.ok(req.ldap);

        var log = req.log;

        log.debug('GetSalt(%s): entered', req.params.login);
        var filter = sprintf(GET_FILTER, req.params.login);
        util.loadCustomers(req.ldap, filter, false, function (err, customers) {
            if (err)
                return next(err);

            if (!customers.length)
                return next(new ResourceNotFoundError(req.params.login));

            res.send(200, { salt: customers[0]._salt });
            return next();
        });
    },


    login: function login(req, res, next) {
        assert.ok(req.ldap);

        var log = req.log;

        log.debug('Login: entered params=%o', req.params);

        if (!req.params.login)
            return next(new BadRequestError('login is required'));
        if (!req.params.digest)
            return next(new BadRequestError('digest is required'));

        var filter = sprintf(LOGIN_FILTER, req.params.login);

        function callback(err, customers) {
            if (err)
                return next(err);

            if (!customers.length)
                return next(new ResourceNotFoundError(req.params.login));

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

    forgotPassword: function forgotPassword(req, res, next) {
        assert.ok(req.ldap);

        var log = req.log;

        log.debug('ForgotPassword: entered params=%o', req.params);

        if (!req.params.email)
            return next(new BadRequestError('email is required'));

        var filter = sprintf(EMAIL_FILTER, req.params.email);

        function callback(err, customers) {
            if (err)
                return next(err);

            if (!customers.length)
                return next(new ResourceNotFoundError(req.params.email));

            if (req.xml)
                customers = { customers: customers };

            log.debug('ForgotPassword(%s): => %j', req.params.email,
                      customers || {});
            res.send(200, customers);
            return next();
        }

        return util.loadCustomers(req.ldap, filter, callback);
    }

};
