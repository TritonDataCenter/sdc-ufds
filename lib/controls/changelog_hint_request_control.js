// Copyright (c) 2014, Joyent Inc. All rights reserved.

var asn1 = require('asn1');
var assert = require('assert-plus');
var ldap = require('ldapjs');
var util = require('util');

///--- Globals

var Control = ldap.Control;
var BerReader = asn1.BerReader;
var BerWriter = asn1.BerWriter;

///--- API

function ChangelogHintRequestControl(opts) {
    if (!opts) {
        opts = {};
    }

    opts.type = ChangelogHintRequestControl.OID;
    if (opts.value) {
        if (Buffer.isBuffer(opts.value)) {
            this.parse(opts.value);
        } else if (typeof (opts.value) === 'object') {
            if (typeof (opts.value.changenumber) !== 'number') {
                throw new TypeError('opts.value.changenumber must be number');
            }
            if (typeof (opts.value.uuid) !== 'string') {
                throw new TypeError('opts.value.uuid must be string');
            }
            this._value = opts.value;
        } else {
            throw new TypeError('opts.value must be a Buffer or Object');
        }
        opts.value = null;
    }
    Control.call(this, opts);

    var self = this;
    this.__defineGetter__('value', function () {
        return self._value || {};
    });
}
ChangelogHintRequestControl.OID = '1.3.6.1.4.1.38678.1.1.3';
util.inherits(ChangelogHintRequestControl, Control);
module.exports = ChangelogHintRequestControl;


ChangelogHintRequestControl.prototype.parse = function parse(buffer) {
    assert.ok(buffer);

    var ber = new BerReader(buffer);
    if (ber.readSequence()) {
        this._value = {};
        this._value.changenumber = ber.readInt();
        this._value.uuid = ber.readString(asn1.Ber.Utf8String);
        return true;
    }

    return false;
};

ChangelogHintRequestControl.prototype._toBer = function _toBer(ber) {
    assert.ok(ber);

    if (!this._value) {
        return;
    }

    var writer = new BerWriter();
    writer.startSequence();
    writer.writeInt(this.value.changenumber);
    if (this.value.uuid) {
        writer.writeString(this.value.uuid, asn1.Ber.Utf8String);
    } else {
        writer.writeString('', asn1.Ber.Utf8String);
    }
    writer.endSequence();

    ber.writeBuffer(writer.buffer, asn1.Ber.OctetString);
};

ChangelogHintRequestControl.prototype._json = function _json(obj) {
    obj.controlValue = this.value;
    return obj;
};
