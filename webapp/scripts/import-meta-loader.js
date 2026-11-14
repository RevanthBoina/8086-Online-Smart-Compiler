/**
 * webpack 4 (react-scripts 4) cannot parse `import.meta`, but the glue that
 * wasm-pack generates for `--target web` uses `import.meta.url` once as the
 * fallback location of the .wasm binary.
 *
 * The app never takes that branch — it always calls
 * `init("…/emulator_8086_web_bg.wasm")` with an explicit URL — but the file
 * still has to parse. This loader rewrites the token to `document.baseURI`
 * before webpack parses the module, which keeps the fallback resolving to a
 * path relative to the page (the same behaviour as older wasm-bindgen glue
 * that used a plain relative string).
 */
module.exports = function importMetaLoader(source) {
  if (this.cacheable) this.cacheable();
  return source.replace(/import\.meta\.url/g, 'document.baseURI');
};
