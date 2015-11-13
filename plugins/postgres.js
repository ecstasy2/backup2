'use strict';

var logger = null;
var vasync = require('vasync');
var _ = require('lodash');
var util = require('util');
var path = require('path');
var shelljs = require('shelljs');
var placeholders = require('./utils/placeholders');

function dumpQueryAsCSV(tmpFolder, input, done) {

  var destinationFile = path.join(tmpFolder, input.table + '.csv');
  logger.info('Dumping query ', input, destinationFile);

  var formattedWhere = placeholders.replace(input.where);

  var command = util.format(
    'psql -c "\\COPY (select * from %s WHERE %s) TO %s WITH CSV"',
    input.table,
    formattedWhere,
    destinationFile
  );

  logger.debug('Dumping with cmd', command);

  shelljs.exec(command, function onDumpComplete(code, output) {
    if (code) {
      logger.error('Unable to dump query', output);
      return done(new Error('Unable to dump query: ' + output), null);
    }

    // We were able to connect to the db
    done(null, {files: [destinationFile], table: input.table, format: 'csv'});
  });
}

function handleBackup(pluginsMgr, config, callback) {
  var tmpFolder = pluginsMgr.createTmpFolder();

  logger.info('Postgres backup starting on folder', tmpFolder);
  var schema = config.get('postgres.schema');
  var username = config.get('postgres.username');
  var password = config.get('postgres.password');
  var port = config.get('postgres.port');
  var host = config.get('postgres.host');
  var noSchemaDump = config.get('postgres.no_schema_dump');
  noSchemaDump = (noSchemaDump +'' === 'true');

  var data = {

  };

  var notifier = pluginsMgr.getNotifier({
    module: 'Postgres'
  });

  vasync.waterfall([
    function validateParams(done) {
      shelljs.env['PGPASSWORD'] = password;
      shelljs.env['PGUSER'] = username;
      shelljs.env['PGHOST'] = host;
      shelljs.env['PGDATABASE'] = schema;
      shelljs.env['PGPORT'] = port;

      shelljs.exec('psql -c "SELECT 1 AS one"', function onExecDone(code, output) {
        if (code) {
          logger.error('Unable to connect to the database. Server returned:', output);
          return done(new Error(output), null);
        }

        // We were able to connect to the db
        done(null, null);
      });


    },
    function dumpSchema(arg, done) {
      if (noSchemaDump) {
        logger.warn('PG_NO_SCHEMA_DUMP is set, skiping schema dump');

        // Do nothing
        return done(null, null);
      }

      var tableDataExcludes = [];
      var tableExcludes = [];

      if (config.has('postgres.skip_tables_data')) {
        var tables = config.get('postgres.skip_tables_data');
        _.each(tables, function iterate(tableName) {
          tableDataExcludes.push('--exclude-table-data=' + tableName);
        });
      }

      if (config.has('postgres.skip_tables')) {
        var skipTables = config.get('postgres.skip_tables');
        _.each(skipTables, function iterate(tableName) {
          tableExcludes.push('--exclude-table=' + tableName);
        });
      }

      var destinationFile = path.join(tmpFolder, 'schama.sql');

      var command = util.format(
        'pg_dump %s %s > %s',
        tableExcludes.join(' '),
        tableDataExcludes.join(' '),
        destinationFile
      );

      shelljs.exec(command, function onDumpComplete(code, output) {
        if (code) {
          logger.error('Unable to dump schema. Server returned:', output);
          return done(new Error('Unable to dump schema' + output), null);
        }

        data.schema = {
          files: [destinationFile]
        };

        logger.info('Done extracting schema', data.schema);

        // We were able to connect to the db
        done(null, null);
      });
    },
    function dumpExtraQueries(arg, done) {
      if (config.has('postgres.additional_queries')) {
        var queries = config.get('postgres.additional_queries');

        if (!_.isObject(queries)) {
          logger.error('postgres.additional_queries needs to be a hash object');
          return done(new Error('postgres.additional_queries needs to be a hash object'), null);
        }

        var inputs = [];

        _.each(Object.keys(queries), function iterate(key) {
          var query = queries[key];

          inputs.push(query);
        });

        vasync.forEachParallel({
          func: dumpQueryAsCSV.bind(this, tmpFolder),
          inputs: inputs
        }, function onQueriesDumped(error, results) {
          if (error) {
            return done(error, null);
          }

          data.queryDumps = [];

          _.each(results.successes, function iterate(singleResult) {
            data.queryDumps.push(singleResult);
          });

          return done(null, null);
        });
      }
    }
  ], function onComplete(error) {
    if (error) {
      logger.error('Postgres backup failed');

      notifier.error('Postgres backup failed');

      return callback(error, null);
    }

    logger.info('Postgres backup completed');

    var backups = [];

    // TODO: Support multiple schema dumps
    if (data.schema) {
      backups.push({
        type: 'schema',
        files: data.schema.files
      });
    }

    if (data.queryDumps) {
      _.each(data.queryDumps, function iterate(item) {
        var backupItem = _.assign({}, item, {type: 'query_dump'});
        backups.push(backupItem);
      });
    }

    pluginsMgr.pushBackups('postgres', backups);

    notifier.success('Postgres backup completed successfuly');
    callback(null, null);
  });
}

module.exports = function init(pluginsMgr, done) {
  logger = pluginsMgr.get('logger');

  logger.debug('Initializing postgres plugin');
  process.nextTick(function() {
    done(null, null);
  });

  var config = pluginsMgr.get('config');

  var enabled = config.get('backup.postgres.enabled') === 'true';

  if (enabled) {

    pluginsMgr.on('backup:perform', handleBackup.bind(this, pluginsMgr));
  }
};
