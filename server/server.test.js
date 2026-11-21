'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer, headersFor } = require('./server');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
fs.writeFileSync(path.join(root, 'index.html'), '<h1>hi</h1>');
fs.mkdirSync(path.join(root, 'sub'));
fs.writeFileSync(path.join(root, 'sub', 'index.html'), 'sub');
fs.writeFileSync(path.join(root, 'a.css'), 'body{}');
fs.mkdirSync(path.join(root, 'editor'));
fs.writeFileSync(path.join(root, 'editor', 'index.html'), 'ed');
fs.writeFileSync(path.join(root, 'editorial.html'), 'x');
fs.writeFileSync(path.join(root, 'shop.html'), 'shop');
fs.writeFileSync(path.join(path.dirname(root), 'secret.txt'), 'secret');

const lines = [];
const server = createServer({ root, version: 'abc123', log: (l) => lines.push(l) });
let base;
test.before(() => new Promise((r) => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
test.after(() => server.close());

const get = (p, opts) => fetch(base + p, { redirect: 'manual', ...opts });

test('healthz and version', async () => {
  assert.strictEqual(await (await get('/healthz')).text(), 'ok\n');
  const v = await get('/version.txt');
  assert.strictEqual(await v.text(), 'abc123');
  assert.strictEqual(v.headers.get('cache-control'), 'no-store');
});

test('static files, index, directory redirect, 404', async () => {
  const idx = await get('/');
  assert.strictEqual(idx.status, 200);
  assert.match(idx.headers.get('content-type'), /^text\/html/);
  assert.strictEqual((await get('/a.css')).headers.get('content-type'), 'text/css; charset=utf-8');
  assert.strictEqual((await get('/sub/')).status, 200);
  const redir = await get('/sub');
  assert.strictEqual(redir.status, 301);
  assert.strictEqual(redir.headers.get('location'), '/sub/');
  assert.strictEqual((await get('/nope')).status, 404);
});

test('security headers like the former nginx.conf', async () => {
  for (const p of ['/', '/nope', '/healthz']) {
    const h = (await get(p)).headers;
    assert.strictEqual(h.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(h.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.strictEqual(h.get('x-frame-options'), 'SAMEORIGIN');
  }
});

test('no path traversal', async () => {
  const net = require('node:net');
  const status = await new Promise((resolve) => {
    const s = net.connect(server.address().port, '127.0.0.1', () => s.write('GET /../secret.txt HTTP/1.0\r\n\r\n'));
    s.on('data', (d) => { resolve(d.toString().split(' ')[1]); s.destroy(); });
  });
  assert.strictEqual(status, '404');
  assert.strictEqual((await get('/%2e%2e/secret.txt')).status, 404);
});

test('methods, api placeholder, access log', async () => {
  assert.strictEqual((await get('/', { method: 'POST' })).status, 405);
  const api = await get('/api/anything');
  assert.strictEqual(api.status, 404);
  assert.deepStrictEqual(await api.json(), { error: 'not_found' });
  assert.ok(lines.some((l) => /"GET \/api\/anything" 404 /.test(l)));
  assert.ok(!lines.some((l) => l.includes('/healthz')));
});

const EDITOR_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.github.com; frame-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

test('editor_csp', async () => {
  for (const p of ['/editor/', '/editor/nope', '/editor']) {
    const r = await get(p);
    const h = r.headers;
    assert.strictEqual(h.get('content-security-policy'), EDITOR_CSP, p);
    assert.strictEqual(h.get('x-frame-options'), 'DENY', p);
    assert.strictEqual(h.get('cache-control'), 'no-store', p);
    assert.strictEqual(h.get('x-content-type-options'), 'nosniff', p);
  }
  assert.strictEqual((await get('/editor')).status, 301);
  const first = await get('/editor/');
  assert.strictEqual(first.status, 200);
  const r304 = await get('/editor/', { headers: { 'if-none-match': first.headers.get('etag') } });
  assert.strictEqual(r304.status, 304);
  assert.strictEqual(r304.headers.get('content-security-policy'), EDITOR_CSP);
  assert.strictEqual(r304.headers.get('cache-control'), 'no-store');
});

test('andere_seiten_ohne_csp', async () => {
  for (const p of ['/', '/editorial.html', '/shop.html', '/nope']) {
    const h = (await get(p)).headers;
    assert.strictEqual(h.get('content-security-policy'), null, p);
    assert.strictEqual(h.get('x-frame-options'), 'SAMEORIGIN', p);
  }
  assert.strictEqual(headersFor('/editorial.html')['Content-Security-Policy'], undefined);
});

test('log_ohne_query', async () => {
  await get('/api/editor/callback?code=geheim&state=x');
  await get('/shop.html?a=1');
  await new Promise((r) => setTimeout(r, 50));
  const cb = lines.find((l) => l.includes('/api/editor/callback'));
  assert.ok(cb && !cb.includes('geheim') && !cb.includes('?'), cb);
  assert.ok(lines.some((l) => l.includes('"GET /shop.html?a=1"')));
});
