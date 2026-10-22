'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('./server');
const { createApi } = require('./checkout');
const { loadProducts } = require('./products');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'co-'));
const pfile = path.join(dir, 'p.json');
fs.writeFileSync(pfile, JSON.stringify({ waehrung: 'eur', produkte: [
  { id: 'live', typ: 'online', titel: 'Live Seminar', beschreibung: 'b', preis_cent: 12900, max_menge: 3, entwurf: false },
  { id: 'draft', typ: 'praesenz', titel: 'Draft', beschreibung: 'b', preis_cent: null, max_menge: 1, entwurf: true },
] }));

function setup(env, stripe) {
  const calls = [];
  const fetch = async (url, opts) => { calls.push({ url, opts }); return stripe ? stripe() : { ok: true, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/x' }) }; };
  const api = createApi({ products: loadProducts(pfile), env, fetch });
  const server = createServer({ root: dir, version: 'v', api });
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res({ server, calls, base: `http://127.0.0.1:${server.address().port}` })));
}
const post = (base, body, headers = { 'content-type': 'application/json' }) =>
  fetch(`${base}/api/checkout`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('without STRIPE_SECRET_KEY: 503 and no Stripe call', async () => {
  const { server, calls, base } = await setup({});
  const r = await post(base, { id: 'live' });
  assert.strictEqual(r.status, 503);
  assert.strictEqual(calls.length, 0);
  server.close();
});

test('creates a session; amount and name come from products.json, not the client', async () => {
  const { server, calls, base } = await setup({ STRIPE_SECRET_KEY: 'sk_test_x', PUBLIC_URL: 'https://example.test/' });
  const r = await post(base, { id: 'live', menge: 2, preis_cent: 1, unit_amount: 1, titel: 'cheap' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(await r.json(), { url: 'https://checkout.stripe.com/c/pay/x' });
  const { url, opts } = calls[0];
  assert.strictEqual(url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.strictEqual(opts.headers.Authorization, 'Bearer sk_test_x');
  const f = new URLSearchParams(opts.body.toString());
  assert.strictEqual(f.get('line_items[0][price_data][unit_amount]'), '12900');
  assert.strictEqual(f.get('line_items[0][price_data][product_data][name]'), 'Live Seminar');
  assert.strictEqual(f.get('line_items[0][price_data][currency]'), 'eur');
  assert.strictEqual(f.get('line_items[0][quantity]'), '2');
  assert.strictEqual(f.get('success_url'), 'https://example.test/shop.html?status=erfolg');
  assert.strictEqual(f.get('metadata[product_id]'), 'live');
  server.close();
});

test('rejects drafts, unknown ids, bad quantities, bad bodies', async () => {
  const { server, calls, base } = await setup({ STRIPE_SECRET_KEY: 'sk_test_x' });
  assert.strictEqual((await post(base, { id: 'draft' })).status, 404);
  assert.strictEqual((await post(base, { id: 'nope' })).status, 404);
  assert.strictEqual((await post(base, {})).status, 404);
  for (const menge of [0, 4, 1.5, '1']) assert.strictEqual((await post(base, { id: 'live', menge })).status, 400);
  assert.strictEqual((await post(base, '{bad')).status, 400);
  assert.strictEqual((await post(base, { id: 'live' }, { 'content-type': 'text/plain' })).status, 415);
  assert.strictEqual((await post(base, { id: 'live', x: 'a'.repeat(5000) })).status, 413);
  assert.strictEqual(calls.length, 0);
  server.close();
});

test('Stripe failure -> 502 without leaking details; GET -> 405', async () => {
  const { server, base } = await setup({ STRIPE_SECRET_KEY: 'sk_test_x' }, () => ({ ok: false, json: async () => ({ error: { message: 'secret detail' } }) }));
  const r = await post(base, { id: 'live' });
  assert.strictEqual(r.status, 502);
  assert.ok(!(await r.text()).includes('secret'));
  const g = await fetch(`${base}/api/checkout`);
  assert.strictEqual(g.status, 405);
  server.close();
});

test('rate limit: 11th request in a minute -> 429', async () => {
  const { server, base } = await setup({ STRIPE_SECRET_KEY: 'sk_test_x' });
  let last;
  for (let i = 0; i < 11; i++) last = await post(base, { id: 'live' });
  assert.strictEqual(last.status, 429);
  server.close();
});
