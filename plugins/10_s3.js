'use strict';

/**
* This plugin is responsible for moving all the files generated during a backup
* into the same folder, this is in preparation for a potential COMPRESSORS step
*/

var path = require('path');
var vasync = require('vasync');
var _ = require('lodash');
var VError = require('verror');
var fs = require('fs');
var path = require('path');
var dateFormat = require('dateformat');

var logger = null;

function uploadFile(options, done) {
  var AWS = require('aws-sdk');

  var bucketName = options.bucketName;
  var region = options.region;
  var key = options.key;
  var file = options.file;

  var body = fs.createReadStream(file);

  logger.debug('S3 uploading file', {file: file, key: key});

  var s3obj = new AWS.S3({region: region, params: {Bucket: bucketName, Key: key}});
  s3obj.upload({Body: body}, function onUploaded(error, res) {
    if (error) {
      return done(new VError(error, error.message));
    }

    return done(null, res.Location);
  });
}

module.exports = function init(pluginsMgr, done) {
  logger = pluginsMgr.get('logger');

  logger.debug('Initializing s3 plugin');
  process.nextTick(function() {
    done(null, null);
  });

  pluginsMgr.on('backup:store', function compressFiles(config, onUploadDone) {
    uploadFilesToS3(config, onUploadDone);
  });

  function uploadFilesToS3(config, onUploadDone) {
    var bucketName = config.get('s3.bucket');
    var awsRegion = config.get('s3.region');
    var manifestTag = config.get('s3.latest-tag');

    var TODAY = dateFormat(new Date(), 'yyyymmddhMM');

    var notifier = pluginsMgr.getNotifier({
      module: 'S3'
    });

    pluginsMgr.visitBackups(function visitor(backup, callback){

      // Since this plugin store it data to S3, the manifest as it is is not suitable for
      // for storage. Instead we would have to overide the manifest to contains S3 URLs once
      // all files are uploaded
      if (backup.get('type') === 'manifest') {
        logger.debug('s3 skiping manifest file');

        return callback(null, null);
      }

      var files = backup.files();
      var inputs = _.map(files, function map(value, index) {
        return index;
      });

      logger.debug('S3 plugin processing', files, backup);
      backup.addTransformer('web', {cloud: 's3'});

      vasync.forEachParallel({
        func: function(index, onSingleUploaded) {

          var file = files[index];
          var basename = TODAY + '-' + path.basename(file);

          logger.info('Storing file %s in S3', basename);

          uploadFile({
            bucketName: bucketName,
            region: awsRegion,
            key: basename,
            file: file
          }, function(error, location) {

            if (error) {
              return onSingleUploaded(error, null);
            }

            pluginsMgr.updateFileStorageLocation('s3', file, location);

            return onSingleUploaded(null, null);
          });

        },
        inputs: inputs
      }, callback);

    }, function onVisitComplet(err){
      if (err) {
          logger.debug('s3 plugin completed with error', err);
          return onUploadDone(err, null);
      }

      // TODO: Only upload the manifest at the end if actualy something were backed-up
      pluginsMgr.writeManifest({module: 's3'}, function onManifest(manifestError, manifestPath){
        logger.info('S3 uploading manifest file');
        if (manifestError) {
          logger.error('s3 plugin completed with error');
          return onUploadDone(new VError(manifestError, 'Unable to write manifest file'), null);
        }

        logger.info('S3 upoloading manifest file', manifestPath);
        vasync.parallel({
          'funcs': [
            function writeVersionedManifest(callback) {
              uploadFile({
                bucketName: bucketName,
                region: awsRegion,
                key: TODAY + '-' + 'manifest.json',
                file: manifestPath
              }, function(manifUploadError, location){
                if (manifUploadError) {
                  return callback(manifUploadError, null);
                }

                pluginsMgr.publishManifest('s3', location);

                callback(null, null);
              });
            },

            function writeTaggedManifest(callback) {
              uploadFile({
                bucketName: bucketName,
                region: awsRegion,
                key: manifestTag + '-' + 'manifest.json',
                file: manifestPath
              }, function(manifUploadError, location){
                if (manifUploadError) {
                  notifier.warn('Unable to upload tagged manifest');

                  return callback(manifUploadError, null);
                }

                pluginsMgr.publishManifest('s3', location);

                callback(null, null);
              });
            }
          ]
        }, function onUploadManifest(manifUploadError) {
          if (manifUploadError) {
            return onUploadDone(manifUploadError, null);
          }

          onUploadDone(null, null);
        });
      });

    });
  }
};
