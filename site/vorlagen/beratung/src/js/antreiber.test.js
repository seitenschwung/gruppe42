'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { auswertenWerte, vorschauAntworten } = require('./antreiber.js');

const dir = path.join(__dirname, '../../../../kunden/gruppe42/tests');
const tests = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'struktur.json')
  .map((f) => ({ f, d: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));

test('bereich_vorne: jede Kategorie jedes Ranking-Tests liegt klar vorne', () => {
  let n = 0;
  for (const { f, d } of tests.filter((t) => t.d.result.kind === 'ranking')) {
    for (const c of d.categories) {
      const r = auswertenWerte(d, vorschauAntworten(d, 'bereich:' + c.id));
      assert.strictEqual(r.sortiert[0], c.id, f + ' ' + c.id);
      assert.strictEqual(r.gleichauf, false, f + ' ' + c.id);
      n++;
    }
  }
  assert.ok(n > 0);
});

test('stufe_treffen: jede Stufe jedes Levels-Tests wird getroffen', () => {
  let n = 0;
  for (const { f, d } of tests.filter((t) => t.d.result.kind === 'levels')) {
    d.result.levels.forEach((_, i) => {
      const r = auswertenWerte(d, vorschauAntworten(d, 'stufe:' + i));
      assert.strictEqual(r.stufe, i, f + ' stufe ' + i);
      n++;
    });
  }
  assert.ok(n > 0);
});

test('wert_fest: "3" ergibt nur Dreier, Ranking liefert stufe -1', () => {
  for (const { d } of tests) {
    const a = vorschauAntworten(d, '3');
    assert.strictEqual(a.length, d.questions.length);
    assert.ok(a.every((x) => x === 3));
    if (d.result.kind === 'ranking') assert.strictEqual(auswertenWerte(d, a).stufe, -1);
  }
});

test('zufall: leere Spec liefert gültige Skalenwerte', () => {
  for (const { d } of tests) {
    const a = vorschauAntworten(d, '');
    assert.ok(a.every((x) => Object.keys(d.scale).includes(String(x))));
  }
});
