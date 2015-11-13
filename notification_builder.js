'use strict';

var _ = require('lodash');

function Builder(options, pluginsMgr) {
  var defaults = {
    'module': 'Notifier'
  };

  if (!_.isObject(options)) {
    options = {};
  }

  this.options = _.defaults(options, defaults);
  this.message = null;
  this.pluginsMgr = pluginsMgr;

  this.notifs = [];
}

Builder.prototype.error = function (message, fields) {
  this.notifs.push({
    'message': message,
    'fields': fields,
    'type': 'error'
  });

  this.pluginsMgr.setHasErrors();
};

Builder.prototype.success = function (message, fields) {
  this.notifs.push({
    'message': message,
    'fields': fields,
    'type': 'success'
  });
};

Builder.prototype.warning = function (message, fields) {
  this.notifs.push({
    'message': message,
    'fields': fields,
    'type': 'warning'
  });

  this.pluginsMgr.setHasWarnings();
};

Builder.prototype.build = function () {
  var self = this;

  var built = {};

  if (this.message) {
    built.message = this.message;
  }

  if (this.notifs.length) {
    built.attachments = _.map(this.notifs, function each(att) {
      var ret = _.defaults({}, self.options, {fields: []}, att);
      return ret;
    });
  }

  if (_.values(built).length === 0) {
    return null;
  }

  return built;
};

module.exports = Builder;
