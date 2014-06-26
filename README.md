Example config:

```
    options: {
        src: ['public/javascripts/**/*.js'],
        appDir: 'public',
        baseUrl: '_build',
        mainConfigFile: 'javascripts/require-config.js',
        requireLib: '../components/requirejs/require.js',
        
        ... and other requirejs optimizer config options
    },
    dev: {
        build: false,
        generateSourceMaps: false,
        optimize: 'none'
    },
    production: {
        build: 'public/dist',
        common: 3,
        optimize: 'uglify2',
        // optimize: 'none',
        generateSourceMaps: true,
        preserveLicenseComments: false,
        paths: {
        	...specific requirejs optimizer path overrides
        },
        overrides: {
            <specific app name>: {
                wrapShim: true
            }
        }
    }
```

src, mainConfigFile, requireLib, build, common, and overrides keys are special.  everything else are standard requirejs optimizer options: http://requirejs.org/docs/optimization.html
