/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var util = require('util');

var Validator = require('../lib/schema/validator');



///--- API

function Comment() {
    Validator.call(this, {
        name: 'comment',
        required: {
            commentid: 1,
            author_uuid: 1,
            body: 1
        }
    });
}
util.inherits(Comment, Validator);



///--- Exports

module.exports = {
    createInstance: function createInstance() {
        return new Comment();
    }
};
