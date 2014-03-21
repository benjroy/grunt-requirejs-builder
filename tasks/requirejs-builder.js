'use strict';

var _ = require('lodash');
var q = require('q');
var vm = require('vm');

var patternOpen = 'define\\( *(\'|")';
var patternClose = '(\'|") *,';

var REG_OPEN = new RegExp(patternOpen, 'g');
var REG_CLOSE = new RegExp(patternClose, 'g');
var REG_DEFINE = new RegExp(patternOpen + '[a-zA-Z0-9\\.\\-\\_]+' + patternClose, 'g');

module.exports = function (grunt) {
    var DEBUG = !!grunt.option('debug');


    grunt.registerTask('requirejs-builder', function () {
        //requires config
        grunt.config.requires('requirejs-builder');

        var SRC = grunt.config('requirejs-builder.src');
        var BUILD_PATH = grunt.config('requirejs-builder.target');
        var BASE_URL = grunt.config('requirejs-builder.baseUrl');
        var REQUIRE_CONFIG = grunt.config('requirejs-builder.requireConfig');
        var REQUIRE_CONFIG_OUTPUT = grunt.config('requirejs-builder.requireConfigOutput');

        q.resolve().then(function () {
            //copy named first-party modules.  output module names and target destinations

            var assets = grunt.file.expand(SRC);
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
            //extend paths into require config

            var requireConfigFile = grunt.file.read(REQUIRE_CONFIG);

            //extract base require config
            var context = {
                requirejs: {
                    config: function (_config) {
                        this.config = _config;
                    }
                },
                require: function () {}
            };
            vm.runInNewContext(requireConfigFile, context);
            var requireConfig = context.requirejs.config;

            //write baseUrl
            requireConfig.baseUrl = BASE_URL;

            _.each(paths, function (filePath, moduleName) {
                requireConfig.paths[moduleName] = '.' + filePath.slice(BUILD_PATH.length, -3);
            });

            return requireConfig;

        }).then(function (requireConfig) {
            //write a new require config file

            var builtRequireConfig = JSON.stringify(requireConfig, function (key, value) {
                if (typeof value === 'function') {
                    return '/*fn*/' + value.toString() + '/*fn*/';
                }
                return value;
            }, 4);
            //make function strings executable again after the stringify
            builtRequireConfig = builtRequireConfig.replace(/"\/\*fn\*\//g, '')
                    .replace(/\/\*fn\*\/"/g, '')
                    .replace(/\\n/g, '\n');

            //wrap src in requirejs.config call;
            builtRequireConfig = 'requirejs.config(' + builtRequireConfig + ');';
            //write it to the output path
            grunt.file.write(REQUIRE_CONFIG_OUTPUT, builtRequireConfig);

        }).nodeify(this.async());
    });
};
