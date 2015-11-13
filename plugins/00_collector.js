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

var logger = null;

module.exports = function init(pluginsMgr, done) {
  logger = pluginsMgr.get('logger');

  logger.debug('Initializing collector plugin');
  process.nextTick(function() {
    done(null, null);
  });

  pluginsMgr.on('backup:post', function collectFiles(arg, onCollectionComplete) {

    var collectorFolder = pluginsMgr.createTmpFolder();

    pluginsMgr.visitBackups(function visitor(backup, callback){
      var files = backup.files();
      var inputs = _.map(files, function map(value, index) {
        return index;
      });

      logger.debug('collector plugin processing', files, backup);

      vasync.forEachParallel({

        // TODO: extract this function for reuse
        func: function moveFileAtIndex(index, onMoved) {
          var file = files[index];

          var basename = path.basename(file);
          var newLocation = path.join(collectorFolder, basename);

          fs.rename(file, newLocation, function (err, res) {
            if (err) {
              logger.error('unable to move file %s to location %s', basename, newLocation);
              return onMoved(new Verror(err, 'Unable to move file %s to %', file, newLocation), null);
            }

            logger.debug('Moved file %s to location %s', basename, newLocation);

            backup.updateFile(index, newLocation);

            return onMoved(err, res);
          });
        },
        inputs: inputs
      }, callback);

    }, function onVisitComplet(err){
      if (err) {
          return logger.debug('collector plugin complete with error');
          return onCollectionComplete(err, null);
      }

      logger.info('collector plugin complete');
      return onCollectionComplete(null, null);
    });
  });
};
