'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('./server');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
fs.writeFileSync(path.join(root, 'index.html'), '<h1>hi</h1>');
fs.mkdirSync(path.join(root, 'sub'));
fs.writeFileSync(path.join(root, 'sub', 'index.html'), 'sub');
fs.writeFileSync(path.join(root, 'a.css'), 'body{}');
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
