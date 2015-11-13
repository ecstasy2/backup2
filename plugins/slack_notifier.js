'use strict';

var slackMod = require('slack-notify');
var vasync = require('vasync');
var _ = require('lodash');

var logger = null;

function doNotify(pluginsMgr, config, callback) {
  var notifications = pluginsMgr.buildNotifications();
  var slack = slackMod(config.get('slack.webhook_url'));

  var channel = config.get('slack.channel');
  var username = config.get('slack.username');

  var notifySlack = slack.extend({
    'channel': channel,
    'icon_emoji': ':computer:',
    'username': username
  });

  vasync.forEachParallel({
    func: sendNotification.bind(this, notifySlack),
    inputs: notifications
  }, callback);
};

function colorForError(code) {
  if (code === 'error') {
    return 'danger';
  } else if (code === 'warning') {
    return 'warning';
  } else if (code === 'success') {
    return 'good';
  }

  return '#000000';
}

function sendNotification(slack, input, callback) {
  var data = {};
  if (_.isString(input.message)) {
    data.text = input.message;
  }

  if (_.isArray(input.attachments)) {
    data.attachments = [];

    _.each(input.attachments, function each(item){
      var attach = {
        text: item.message,
        title: item.module,
        color: colorForError(item.type),
        fields: item.fields
      };

      data.attachments.push(attach);
    });
  }

  console.log(data);

  slack(data, callback);

}

module.exports = function init(pluginsMgr, done) {
  logger = pluginsMgr.get('logger');

  logger.debug('Initializing Slack Notifier plugin');
  process.nextTick(function() {
    done(null, null);
  });

  var config = pluginsMgr.get('config');

  var enabled = config.get('notify.slack.enabled') === 'true';
  var webhookUrl = config.get('notify.slack.webhook_url');

  if (enabled && webhookUrl) {
    pluginsMgr.on('notify:send', doNotify.bind(this, pluginsMgr));
  } else if (enabled) {
    logger.warn('You have Slack Notifier enabled but didn\'t provide your team WEBHOOK URL');
  } else {
    logger.warn('You have Slack Notifier is not enabled or WEBHOOK URL not provided');
  }
};
