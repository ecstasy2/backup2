'use strict';

var _ = require('lodash');

function addTimeVars(variables) {
  var NOW = Math.round(new Date()/1000);

  var A_DAY = 3600 * 24;
  var A_WEEK = A_DAY * 7;

  variables['NOW'] = NOW;
  variables['ONE_DAY_AGO'] = NOW - A_DAY;
  variables['MONTH_AGO'] = NOW - A_DAY * 30;
  variables['A_YEAR_AGO'] = NOW - A_DAY * 365;

  for(var days = 2; days < 365; days++){
    variables['Y_' + days + '_DAYS_AGO'] = NOW - A_DAY * days;
  }

  variables['ONE_HOUR_AGO'] = NOW - 3600;
  for(var hours = 2; hours <= 24; hours++){
    variables['Y_' + hours + '_HOURS_AGO'] = NOW - 3600 * hours;
  }

  variables['WEEK_AGO'] = NOW - A_WEEK;
  for(var weeks = 2; weeks <= 52; weeks++){
    variables['Y_' + weeks + '_WEEKS_AGO'] = NOW - A_WEEK * weeks;
  }

}

function getVars(sqlSafe) {
  var variables = {};

  addTimeVars(variables);

  _.each(process.env, function iterate(value, key) {
    if (_.startsWith(key, 'Y_')) {
      var varName = key.substr(2);
      var varValue = value;

      if (sqlSafe) {
        varValue = sanitize(varValue);
      }

      variables[varName] = varValue;
    }
  });

  return variables;
}

// TODO: implement this
function sanitize(arg) {
  return arg;
}

module.exports.replace = function replace(string, sqlSafe) {
  sqlSafe = sqlSafe || true;

  var templateStr = string.replace(/\$(\w+)/g, function replacer(match, varName) {

    return '<%= ' + varName + '%>'
  });

  console.log(templateStr, getVars(sqlSafe))

  var compiledTpl = _.template(templateStr);

  return compiledTpl(getVars(sqlSafe))
}
