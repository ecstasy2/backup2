'use strict';

var util = require('util');
var assert = require('assert');
var vasync = require('vasync');
var uuid = require('node-uuid');
var path = require('path');
var crypto = require('crypto');
var fs = require('fs');
var _ = require('lodash');
var assert = require('assert');
var Verror = require('verror');

var shelljs = require('shelljs');
var NotificationBuilder = require('./notification_builder');
var AsyncEventEmitter = require('async-eventemitter');

// TODO: Make sure that once the backup:* stage is over, no one can change the _backups fields
//       Any later stage module needs to make go through the provided api to change the manifest
//      or for the case of a storage module generate their own version of the manifest (with final files location)
function PluginsMgr() {
  // Initialize necessary properties from `EventEmitter` in this instance
  AsyncEventEmitter.call(this);

  var self = this;

  this.exts = {};
  this.notificationBuilders = [];
  this.defaultNotifier = null;

  this.publishedManifests = null;

  self.on('backup:perform', self.reset.bind(this));
  self.on('restore:perform', self.reset.bind(this));
}

// Inherit functions from `EventEmitter`'s prototype
util.inherits(PluginsMgr, AsyncEventEmitter);

// Called prior to each backup, use this to reset any state that should not be
// persisted across backups.
PluginsMgr.prototype.reset = function () {
  var self = this;

  this._backups = {};
  self.perModuleFileLocations = {};
  this.publishedManifests = {};

  this.notificationBuilders = [];
  this._hasErrors = false;
  this._hasWarnings = false;

  this.defaultNotifier = new NotificationBuilder();
  this.notificationBuilders.push(this.defaultNotifier);

  self.once('backup:post', this.onWriteManifest.bind(this));
};

PluginsMgr.prototype.onWriteManifest = function (config, done) {
  this.logger.info('Writing backup manifest files');

  this.writeManifest({appendManifest: true}, done);
};

// This file is called after all 'backup:post' plugin and writes the manifest file
// Into a temporary directory.
//
// When module is not 'core', it means a plugin wants a copy of the manifest with it
// own overrides applied. This is useful for storage step plugins
PluginsMgr.prototype.writeManifest = function (options, done) {
  var self = this;

  var defaults = {module: 'core', appendManifest: false};

  options = _.defaults({}, options, defaults);

  var collectorFolder = self.createTmpFolder();
  var manifestFile = path.join(collectorFolder, 'manifest.json');

  var manifest = {
    date: new Date(),
    timestamp: Math.round(new Date() / 1000),
    version: '1.0',
    backups: _.values(self._backups)
  };

  if (options.appendManifest) {
    self.pushBackups('core', [
      {
        type: 'manifest',
        files: [manifestFile]
      }
    ]);
  }

  // Each module can set override files for backup files for manifest generation
  // purpose. So apply the overrides to the backup file before writing the manifest
  var backups = _.values(this._backups);
  var backupOverrides = [];
  _.each(backups, function iterate(backupItem) {
    var newItem = _.assign(
      {},
      backupItem
    );

    if (self.perModuleFileLocations[options.module]) {
      var overrideFiles = self.perModuleFileLocations[options.module];

      _.each(newItem.files, function eachFile(file, index) {

        // This module overrode this file location, so use the new location
        if (overrideFiles[file]) {
          newItem.files[index] = overrideFiles[file];
        }
      });
    }

    if (newItem.type === 'manifest') {
      if (options.appendManifest) {
        backupOverrides.push(newItem);
      }
    }
    else {
      backupOverrides.push(newItem);
    }

  });

  // End of backups overrides application

  // use the potentially changed backups
  manifest.backups = backupOverrides;
  manifest.manifest = path.basename(manifestFile);

  fs.writeFile(manifestFile, JSON.stringify(manifest, null, 4), function(err) {

    if (err) {
      self.logger.error(err);
      return done(new Verror(err, 'Failed to write manifest file'));
    }

    done(null, manifestFile);
  });

};

