// Copyright 2011 Mark Cavage, Inc.  All rights reserved.

var fs = require('fs');

var ldap = require('ldapjs');
var log4js = require('log4js');


///--- Globals

var OperationsError = ldap.OperationsError;
var log = log4js.getLogger('schema');


///--- API

module.exports = {

  /**
   * Loads all the `.json` files in a directory, and parses them.
   *
   * @param {String} directory the directory of *.schema files to load.
   * @param {Function} callback of the form f(err, attributes, objectclasses).
   * @return {Object} schema map of name -> schema.
   * @throws {TypeEror} on bad input.
   */
  loadDirectory: function loadDirectory(directory, callback) {
    if (!directory || typeof(directory) !== 'string')
      throw new TypeError('directory (string) required');
    if (!callback || typeof(callback) !== 'function')
      throw new TypeError('callback (function) required');

    fs.readdir(directory, function(err, files) {
      if (err)
        return callback(err);

      var finished = 0;
      var foundFiles = false;
      var schema = {};
      files.forEach(function(f) {
        if (!/\.json$/.test(f)) {
          ++finished;
          return;
        }
        foundFiles = true;

        var file = directory + '/' + f;
        log.info('Loading schema file: %s', file);
        fs.readFile(file, 'utf8', function(err, data) {
          if (err)
            return callback(err);

          try {
            var s = JSON.parse(data);
            if (!s.name)
              return callback(new OperationsError(f + ' does not have a name: '
                                                  + data));

            schema[s.name] = s;
          } catch (e) {
            return callback(new OperationsError(f + ': ' + e.message));
          }

          if (++finished >= files.length)
            return callback(null, schema);
        });
      });

      if (!foundFiles)
        return callback(new OperationsError('no schema files found'));
    });
  }

};
