const crypto = require('crypto');
const origCreateHash = crypto.createHash;
crypto.createHash = (algorithm, ...args) =>
  origCreateHash(algorithm === 'md4' ? 'sha256' : algorithm, ...args);

const path = require('path');

module.exports = function override(config, env) {
  const wasmExtensionRegExp = /\.wasm$/;

  config.resolve.extensions.push('.wasm');

  config.module.rules.forEach((rule) => {
    (rule.oneOf || []).forEach((oneOf) => {
      if (oneOf.loader && oneOf.loader.indexOf('file-loader') >= 0) {
        // make file-loader ignore WASM files
        oneOf.exclude.push(wasmExtensionRegExp);
      }
    });
  });

  // add a dedicated loader for WASM
  config.module.rules.push({
    test: wasmExtensionRegExp,
    include: path.resolve(__dirname, 'src'),
    use: [{ loader: require.resolve('wasm-loader'), options: {} }],
  });

  // webpack 4 cannot parse `import.meta`, which the current wasm-bindgen glue
  // uses for its (unused) default .wasm location — rewrite it before parsing.
  config.module.rules.push({
    test: /emulator_8086_web\.js$/,
    enforce: 'pre',
    use: [{ loader: path.resolve(__dirname, 'scripts/import-meta-loader.js') }],
  });

  return config;
};

/**
 * Jest overrides (used by `react-app-rewired test`): load the real wasm-pack
 * generated glue so the UI tests run against the actual 8086 engine.
 */
module.exports.jest = function jestOverrides(config) {
  const pkgGluePattern =
    '(pkg|node_modules[/\\\\]emulator_8086)[/\\\\]emulator_8086_web\\.js$';
  config.transform = Object.assign(
    { [pkgGluePattern]: path.resolve(__dirname, 'scripts/jest-pkg-transform.js') },
    config.transform
  );
  // The package is installed as a symlink (`file:../pkg`); make sure jest does
  // not skip transforming it when it resolves through `node_modules/`.
  // `react-syntax-highlighter/dist/esm` is shipped as ES modules and has to be
  // transformed as well (the app imports it for the code editor highlighting).
  config.transformIgnorePatterns = (config.transformIgnorePatterns || []).map((pattern) => {
    if (typeof pattern === 'string' && pattern.includes('node_modules') && !pattern.includes('?!')) {
      return pattern.replace(
        'node_modules[/\\\\]',
        'node_modules[/\\\\](?!emulator_8086/|react-syntax-highlighter/dist/esm/)'
      );
    }
    return pattern;
  });
  return config;
};
