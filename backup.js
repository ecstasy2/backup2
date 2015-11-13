'use strict';

var vasync = require('vasync');

var logger = null;

function handleFailedBackup(err) {
  logger.error('Unable to complete backup', err);
}

function doBackup(config, pluginsMgr){
  var backupConfig = config.get('backup');

  vasync.pipeline({
    funcs: [

      // Give opportunity to plugins to act before the backup start
      function preBackup(arg, callback) {
        pluginsMgr.emit('backup:pre', backupConfig, function onPreHooks(error){
          if (error) {

            // We don't need to wait for this to finish, so it doesn't need to
            // be asyncronous
            handleFailedBackup(error, 'backup:pre', pluginsMgr);
          }

          callback(error, null);
        });
      },

      // Time for backup plugins to act
      function backup(arg, callback) {
        pluginsMgr.emit('backup:perform', backupConfig, function onPreHooks(error){
          if (error) {

            // We don't need to wait for this to finish, so it doesn't need to
            // be asyncronous
            handleFailedBackup(error, 'backup:perform', pluginsMgr);
          }

          callback(error, null);
        });
      },

      // Give opportunity to plugins to act after the backup is a success
      function postBackup(arg, callback) {
        pluginsMgr.emit('backup:post', backupConfig, function onPreHooks(error){
          if (error) {

            // We don't need to wait for this to finish, so it doesn't need to
            // be asyncronous
            handleFailedBackup(error, 'backup:post', pluginsMgr);
          }

          callback(error, null);
        });
      },
      // Once the backup step is complete, we move to the storage step
      function postBackup(arg, callback) {
        pluginsMgr.emit('backup:store', backupConfig, function onPreHooks(error){
          if (error) {

            // We don't need to wait for this to finish, so it doesn't need to
            // be asyncronous
            handleFailedBackup(error, 'backup:store', pluginsMgr);
          }

          callback(error, null);
        });
      }
    ]
  }, function onPipelineComplet(error) {
    if (error) {
      logger.error('Backup pipeline completed with errors', error);
    } else {
      logger.info('Backup pipeline completed with success');
      logger.info('Starting notification step');
    }


    pluginsMgr.notifyIfNeeded(function handleNotifyStep(notifyError) {
      if (notifyError) {
        logger.error('Notification step completed with errors', error);
      }

      logger.info('Notification step pipeline completed successfuly');
    });

  });
}

module.exports.waitForTrigger = function waitForTriggerBackup(config, pluginsMgr){
  logger = pluginsMgr.get('logger');

  logger.debug('Initialising backup');

  pluginsMgr.on('control_bus', function onControlEvent(event, next){
    if (event.name === 'backup:perform') {
      doBackup(config, pluginsMgr);

      return next(new Error('Do not continue processing. I got this backup:do'));
    }

    next(null, null);
  });
};
