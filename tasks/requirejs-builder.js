'use strict';

var _ = require('lodash');
var q = require('q');
var vm = require('vm');
var path = require('path');
var requirejs = require('requirejs');

var defineOpen = 'define\\( *(\'|")';
var defineClose = '(\'|") *,';
var REG_OPEN_DEFINE = new RegExp(defineOpen, 'g');
var REG_CLOSE_DEFINE = new RegExp(defineClose, 'g');
var REG_DEFINE = new RegExp(defineOpen + '[a-zA-Z0-9\\.\\-\\_]+' + defineClose, 'g');

var requireOpen = 'require\\( *\\[ *';
var requireClose = '\\] *';
var REG_OPEN_REQUIRE = new RegExp(requireOpen, 'g');
var REG_CLOSE_REQUIRE = new RegExp(requireClose, 'g');
var REG_REQUIRE = new RegExp(requireOpen + '[^\\]]+' + requireClose, 'g');

module.exports = function (grunt) {
    var DEBUG = !!grunt.option('debug');

    grunt.registerMultiTask('requirejs-builder', 'Automatically Map and Build a RequireJS project.', function () {
        this.requiresConfig('requirejs-builder');

        var options = _.defaults(this.options(this.data), {
            src: undefined,
            mainConfigFile: undefined,
            baseUrl: undefined,
            appDir: '.',
            build: false,
            common: 0,
            paths: {},
            overrides: {}
        });

        // var options = this.options(this.data);
        _.each({
            baseUrl: 'Target directory for the built files.  Load scripts out of this directory.',
            mainConfigFile: 'Location of your require-config file, relative to appDir.',
            requireLib: 'Location of the requirejs file source, relative to baseUrl',
            src: 'Glob of javascript files to process.  See the "Globbing patterns" section of the Configuring tasks guide for globbing pattern examples: http://gruntjs.com/configuring-tasks/'
        }, function (val, key) {
            if (!options[key]) {
                grunt.fail.warn('Missing required config: ' + key + ': ' + val);
            }
        });

        var BUILD_BASE = path.resolve(options.appDir || '');
        var BUILD_PATH = path.resolve(BUILD_BASE, options.baseUrl);
        var REQUIRE_CONFIG_BASE = path.resolve(BUILD_BASE, options.mainConfigFile);
        var REQUIRE_CONFIG_OUTPUT = path.resolve(BUILD_PATH, options.mainConfigFile);
        var COMMON_MIN = options.common || 2;

        var _requireConfig;
        var _moduleCounts;

        var _copyCt = 0
        var _copy = function (src, dest) {
            grunt.file.copy(src, dest);
            _copyCt++;
        };

        var _modules = {
            paths: {},
            lazy: [],
            entry: {},
            common: []
        };

        var _promiseToOptimize = function (optimizeOptions) {
            var defer = q.defer();
            requirejs.optimize(optimizeOptions, defer.resolve, defer.reject);    
            return defer.promise;
        };

        q.resolve().then(function () {
            //process first-party modules.  copy them to target directory.  store module names and target destinations in _paths
            _.each(grunt.file.expand(options.src), function writePathAndCopyFile (filePath) {
                if (!grunt.file.isDir(filePath)) {
                    var file = grunt.file.read(filePath);
                    var targetPath = path.resolve(filePath).replace(BUILD_BASE, BUILD_PATH);
                    //regex matches to requireJS patterns.  named module definitions and inline require statements
                    var namedDefineMatch = file.match(REG_DEFINE);
                    var requireMatch = file.match(REG_REQUIRE);
                    
                    if (namedDefineMatch) {
                        var moduleName = namedDefineMatch[0].replace(REG_OPEN_DEFINE, '').replace(REG_CLOSE_DEFINE, '');
                        _copy(filePath, targetPath);
                        _modules.paths[moduleName] = targetPath;

                        if (requireMatch) {
                            var lazyMatchModuleNames = _.chain(requireMatch).map(function (match) {
                                var strippedMatch = match.replace(REG_OPEN_REQUIRE, '').replace(REG_CLOSE_REQUIRE, '');
                                return _.map(strippedMatch.split(','), function (stripped) {
                                    return stripped.replace(/[\s]*('|")[\s]*/g, '');
                                });
                            }).flatten().value();

                            _.each(lazyMatchModuleNames, function (moduleName) {
                                _modules.lazy.push(moduleName);
                            });
                        }
                    } else if (requireMatch) {
                        var moduleName = path.basename(filePath, '.js');
                        _modules.entry[moduleName] = targetPath;;
                        _copy(filePath, targetPath);
                    } else {
                        // console.log('nomatch', filePath);
                    }
                } else {
                    if (DEBUG) { grunt.log.error('Directory: ' + filePath); }
                }                
            });

            return _modules.paths;

        }).then(function () {
            grunt.log.ok('Wrote ' + _copyCt + ' files to ' + BUILD_PATH);
            if (DEBUG) {
                grunt.log.ok('Entry Modules: ' + JSON.stringify(_modules.entry, null, 4));
                grunt.log.ok('Lazy-Loaded Modules: ' + JSON.stringify(_modules.lazy, null, 4));
            }
        }).then(function readRequireConfig () {
            //extend the paths mapped paths into the require config
            var requireConfigFile = grunt.file.read(path.resolve(BUILD_BASE, options.mainConfigFile));

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
            requireConfig.baseUrl = '/' + options.baseUrl;
            //write the relative filepath in the new require config
            _.each(_modules.paths, function (filePath, moduleName) {
                requireConfig.paths[moduleName] = '.' + filePath.slice(BUILD_PATH.length, -3);
            });

            return requireConfig;
        }).then(function writeBuiltRequireConfig (requireConfig) {
            //write require config file
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
            _requireConfig = requireConfig;
            if (DEBUG) {
                grunt.log.ok('Require Config file written to: ' + REQUIRE_CONFIG_OUTPUT);
            }
        }).then(function getDependedModules () {
            //get common modules
            if (options.build) {
                var rjsOpts = {
                    // logLevel: 0,
                    mainConfigFile: REQUIRE_CONFIG_OUTPUT,
                    baseUrl: BUILD_PATH,
                    out: function () { return; },
                    optimize: 'none',
                    paths: options.paths
                };

                var included = [];

                var optimizePromises = _.map(_modules.entry, function (filePath, moduleName) {
                    var relativePath = path.relative(BUILD_PATH, filePath);
                    var name = path.join(path.dirname(relativePath), path.basename(relativePath, '.js'));
                    var opts = _.clone(rjsOpts);
                    _.extend(opts, {
                        name: name,
                        onModuleBundleComplete: function (data) {
                            included.push(data.included);
                        }
                    });
                    return _promiseToOptimize(opts);
                });

                return q.all(optimizePromises).then(function () {
                    return included;
                });
            }
        }).then(function storeCommonModules (included) {
            if (options.common) {
                //get the common counts and build the list
                var counts = _.reduce(_.flatten(included), function (memo, item) {
                    memo[item] = (memo[item] || 0) + 1;
                    return memo;
                }, {});

                _.each(_requireConfig.paths, function (relPath, moduleName) {
                    var absPath = path.resolve(BUILD_PATH, relPath) + '.js';
                    if (counts[absPath] >= options.common) {
                        _modules.common.push(moduleName);
                        if (DEBUG) {
                            grunt.log.ok('Common Dependency Count: ' + counts[absPath] + ', Module: ' + moduleName);
                        }
                    }
                });
            }
        }).then(function doOptimizedBuild () {
            if (options.build) {
                grunt.file.mkdir(options.build);

                var optimizeConfig = {};
                var baseOptimizeOptions = _.extend(_.omit(options, 'src', 'build', 'overrides', 'common', 'appDir'), {
                    mainConfigFile: REQUIRE_CONFIG_OUTPUT,
                    baseUrl: BUILD_PATH
                });
                _.extend(baseOptimizeOptions.paths, {
                    mainConfigFile: options.mainConfigFile.slice(0, -3),
                    requireLib: options.requireLib.slice(0, -3)
                });

                var REQUIRE_AND_CONFIG = ['requireLib', 'mainConfigFile'];

                //add common config
                if (options.common) {
                    optimizeConfig.base = _.extend(_.clone(baseOptimizeOptions), {
                        out: path.join(options.build, 'base.js'),
                        // out: 'base.js',
                        include: _modules.common.concat(REQUIRE_AND_CONFIG),
                        name: 'base',
                        create: true
                    });
                }
                //build config for entry modules
                _.each(_modules.entry, function (filePath, moduleName) {
                    optimizeConfig[moduleName] = _.extend(_.clone(baseOptimizeOptions), {
                        out: path.join(options.build, filePath.replace(BUILD_BASE, '.')),
                        name: filePath.replace(BUILD_PATH, '.').slice(0, -3)
                    });
                    //inject specific targeted overrides
                    if (options.overrides && options.overrides[moduleName]) {
                        _.extend(optimizeConfig[moduleName], options.overrides[moduleName]);
                    }
                    if (options.common) {
                        optimizeConfig[moduleName].exclude = _modules.common;
                    } else {
                        optimizeConfig[moduleName].include = REQUIRE_AND_CONFIG;
                    }
                });
                //add lazy loaded modules
                _.each(_modules.lazy, function (moduleName) {
                    //don't package up empty: modules.
                    if (options.paths && options.paths[moduleName] === 'empty:') { return; }
                    //get path of module from requireConfig
                    optimizeConfig[moduleName] = _.extend(_.clone(baseOptimizeOptions), {
                        out: path.join(options.build, options.baseUrl, _requireConfig.paths[moduleName] + '.js'),
                        exclude: _modules.common,
                        include: [ moduleName ],
                        name: moduleName,
                        create: true
                    });
                });

                grunt.log.ok('Optimizing RequireJS Build.');

                //send all of them to the optimizer
                return q.all(_.map(optimizeConfig, _promiseToOptimize));
            }

        }).nodeify(this.async());

    });

};
