'use strict';

var logger = null;
var vasync = require('vasync');
var util = require('util');
var path = require('path');
var shelljs = require('shelljs');

/*
* Backing up redis works as follow
*
* NOTE: Always call FLUSHALL on the dummy redis we will use
*
*
* We need to have a running redis server that we configure to be a slave of the
* redis instance we want to backup. Then we enter a poling mechanism where we basicaly
* wait for REDIS INFO command to return a master_sync_left_bytes that is low enough < 100kb configurable
* this is to avoid situations where the backup never complete since there are always incoming data bein synced
*
* At this point we will call BGSAVE to force REDIS to write the db to DISK.
* We check the completion of this operation by polling until the bellow condition is true
*
* `LASTSAVE > (timestamp when BGSAVE was issued) AND LASTSAVE > now() - (INFO SERVER .uptime_in_seconds)`
*
* When that condition become true, it mean the sync is complete and we just have to copy the redis.rdb file
*/
function handleBackup(pluginsMgr, config, onBackupDone) {
  function makeRedisCmd(cmd) {
    // redis-cli -h dummy_host -p dummy_port CMD
    var command = util.format(
      '%s -h %s -p %s %s',
      config.get('redis.redis_cli'),
      config.get('redis.host'),
      config.get('redis.port'),
      cmd
    );

    return command;
  }

  var notifier = pluginsMgr.getNotifier({
    module: 'Redis'
  });

  vasync.pipeline({
    funcs: [
      function flushDummyDb(arg, callback) {
        logger.info('Running redis-cli --rdb');

        var tmpFolder = pluginsMgr.createTmpFolder();
        var destinationFile = path.join(tmpFolder, 'dump.rdb');

        shelljs.exec(makeRedisCmd('--rdb ' + destinationFile), function onDumpComplete(code, output) {
          var failed = output.indexOf('Transfer finished with success.') === -1;
          if (code || failed) {
            logger.error('--rdb failed', output);
            return callback(new Error('--rdb failed: ' + output), null);
          }

          var backups = [];

          backups.push({
            type: 'dump',
            files: [destinationFile]
          });

          pluginsMgr.pushBackups('redis', backups);

          return callback(null, destinationFile);
        });
      }
    ]
  }, function onPipelineDone(error) {
    if (error) {

      notifier.error('Backup failed');
      return onBackupDone(error, null);
    }

    notifier.success('Backup completed successfuly');
    return onBackupDone(null, null);
  });
};

module.exports = function init(pluginsMgr, done) {
  logger = pluginsMgr.get('logger');
  var config = pluginsMgr.get('config');

  logger.debug('Initializing postgres plugin');
  process.nextTick(function() {
    done(null, null);
  });

  var enabled = config.get('backup.redis.enabled') === 'true';
  if (enabled) {
    pluginsMgr.on('backup:perform', handleBackup.bind(this, pluginsMgr));
  }
};
