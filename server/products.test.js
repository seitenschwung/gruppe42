'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadProducts, validate } = require('./products');

const live = (o = {}) => ({ id: 'a', typ: 'online', titel: 't', beschreibung: 'b', preis_cent: 1000, max_menge: 1, entwurf: false, ...o });
const doc = (...p) => ({ waehrung: 'eur', produkte: p });

test('products.json is valid and has one online and one in-person seminar', () => {
  const pr = loadProducts();
  assert.deepStrictEqual(pr.all().map((p) => p.typ).sort(), ['online', 'praesenz']);
});

test('draft products cannot be bought', () => {
  const pr = loadProducts();
  for (const p of pr.all()) { assert.strictEqual(p.entwurf, true); assert.strictEqual(pr.buyable(p.id), undefined); }
  assert.strictEqual(pr.get('nope'), undefined);
});

test('live products need a positive integer price in cents', () => {
  assert.ok(validate(doc(live())));
  for (const bad of [null, 0, -1, 9.5, '1000']) assert.throws(() => validate(doc(live({ preis_cent: bad }))), /preis_cent/);
});

test('rejects bad ids, duplicates, types, quantities', () => {
  assert.throws(() => validate(doc(live({ id: 'A b' }))), /bad id/);
  assert.throws(() => validate(doc(live(), live())), /duplicate/);
  assert.throws(() => validate(doc(live({ typ: 'x' }))), /typ/);
  assert.throws(() => validate(doc(live({ max_menge: 0 }))), /max_menge/);
  assert.throws(() => validate({ waehrung: 'EUR', produkte: [live()] }), /waehrung/);
});

test('a live product is buyable', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'p-')), 'p.json');
  fs.writeFileSync(f, JSON.stringify(doc(live())));
  assert.strictEqual(loadProducts(f).buyable('a').preis_cent, 1000);
});
