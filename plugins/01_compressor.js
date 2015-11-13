'use strict';

/**
* This plugin is responsible for moving all the files generated during a backup
* into the same folder, this is in preparation for a potential COMPRESSORS step
*/

var path = require('path');
var vasync = require('vasync');
var _ = require('lodash');
var Verror = require('verror');
var fs = require('fs');
var path = require('path');
var archiver = require('archiver');

var logger = null;

module.exports = function init(pluginsMgr, done) {
  logger = pluginsMgr.get('logger');

  logger.debug('Initializing compressor plugin');
  process.nextTick(function() {
    done(null, null);
  });

  pluginsMgr.on('backup:post', function compressFiles(arg, onCompressDone) {


    pluginsMgr.visitBackups(function visitor(backup, callback){
      var files = backup.files();
      var inputs = _.map(files, function map(value, index) {
        return index;
      });

      logger.debug('compressor plugin processing', files, backup);

      vasync.forEachParallel({
        func: function compressFileAt(index, onCompressed) {
          var file = files[index];

          logger.info('Compressing file %s', file);

          var basename = path.basename(file);
          var newLocation = path.join(path.dirname(file), basename + '.zip');

          var output = fs.createWriteStream(newLocation);
          var zipArchive = archiver('zip');

          output.on('close', function(err) {
            logger.debug('Compressing file %s to location %s completed', basename, newLocation);

            backup.updateFile(index, newLocation);
            backup.addTransformer('archive', {format: 'zip'});

            return onCompressed(null, null);
          });

          output.on('error', function(err) {
            logger.error('Compressing file %s to location %s failed', basename, newLocation, err);
            return onCompressed(new Verror(err, 'Unable to compress file %s into %', file, newLocation), null);
          });

          zipArchive.pipe(output);

          zipArchive.file(file, { name: basename });

          zipArchive.finalize();
        },
        inputs: inputs
      }, callback);

    }, function onVisitComplet(err, results){
      if (err) {
          return logger.debug('compressor plugin complete with error');
          return onCompressDone(err, null);
      }

      logger.info('compressor plugin complete');
      return onCompressDone(null, null);

    });
  });
}