PluginsMgr.prototype.createTmpFolder = function () {
  var osTempFolder = shelljs.tempdir();

  var newFolder = path.join(osTempFolder, 'edyn-backup', this._randomChars(15));
  shelljs.mkdir('-p', newFolder);

  return newFolder;
};


PluginsMgr.prototype.pushBackups = function (module, backups) {

  var self = this;
  _.each(backups, function iterate(item) {
    var backup = _.assign(
      {},
      item,
      {
        module: module,
        id: uuid.v1(),
        transformers: []
      }
    );

    self._backups[backup.id] = backup;
  });

  self.logger.trace('Pushed new backups', self._backups);
};

/**
* Iterate over all the files
*/
PluginsMgr.prototype.visitBackups = function visitBackups(visitor, onDone) {
  var self = this;

  var backups = _.values(this._backups);

  vasync.forEachParallel({
    func: function wrapper(backup, done) {
      visitor({

        // return a list of all files in a backup item
        files: function files() {
          return backup.files;
        },

        get: _.propertyOf(backup),

        addTransformer: function (transformer, options) {

          backup.transformers.push(
            _.assign({}, options, {
              type: transformer
            })
          );
        },

        // Change the path of a backup item
        updateFile: function (index, newPath){
          self._backups[backup.id].files[index] = newPath;
        }
      }, done);
    },
    inputs: backups
  }, onDone);
};

PluginsMgr.prototype.updateFileStorageLocation = function (module, filePath, location) {
  if (!this.perModuleFileLocations[module]) {
    this.perModuleFileLocations[module] = {};
  }

  this.perModuleFileLocations[module][filePath] = location;
};

PluginsMgr.prototype.publishManifest = function (module, manifestURI) {
  this.publishedManifests[module] = manifestURI;
};

PluginsMgr.prototype.getManifests = function () {
  // use this trick to make returned object imutable
  return _.assign({}, this.publishedManifests);
};

PluginsMgr.prototype.getNotifier = function (options) {

  if (!options) {
    return this.defaultNotifier;
  }

  var notifBuilder = new NotificationBuilder(options, this);
  this.notificationBuilders.push(notifBuilder);

  return notifBuilder;
};

PluginsMgr.prototype.buildNotifications = function () {
  var notifs = [];
  _.each(this.notificationBuilders, function collect(builder) {
    var built = builder.build();

    if (built) {
      notifs.push(built);
    }
  });

  return notifs;
};

PluginsMgr.prototype.setHasErrors = function() {
  this._hasErrors = true;
};

PluginsMgr.prototype.setHasWarnings = function() {
  this._hasWarnings = true;
};

PluginsMgr.prototype.hasErrors = function() {
  return this._hasErrors;
};

PluginsMgr.prototype.hasWarnings = function() {
  return this.hasWarnings;
};

PluginsMgr.prototype.notifyIfNeeded = function (mode, done) {
  var config = this.get('config');
  this.emit('notify:send', config.get('notify'), done);
};

PluginsMgr.prototype._randomChars = function(howMany) {
  var RANDOM_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

  var
    value = [],
    rnd = null;

  // make sure that we do not fail because we ran out of entropy
  try {
    rnd = crypto.randomBytes(howMany);
  } catch (e) {
    this.logger.warn('crypto.randomBytes not available, using crypto.pseudoRandomBytes', e);
    rnd = crypto.pseudoRandomBytes(howMany);
  }

  for (var i = 0; i < howMany; i++) {
    value.push(RANDOM_CHARS[rnd[i] % RANDOM_CHARS.length]);
  }

  return value.join('');
};

PluginsMgr.prototype.get = function get(name) {
  assert.ok(name, 'PluginsMgr.get() name cannot be null');
  assert.ok(this.exts[name], 'PluginsMgr.get() no such object');

  return this.exts[name];
};

PluginsMgr.prototype.use = function use(name, value) {
  assert.ok(name, 'PluginsMgr.use() name cannot be null');
  assert.ok(value, 'PluginsMgr.use() needs to be provided');

  if (name === 'logger') {
    this.logger = value;
  }

  this.exts[name] = value;
};

module.exports = PluginsMgr;
