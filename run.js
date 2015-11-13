'use strict';

var vasync = require('vasync');

var config = require('config');

var PluginsMgr = require('./plugins_mgr');

var backup = require('./backup');
var restore = require('./restore');

var glob = require('glob');
var path = require('path');

var plugins = [];

// Pre load the logger as a plugin
var loggerMod = require('./logger');
plugins.push(loggerMod);

glob.sync( './plugins/*.js' ).forEach(function(file) {
  var plugin = require(path.resolve(file));
  plugins.push(plugin);
});

console.log('Loaded ', plugins.length, ' plugins into application');

var pluginsMgr = new PluginsMgr(config);
pluginsMgr.use('config', config);

vasync.forEachPipeline({
  func: function(plugin, done){
    plugin(pluginsMgr, done);
  },
  inputs: plugins
}, function onDoneConfig(err) {
  var logger = pluginsMgr.get('logger');

  logger.trace('Loaded configuration', config);

  if (err) {
    logger.error('Unable to conplete configuration, aborting', err);

    return;
  }

  backup.waitForTrigger(config, pluginsMgr);
  restore.waitForTrigger(config, pluginsMgr);

  setTimeout(function () {
    logger.debug('Heartbeating');
    pluginsMgr.emit('control_bus', {name: 'backup:perform'});
  }, 1000);
});
