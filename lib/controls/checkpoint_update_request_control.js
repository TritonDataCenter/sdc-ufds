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

function CheckpointUpdateRequestControl(opts) {
    if (!opts) {
        opts = {};
    }

    opts.type = CheckpointUpdateRequestControl.OID;
    if (opts.value) {
        if (Buffer.isBuffer(opts.value)) {
            this.parse(opts.value);
        } else if (typeof (opts.value) === 'object') {
            if (typeof (opts.value.changenumber) !== 'number') {
                throw new TypeError('opts.value.changenumber must be number');
            }
            if (typeof (opts.value.dn) !== 'string') {
                throw new TypeError('opts.value.dn must be string');
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
CheckpointUpdateRequestControl.OID = '1.3.6.1.4.1.38678.1.1.5';
util.inherits(CheckpointUpdateRequestControl, Control);
module.exports = CheckpointUpdateRequestControl;


CheckpointUpdateRequestControl.prototype.parse = function parse(buffer) {
    assert.ok(buffer);

    var ber = new BerReader(buffer);
    if (ber.readSequence()) {
        this._value = {};
        this._value.changenumber = ber.readInt();
        this._value.dn = ber.readString(asn1.Ber.OctetString);
        return true;
    }

    return false;
};

CheckpointUpdateRequestControl.prototype._toBer = function _toBer(ber) {
    assert.ok(ber);

    if (!this._value) {
        return;
    }

    var writer = new BerWriter();
    writer.startSequence();
    writer.writeInt(this.value.changenumber);
    writer.writeString(this.value.dn, asn1.Ber.OctetString);
    writer.endSequence();

    ber.writeBuffer(writer.buffer, asn1.Ber.OctetString);
};

CheckpointUpdateRequestControl.prototype._json = function _json(obj) {
    obj.controlValue = this.value;
    return obj;
};
