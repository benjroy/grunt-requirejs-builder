'use strict';

var _ = require('lodash');
var q = require('q');
var path = require('path');

var patternOpen = 'define\\( *(\'|")';
var patternClose = '(\'|") *,';

var REG_OPEN = new RegExp(patternOpen, 'g');
var REG_CLOSE = new RegExp(patternClose, 'g');
var REG_DEFINE = new RegExp(patternOpen + '[a-zA-Z0-9\\.\\-\\_]+' + patternClose, 'g');
var BUILD_FOLDER = '_build';
var BUILD_PATH = path.join('public', BUILD_FOLDER);
var PATHS_MAP_TARGET = path.join(BUILD_PATH, '_auto-paths.js');

module.exports = function (grunt) {
    var DEBUG = !!grunt.option('debug');

    grunt.registerTask('requirejsPaths', function () {
        q.resolve().then(function () {

            //copy named first-party modules.  output module names and target destinations
            var assets = grunt.file.expand(['public/javascripts/**/*.js']);
            return _.reduce(assets, function (memo, filePath) {

                if (!grunt.file.isDir(filePath)) {
                    var file = grunt.file.read(filePath);
                    var targetPath = filePath.replace('public', BUILD_PATH);
                    var namedDefineMatch = file.match(REG_DEFINE);
                    if (namedDefineMatch) {
                        var moduleName = namedDefineMatch[0].replace(REG_OPEN, '').replace(REG_CLOSE, '');
                        if (DEBUG) { grunt.log.ok('Writing "' + moduleName + '": ' + targetPath); }
                        grunt.file.copy(filePath, targetPath);
                        memo[moduleName] = targetPath;
                    }
                } else {
                    if (DEBUG) { grunt.log.error('Directory: ' + filePath); }
                }

                return memo;

            }, {});
        }).then(function (paths) {
            //write the paths output to a file
            var relativePaths = {};
            _.each(paths, function (filePath, moduleName) {
                relativePaths[moduleName] = '.' + filePath.slice(BUILD_PATH.length, -3);
            });

            grunt.file.write(PATHS_MAP_TARGET, 'var _bt = _bt || {};\n_bt.baseUrl = \'' + BUILD_FOLDER + '\';\n_bt.paths = ' + JSON.stringify(relativePaths, null, 4) + ';');

            if (DEBUG) { grunt.log.ok('require paths: ' + JSON.stringify(relativePaths, null, 4)); }
        }).then(function () {
            //write a new require config file

            // var sandboxContext = {
            //     requirejs: {
            //         config: function (_config) {
            //             this._config = _config;
            //         }
            //     },
            //     require: function () {}
            // };
            // var requireConfig = fs.readFileSync('public/javascripts/require-config.js', 'utf8');
            // vm.runInNewContext(requireConfig, sandboxContext);
            // requireConfig = sandboxContext.requirejs.requireConfig;
            // var BASE_PATH = 'javascripts'
            // var requirePaths = _.map(_.values(_config.paths), function (relPath) {
            //     return path.join(BASE_PATH, relPath + '.js');
            // });

            // console.log('config?', requirePaths);

        }).then(function () {


        }).nodeify(this.async());
    });
};
