 // Copyright (c) 2014, Joyent, Inc. All rights reserved.


var ldap = require('ldapjs');

function Checkpoint(opts) {
    assert.object(opts, 'opts');
    assert.object(opts.replicator, 'opts.replicator');
    assert.string(opts.url, 'opts.url');
    assert.arrayOfString(opts.queries, 'opts.queries');
}
