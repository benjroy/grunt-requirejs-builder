'use strict';

var _ = require('lodash');
var q = require('q');
var vm = require('vm');
var path = require('path');

var defineOpen = 'define\\( *(\'|")';
var defineClose = '(\'|") *,';
var REG_OPEN_DEFINE = new RegExp(defineOpen, 'g');
var REG_CLOSE_DEFINE = new RegExp(defineClose, 'g');
var REG_DEFINE = new RegExp(defineOpen + '[a-zA-Z0-9\\.\\-\\_]+' + defineClose, 'g');

var requireOpen = 'require\\( *\\[ *';
// var requireClose = '\\] *,';
var requireClose = '\\] *';
var REG_OPEN_REQUIRE = new RegExp(requireOpen, 'g');
var REG_CLOSE_REQUIRE = new RegExp(requireClose, 'g');
// var REG_REQUIRE = new RegExp(requireOpen + '[\\s\\S]+' + requireClose, 'g');
var REG_REQUIRE = new RegExp(requireOpen + '[^\\]]+' + requireClose, 'g');






module.exports = function (grunt) {
    var DEBUG = !!grunt.option('debug');
    var BUILD = true;

    grunt.registerTask('requirejs-builder', function () {
        //requires config
        grunt.config.requires('requirejs-builder.src');
        grunt.config.requires('requirejs-builder.base');
        grunt.config.requires('requirejs-builder.target');
        grunt.config.requires('requirejs-builder.baseUrl');
        grunt.config.requires('requirejs-builder.requireConfig');
        grunt.config.requires('requirejs-builder.requireConfigOutput');

        if (BUILD) {
            grunt.config.requires('requirejs-builder.optimizeOpts');
            var OPTIMIZE_OUTPUT_PATH = grunt.config('requirejs-builder.optimizeOpts').optimizeOutputPath;
            grunt.config.requires('requirejs-builder.build');
            console.log(grunt.config('requirejs-builder.build'));
        }

        var SRC = grunt.config('requirejs-builder.src');
        var BUILD_BASE = grunt.config('requirejs-builder.base');
        var BUILD_PATH = grunt.config('requirejs-builder.target');
        var BASE_URL = grunt.config('requirejs-builder.baseUrl');
        var REQUIRE_CONFIG = grunt.config('requirejs-builder.requireConfig');
        var REQUIRE_CONFIG_OUTPUT = grunt.config('requirejs-builder.requireConfigOutput');

        var modules = {
            lazy: [],
            entry: {}
        };

        q.resolve().then(function () {
            //copy named first-party modules.  output module names and target destinations

            var assets = grunt.file.expand(SRC);
            return _.reduce(assets, function (memo, filePath) {

                if (!grunt.file.isDir(filePath)) {
                    var file = grunt.file.read(filePath);
                    var targetPath = filePath.replace(BUILD_BASE, BUILD_PATH);
                    var namedDefineMatch = file.match(REG_DEFINE);
                    var requireMatch = file.match(REG_REQUIRE);
                    if (namedDefineMatch) {
                        var moduleName = namedDefineMatch[0].replace(REG_OPEN_DEFINE, '').replace(REG_CLOSE_DEFINE, '');
                        if (DEBUG) { grunt.log.ok('Writing "' + moduleName + '": ' + targetPath); }
                        grunt.file.copy(filePath, targetPath);
                        memo[moduleName] = targetPath;

                        if (requireMatch) {
                            // console.log('has lazy loaded modules', filePath);
                            // console.log('lazy matches', requireMatch);
                            var lazyMatchModuleNames = _.chain(requireMatch).map(function (match) {
                            // var lazyModuleNames = _.map(requireMatch, function (match) {
                                var strippedMatch = match.replace(REG_OPEN_REQUIRE, '').replace(REG_CLOSE_REQUIRE, '');
                                return _.map(strippedMatch.split(','), function (stripped) {
                                    return stripped.replace(/[\s]*('|")[\s]*/g, '');
                                });
                            }).flatten().value();

                            console.log('match', lazyMatchModuleNames);
                            modules.lazy.push(lazyMatchModuleNames);
                        }
                    } else if (requireMatch) {
                        // console.log('requireMatch entry module', filePath);
                        // console.log('requireMatch entry module target path', targetPath);
                        var moduleName = path.basename(filePath, '.js');
                        modules.entry[moduleName] = targetPath;
                        grunt.file.copy(filePath, targetPath);
                    } else {
                        // console.log('nomatch', filePath);
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

            return requireConfig;

        }).then(function (requireConfig) {
            //flatten and uniqueify the lazy loaded modules list
            modules.lazy = _.chain(modules.lazy).flatten().uniq().value();
            console.log(modules);
            // console.log('rconfig', _.values(requireConfig.paths));

            var requirejs = require('requirejs');
            var rjsOpts = {
                // logLevel: 0,
                mainConfigFile: REQUIRE_CONFIG_OUTPUT,
                baseUrl: BUILD_PATH,
                //onBuildWrite: A function that will be called for every write to an optimized bundle
                //of modules. This allows transforms of the content before serialization.
                // onBuildWrite: onBuildWrite,
                generateSourceMaps: false,
                preserveLicenseComments: false,
                // dir: OPTIMIZE_OUTPUT_PATH,
                out: function (text, sourceMapText) {
                    console.log('OUT!', text.length);
                },
                optimize: 'none',
                paths: {
                    filepicker: 'empty:'
                }
            };

            console.log('rjsOpts', rjsOpts);

            var included = [];
            var promises = [];

            _.each(modules.entry, function (filePath, moduleName) {
                var defer = q.defer();
                promises.push(defer.promise);

                // console.log('about to madge', moduleName, filePath);
                var out = filePath.replace(BUILD_PATH, OPTIMIZE_OUTPUT_PATH);
                // var name = filePath.replace(BUILD_BASE + '/', '');
                // var name = path.basename(filePath.replace(BUILD_BASE + '/', ''), '.js');
                // var relativePath = filePath.replace(BUILD_PATH, '');
                var relativePath = path.relative(BUILD_PATH, filePath);
                var name = path.join(path.dirname(relativePath), path.basename(relativePath, '.js'));
                // console.log('out', name);
                var opts = _.clone(rjsOpts);
                _.extend(opts, {
                    // out: out,
                    name: name,
                    onModuleBundleComplete: function (data) {
                        // console.log('module bundle complete', data.included.length, data);
                        included.push(data.included);
                    },
                });
                // var dependencyTree = madge(filePath, { format: 'amd', 'require-config': REQUIRE_CONFIG_OUTPUT });
                // console.log('depTree', dependencyTree);
            
                requirejs.optimize(opts, defer.resolve, defer.reject);
            });

            return q.all(promises).then(function () {
                var common = _.intersection.apply(null, included);

                var counts = _.reduce(_.flatten(included), function (memo, item) {
                    memo[item] = (memo[item] || 0) + 1;
                    return memo;
                }, {});

                // console.log('ALL INCLUDED', counts);

                _.each(requireConfig.paths, function (relPath, moduleName) {
                    var absPath = path.resolve(BUILD_PATH, relPath) + '.js';
                    if (counts[absPath] > 1) {
                        console.log(counts[absPath], moduleName);
                    }
                });

                return included;
            });

        }).nodeify(this.async());
    });
};
