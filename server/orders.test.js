'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOrderStore } = require('./orders');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ord-')), 'data');
const order = (id = 'cs_1') => ({ event_id: 'evt_1', session_id: id, product_id: 'live', menge: 2, amount_total: 25800, currency: 'eur' });

test('stores an order (creating the directory) and lists it', async () => {
  const dir = tmp();
  const s = createOrderStore({ dir });
  assert.deepStrictEqual(s.list(), []);
  assert.deepStrictEqual(await s.add(order(), () => new Date('2026-10-22T10:00:00Z')), { created: true });
  assert.deepStrictEqual(s.list(), [{ id: 'cs_1', event_id: 'evt_1', product_id: 'live', menge: 2, amount_total: 25800, currency: 'eur', paid_at: '2026-10-22T10:00:00.000Z' }]);
  assert.strictEqual(fs.statSync(path.join(dir, 'orders.jsonl')).mode & 0o777, 0o600);
});

test('the same session is stored once, also across restarts and concurrent calls', async () => {
  const dir = tmp();
  const s = createOrderStore({ dir });
  const r = await Promise.all([s.add(order()), s.add(order()), s.add(order('cs_2'))]);
  assert.deepStrictEqual(r.map((x) => x.created), [true, false, true]);
  const s2 = createOrderStore({ dir });
  assert.strictEqual((await s2.add(order())).created, false);
  assert.strictEqual(s2.list().length, 2);
});

test('a torn last line does not break loading', async () => {
  const dir = tmp();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'orders.jsonl'), JSON.stringify({ id: 'cs_1' }) + '\n{"id":"cs_');
  const s = createOrderStore({ dir });
  assert.strictEqual((await s.add(order('cs_1'))).created, false);
  assert.strictEqual((await s.add(order('cs_9'))).created, true);
});

test('unwritable directory rejects (so the webhook can answer 500) and later writes still work', async () => {
  const blocked = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ord-')), 'file');
  fs.writeFileSync(blocked, 'x'); // a file where the directory should be
  const bad = createOrderStore({ dir: path.join(blocked, 'data') });
  await assert.rejects(bad.add(order()));
  await assert.rejects(bad.add(order('cs_2')));
  const good = createOrderStore({ dir: tmp() });
  assert.strictEqual((await good.add(order())).created, true);
});

test('rejects an order without session id', async () => {
  await assert.rejects(createOrderStore({ dir: tmp() }).add({ product_id: 'x' }));
});
