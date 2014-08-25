/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var assert = require('assert');
var fs = require('fs');
var path = require('path');


function runTests(directory) {
    fs.readdir(directory, function (err, files) {
        assert.ifError(err);

        files.filter(function (f) {
            return (/\.test\.js$/.test(f));
        }).map(function (f) {
            return (path.join(directory, f));
        }).forEach(require);
    });
}

///--- Run All Tests

(function main() {
    runTests(__dirname);
    runTests(path.join(__dirname, 'capi'));
})();
