/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var assert = require('assert');
var sprintf = require('util').format;

var restify = require('restify');


var util = require('./util');



// --- Globals

var BadRequestError = restify.BadRequestError;

// --- API

module.exports = {

    getSalt: function getSalt(req, res, next) {
        assert.ok(req.ufds);

        var log = req.log;

        log.debug({login: req.params.uuid}, 'GetSalt: entered');

        assert.ok(req.customer);

        res.send(200, { salt: req.customer._salt });

        return next();
    },


    login: function login(req, res, next) {
        assert.ok(req.ufds);

        var log = req.log;

        log.debug({params: req.params}, 'Login: entered');

        if (!req.params.login) {
            return next(new BadRequestError('login is required'));
        }
        if (!req.params.digest) {
            return next(new BadRequestError('digest is required'));
        }

        assert.ok(req.customer);

        var result = null;
        if (req.customer.userpassword === req.params.digest) {
            result = util.translateCustomer(req.customer);
            if (req.accepts('application/xml')) {
                result = { customer: result };
            }
        }

        log.debug({
            login: req.params.login,
            result: result || {}
        }, 'Login: done');

        res.send(200, result);
        return next();



    },

    forgotPassword: function forgotPassword(req, res, next) {
        assert.ok(req.ufds);

        var log = req.log;

        log.debug({params: req.params}, 'ForgotPassword: entered');

        if (!req.params.email) {
            return next(new BadRequestError('email is required'));
        }

        req.ufds.getUserByEmail(req.params.email, function (err, user) {
            console.dir(err);
            console.dir(user);
            if (err) {
                return next(err);
            }
            var customers = [util.translateCustomer(user)];
            if (req.accepts('application/xml')) {
                customers = { customers: customers };
            }

            log.debug({
                email: req.params.email,
                customers: customers || {}
            }, 'ForgotPassword: done');
            res.send(200, customers);
            return next();
        });
    }

};
