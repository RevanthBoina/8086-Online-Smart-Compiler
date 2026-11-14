/**
 * Jest transform for the wasm-pack generated glue (`pkg/emulator_8086_web.js`).
 *
 * The generated ES module contains one `import.meta.url` reference, which
 * webpack 4 cannot parse either — `import-meta-loader.js` rewrites it for the
 * production build, and this transformer does the same before handing the
 * source to CRA's babel transformer so jest can load the real engine.
 */
const babelTransform = require('react-scripts/config/jest/babelTransform');

module.exports = {
  process(src, filename, config, options) {
    const shimmed = src.replace(/import\.meta\.url/g, 'document.baseURI');
    return babelTransform.process.call(babelTransform, shimmed, filename, config, options);
  },
  getCacheKey(src, filename, configString, options) {
    if (typeof babelTransform.getCacheKey === 'function') {
      return babelTransform.getCacheKey(
        `import-meta-shim\n${src}`,
        filename,
        configString,
        options
      );
    }
    return null;
  },
};
