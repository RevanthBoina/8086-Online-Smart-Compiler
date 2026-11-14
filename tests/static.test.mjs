/**
 * Test H: static hosting behaviour of the built site.
 *
 * Mimics how GitHub Pages serves a project site under
 * `/8086-Online-Smart-Compiler/` from the `webapp/build/` artifact:
 *   - files are served under the base path;
 *   - unknown paths (e.g. a refresh on `/compile`) answer HTTP 404 with the
 *     contents of `404.html`, which the deploy workflow generates from the
 *     React `index.html` so the SPA boots and the router takes over;
 *   - no backend is involved: everything is a static file.
 *
 * Run:  node tests/static.test.mjs
 * Requires a production build in webapp/build/ (`npm run build`).
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'webapp', 'build');
const BASE = '/8086-Online-Smart-Compiler';

if (!fs.existsSync(path.join(buildDir, 'index.html'))) {
  console.error('FAIL: webapp/build/index.html missing. Run `npm run build` first.');
  process.exit(2);
}

// Same step the deploy workflow performs.
fs.copyFileSync(path.join(buildDir, 'index.html'), path.join(buildDir, '404.html'));

let pass = 0;
let fail = 0;
const failures = [];
function check(label, cond, detail) {
  if (cond) {
    pass += 1;
    console.log(`  ok   ${label}`);
  } else {
    fail += 1;
    failures.push(label);
    console.log(`  FAIL ${label}${detail !== undefined ? ' :: ' + detail : ''}`);
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/' || url.pathname === BASE) {
    // Redirect to the site base, like GitHub Pages does for `/REPO`.
    res.writeHead(301, { Location: BASE + '/' });
    res.end();
    return;
  }
  if (!url.pathname.startsWith(BASE + '/')) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  const rel = url.pathname.slice(BASE.length + 1) || 'index.html';
  const filePath = path.join(buildDir, rel);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
    });
    res.end(fs.readFileSync(filePath));
    return;
  }
  // GitHub Pages: unknown path -> 404.html (SPA fallback generated in CI).
  const fallback = path.join(buildDir, '404.html');
  if (fs.existsSync(fallback)) {
    res.writeHead(404, { 'Content-Type': MIME['.html'] });
    res.end(fs.readFileSync(fallback));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;

async function get(p) {
  const res = await fetch(origin + p, { redirect: 'manual' });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, buf, get text() { return buf.toString('utf8'); } };
}

console.log(`\nH. Static hosting of the built site (base ${BASE}/)`);

const root404or301 = await get('/');
check('/ redirects or serves under the base path', root404or301.status === 301 || root404or301.status === 200);

const home = await get(BASE + '/');
check('landing page returns 200', home.status === 200, home.status);
check('landing page is the React entry', home.text.includes('id="root"'));
check('landing page title is 8086 Learning Lab', /<title>[^<]*8086 Learning Lab/.test(home.text));
check(
  'bundle is referenced with the /8086-Online-Smart-Compiler/ base path',
  /src="\/8086-Online-Smart-Compiler\/static\/js\//.test(home.text),
  (home.text.match(/src="[^"]*static\/js\/[^"]*"/) || [''])[0]
);
check('no absolute (site-root) bundle reference', !/src="\/static\/js\//.test(home.text));

const scripts = [...home.text.matchAll(/src="(\/8086-Online-Smart-Compiler\/static\/js\/[^"]+)"/g)].map((m) => m[1]);
check('bundle scripts discovered', scripts.length >= 2, scripts.join(','));
for (const s of scripts) {
  const r = await get(s);
  check(`bundle loads: ${s.split('/').pop()}`, r.status === 200, r.status);
}

// Direct navigation / refresh on a deep link (the 404.html SPA fallback).
for (const deepLink of ['/compile', '/instructions', '/unknown-page']) {
  const r = await get(BASE + deepLink);
  check(`deep link ${deepLink} answers with the SPA entry document`, r.status === 404 && r.text.includes('id="root"'), `status=${r.status}`);
}

// Local WASM served next to the app, no upstream host.
const wasm = await get(BASE + '/emulator_8086_web_bg.wasm');
check('wasm served under the site base path with 200', wasm.status === 200, wasm.status);
check(
  'wasm has the application/wasm content type',
  (wasm.headers.get('content-type') || '').includes('application/wasm'),
  wasm.headers.get('content-type')
);
const magic = wasm.buf.slice(0, 4).toString('latin1');
check('wasm binary has the \\0asm magic', magic === '\0asm', JSON.stringify(magic));
check('wasm is the current engine build (size > 1.6 MB)', wasm.buf.length >= 1600000, wasm.buf.length);

// Nothing in the built HTML points at an external compiler / old repo.
check('no external compiler host in the entry HTML', !/coa-8086|8086-emulator-web|yjdoc2\.github\.io/.test(home.text));

server.close();
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('Failed checks:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
