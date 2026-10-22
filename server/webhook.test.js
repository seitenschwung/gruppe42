'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const os = require('node:os');
const { createServer } = require('./server');
const { createWebhook } = require('./webhook');

const SECRET = 'whsec_test';
const sign = (body, t, secret = SECRET) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
const ev = (o = {}) => JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid', amount_total: 12900, currency: 'eur', metadata: { product_id: 'live', menge: '2' } } }, ...o });

function setup(env = { STRIPE_WEBHOOK_SECRET: SECRET }, onPaid) {
  const paid = [];
  const api = createWebhook({ env, onPaid: onPaid || ((o) => { paid.push(o); }), now: () => 1_700_000_000_000 });
  const server = createServer({ root: os.tmpdir(), version: 'v', api });
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res({ server, paid, base: `http://127.0.0.1:${server.address().port}` })));
}
const T = 1_700_000_000;
const post = (base, body, sig) => fetch(`${base}/api/stripe/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', ...(sig ? { 'stripe-signature': sig } : {}) }, body });

test('no secret -> 503', async () => {
  const { server, base } = await setup({});
  assert.strictEqual((await post(base, ev(), sign(ev(), T))).status, 503);
  server.close();
});

test('valid signature: paid session is handled once, duplicate event is ignored', async () => {
  const { server, paid, base } = await setup();
  const body = ev();
  assert.strictEqual((await post(base, body, sign(body, T))).status, 200);
  const again = await post(base, body, sign(body, T));
  assert.strictEqual(again.status, 200);
  assert.strictEqual((await again.json()).duplicate, true);
  assert.strictEqual(paid.length, 1);
  assert.deepStrictEqual(paid[0], { event_id: 'evt_1', session_id: 'cs_1', product_id: 'live', menge: 2, amount_total: 12900, currency: 'eur' });
  server.close();
});

test('bad, missing, wrong-secret, malformed and tampered signatures -> 400, nothing handled', async () => {
  const { server, paid, base } = await setup();
  const body = ev();
  assert.strictEqual((await post(base, body)).status, 400);
  assert.strictEqual((await post(base, body, sign(body, T, 'whsec_other'))).status, 400);
  assert.strictEqual((await post(base, body, `t=${T},v1=zz`)).status, 400);
  assert.strictEqual((await post(base, body, 'garbage')).status, 400);
  assert.strictEqual((await post(base, body + ' ', sign(body, T))).status, 400); // body changed after signing
  assert.strictEqual(paid.length, 0);
  server.close();
});

test('timestamp outside the 5 minute tolerance -> 400', async () => {
  const { server, base } = await setup();
  const body = ev();
  assert.strictEqual((await post(base, body, sign(body, T - 301))).status, 400);
  assert.strictEqual((await post(base, body, sign(body, T + 301))).status, 400);
  assert.strictEqual((await post(base, body, sign(body, T - 299))).status, 200);
  server.close();
});

test('unpaid session and other event types are acknowledged but not handled', async () => {
  const { server, paid, base } = await setup();
  const unpaid = ev({ id: 'evt_2', data: { object: { id: 'cs_2', payment_status: 'unpaid', metadata: {} } } });
  assert.strictEqual((await post(base, unpaid, sign(unpaid, T))).status, 200);
  const other = ev({ id: 'evt_3', type: 'charge.refunded' });
  assert.strictEqual((await post(base, other, sign(other, T))).status, 200);
  assert.strictEqual(paid.length, 0);
  server.close();
});

test('handler failure -> 500 and the event may be retried', async () => {
  let n = 0;
  const { server, base } = await setup(undefined, () => { if (++n === 1) throw new Error('db down'); });
  const body = ev();
  assert.strictEqual((await post(base, body, sign(body, T))).status, 500);
  assert.strictEqual((await post(base, body, sign(body, T))).status, 200);
  assert.strictEqual(n, 2);
  server.close();
});

test('oversized body -> 413; GET -> 405', async () => {
  const { server, base } = await setup();
  assert.strictEqual((await post(base, 'x'.repeat(70_000), 't=1,v1=00')).status, 413);
  assert.strictEqual((await fetch(`${base}/api/stripe/webhook`)).status, 405);
  server.close();
});
