'use strict';

var bunyan = require('bunyan');
var bunyanLogstash = require('bunyan-logstash-tcp');

module.exports = function init(pluginsMgr, done){
  var config = pluginsMgr.get('config');

  var logStreams = [
  ];

  var logLevel = 'TRACE';

  logLevel = config.has('log_level') && config.get('log_level');

  var logger = null;

  if (process.env.LOGSTASH_HOST) {

    logStreams.push({
      type: 'raw',
      level: logLevel,
      stream: bunyanLogstash.createStream({
        host: process.env.LOGSTASH_HOST,
        port: process.env.LOGSTASH_HOST || 9998,
        tags: ['json']
      })
    });
  }

  logStreams.push({
    level: logLevel,
    stream: process.stdout
  });

  logger = bunyan.createLogger({
    name: 'backup-env',
    streams: logStreams
  });

  process.nextTick(function (){

    pluginsMgr.use('logger', logger);

    done(null, logger);
  });
};
