'use strict';

// This plugin is only intersted in backup, not restore
// It publish in an SNS topic all published manifests resulting from
// This backup
// If the backup fail, we send all the notification messages as JSON
var AWS = require('aws-sdk');
var _ = require('lodash');

var logger = null;

function doNotify(pluginsMgr, config, callback) {
  var notifications = pluginsMgr.buildNotifications();
  var topicArn = config.get('sns.topic_arn');
  var region = config.get('sns.region');

  var jsonBody = {};
  var messages = {};

  jsonBody.messages = messages;
  jsonBody.action = 'tools:backup-restore:backup:complete';

  _.each(notifications, function collect(input){
    if (!messages[input.module]) {
      messages[input.module] = [];
    }

    messages[input.module].push(input);
  });

  if (!pluginsMgr.hasErrors()) {
    jsonBody.result = pluginsMgr.getManifests();
  }

  var params = {
    'Message': JSON.stringify(jsonBody),
    'TopicArn': topicArn
  };

  var sns = new AWS.SNS({
    region: region
  });

  sns.publish(params, function(err, data) {
    if (err) {
      logger.error('Failed to publish message to AWS SNS topic', err);
      return callback(err, null);
    }

    logger.debug('Result from AWS SNS', data);
    callback(null, null);
  });
};

module.exports = function init(pluginsMgr, done) {
  logger = pluginsMgr.get('logger');

  logger.debug('Initializing Slack Notifier plugin');
  process.nextTick(function() {
    done(null, null);
  });

  var config = pluginsMgr.get('config');

  var enabled = config.get('notify.sns.enabled') === 'true';
  var topicArn = config.get('notify.sns.topic_arn');

  if (enabled && topicArn) {
    pluginsMgr.on('notify:send', doNotify.bind(this, pluginsMgr));
  } else if (enabled) {
    logger.warn('You have SNS Notifier enabled but didn\'t provide SNS Topic ARN');
  } else {
    logger.warn('SNS Notifier is not enabled or SNS Topic ARN not provided');
  }
};
