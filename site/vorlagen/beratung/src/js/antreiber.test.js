'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { auswertenWerte, vorschauAntworten, zeigeMusterHinweis } = require('./antreiber.js');

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

test('ladbar ohne window/document, keine Globals; ungültige Specs fallen auf Zufall zurück', () => {
  assert.strictEqual(typeof document, 'undefined');
  assert.strictEqual(typeof globalThis.auswertenWerte, 'undefined');
  assert.strictEqual(typeof globalThis.skalaGrenzen, 'undefined');
  const d = tests.find((t) => t.d.result.kind === 'levels').d;
  for (const spec of ['stufe:', 'stufe: ', 'stufe:x', 'stufe:-1', 'stufe:99', 'bereich:gibtsnicht']) {
    const a = vorschauAntworten(d, spec);
    assert.strictEqual(a.length, d.questions.length, spec);
    assert.ok(a.every((x) => Object.keys(d.scale).includes(String(x))), spec);
  }
});

test('muster_hinweis: nur bei echtem Durchlauf, nicht in der Vorschau', () => {
  const gleich = new Array(20).fill(3);
  assert.strictEqual(zeigeMusterHinweis(gleich, false), true);
  assert.strictEqual(zeigeMusterHinweis(gleich, true), false);
  const fast = new Array(18).fill(4).concat([1, 2]);
  assert.strictEqual(zeigeMusterHinweis(fast, false), true);
  const gemischt = new Array(17).fill(4).concat([1, 2, 5]);
  assert.strictEqual(zeigeMusterHinweis(gemischt, false), false);
  assert.strictEqual(zeigeMusterHinweis(new Array(9).fill(3), false), false);
  // Gleichstand-Vorschau ('3') auf echten Ranking-Tests: Antworten wären auffällig, Hinweis trotzdem nicht
  for (const { f, d } of tests.filter((t) => t.d.result.kind === 'ranking')) {
    const a = vorschauAntworten(d, '3');
    assert.strictEqual(zeigeMusterHinweis(a, false), true, f);
    assert.strictEqual(zeigeMusterHinweis(a, true), false, f);
  }
});
