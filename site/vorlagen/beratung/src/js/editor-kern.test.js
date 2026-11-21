'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const W = require('../../../../lib/testwaechter');
const K = require('./editor-kern.js');

// Beispielkopie statt echter Inhalte: Texte der Redaktion dürfen sich ändern, ohne dass dieser Test bricht.
const dir = path.join(__dirname, '../../../../lib/__fixtures__');
const lies = (p) => JSON.parse(fs.readFileSync(path.join(dir, p), 'utf8'));
const gruppe = lies('gruppe42.json');
const tests = gruppe.tests.eintraege.map((e) => ({ e, d: lies(e.daten) }));

// Konkrete Pfade aller Strings, die der Wächter als Textfeld ansieht
function waechterPfade(daten, textfelder) {
  const aus = [];
  const mus = (p) => p.replace(/\[\d+\]/g, '[]').replace(/^scale\.[^.[]+$/, 'scale.*');
  (function geh(k, p) {
    if (Array.isArray(k)) k.forEach((w, i) => geh(w, p + '[' + i + ']'));
    else if (k && typeof k === 'object') for (const key of Object.keys(k)) geh(k[key], p ? p + '.' + key : key);
    else if (typeof k === 'string' && textfelder.includes(mus(p))) aus.push(p);
  })(daten, '');
  return aus;
}

test('felder_vollstaendig: Pfade = genau die Textfelder laut Wächter', () => {
  assert.ok(tests.length >= 4);
  for (const { e, d } of tests) {
    const f = K.felder(d, e);
    const test_ = f.filter((x) => x.datei === 'test').map((x) => x.pfad).sort();
    const eintrag = f.filter((x) => x.datei === 'eintrag').map((x) => x.pfad).sort();
    assert.deepStrictEqual(test_, waechterPfade(d, W.TEXTFELDER_TEST).sort(), e.id);
    assert.deepStrictEqual(eintrag, waechterPfade(e, W.TEXTFELDER_EINTRAG).sort(), e.id);
    for (const x of f) {
      assert.ok(GRUPPEN.includes(x.gruppe), x.pfad);
      assert.ok(x.label && x.label !== x.pfad, e.id + ' ' + x.pfad);
      assert.strictEqual(typeof x.wert, 'string');
    }
    assert.strictEqual(new Set(f.map((x) => x.label)).size, f.length, 'Labels eindeutig ' + e.id);
  }
});
const GRUPPEN = ['start', 'skala', 'fragen', 'ergebnis', 'bereiche', 'stufen'];

test('labels_sprechend', () => {
  const { e, d } = tests.find((t) => t.d.id === 'antreiber');
  const f = K.felder(d, e);
  const label = (pfad, datei = 'test') => f.find((x) => x.pfad === pfad && x.datei === datei).label;
  assert.strictEqual(label('questions[0].text'), 'Frage 1 (Bereich „Sei perfekt!“)');
  assert.strictEqual(label('categories[0].sections[1].title'), 'Bereich „Sei perfekt!“, Abschnitt 2: Titel');
  const lead = f.find((x) => x.pfad === 'result.lead');
  assert.ok(lead.hinweis.includes('{names}'));
  const t = tests.find((x) => x.d.id === 'teamklima');
  const l = K.felder(t.d, t.e).find((x) => x.pfad === 'result.levels[1].title');
  assert.strictEqual(l.label, 'Stufe ab ' + t.d.result.levels[1].min + ' %: Überschrift');
  assert.strictEqual(f.find((x) => x.pfad === 'result.title').betont, true);
  assert.strictEqual(f.find((x) => x.pfad === 'motto').betont, true);
  assert.strictEqual(f.find((x) => x.pfad === 'name').betont, false);
});

test('cta_href_fehlt: der Link des Buttons ist nicht bearbeitbar', () => {
  for (const { e, d } of tests) {
    const pfade = K.felder(d, e).map((x) => x.pfad);
    assert.ok(pfade.includes('result.cta.text'));
    assert.ok(!pfade.includes('result.cta.href'));
    assert.ok(!pfade.some((p) => /href|\.id$|kind|reverse|\.min$|tone/.test(p)), e.id);
  }
});

test('setze_struktur_bleibt: Kopie, Original unverändert, Struktur gleich', () => {
  for (const { e, d } of tests) {
    const erwartet = W.struktur(d, W.TEXTFELDER_TEST);
    const orig = JSON.stringify(d);
    let neu = d;
    for (const f of K.felder(d, e).filter((x) => x.datei === 'test')) neu = K.setze(neu, f.pfad, 'Neu ' + f.pfad.length + (f.wert.includes('{names}') ? ' {names}' : ''));
    assert.strictEqual(JSON.stringify(d), orig);
    assert.deepStrictEqual(W.pruefeStruktur(neu, erwartet, W.TEXTFELDER_TEST), []);
    assert.notStrictEqual(JSON.stringify(neu), orig);
  }
  assert.throws(() => K.setze({ a: 1 }, 'b.c', 'x'), /Pfad/);
});

test('aenderungen: nur geänderte Felder, mit Label', () => {
  const { e, d } = tests[0];
  const f = K.felder(d, e);
  const n = K.setze(d, 'questions[2].text', 'Anders.');
  const a = K.aenderungen(d, n, f);
  assert.strictEqual(a.length, 1);
  assert.strictEqual(a[0].neu, 'Anders.');
  assert.strictEqual(a[0].alt, d.questions[2].text);
  assert.match(a[0].label, /^Frage 3/);
  assert.strictEqual(a[0].datei, 'test');
  assert.strictEqual(a[0].pfad, 'questions[2].text');
  const paar = K.aenderungen({ test: d, eintrag: e }, { test: d, eintrag: Object.assign({}, e, { motto: 'M2' }) }, f);
  assert.deepStrictEqual(paar.map((x) => [x.datei, x.pfad, x.neu]), [['eintrag', 'motto', 'M2']]);
});

test('setze_pfadarten: length und Nicht-Zahlen bei Arrays werden abgelehnt', () => {
  const o = { a: ['x', 'y'] };
  assert.throws(() => K.setze(o, 'a.length', 1), /Pfad/);
  assert.throws(() => K.setze(o, 'a.0', 'z'), /Pfad/);
  assert.throws(() => K.setze(o, 'a[5]', 'z'), /Pfad/);
  assert.deepStrictEqual(K.setze(o, 'a[1]', 'z'), { a: ['x', 'z'] });
});

test('entwurf_anwenden: nur Felder mit unveränderter Basis, sonst verworfen mit Label', () => {
  const { e, d } = tests[0];
  const f = K.felder(d, e);
  const stand = { test: d, eintrag: e };
  const q2 = f.find((x) => x.pfad === 'questions[2].text');
  const q5 = f.find((x) => x.pfad === 'questions[5].text');
  const motto = f.find((x) => x.datei === 'eintrag' && x.pfad === 'motto');
  const entwurf = {
    werte: { 'test|questions[2].text': 'Entwurf 2', 'test|questions[5].text': 'Entwurf 5', 'eintrag|motto': 'Neues Motto' },
    basis: { 'test|questions[2].text': d.questions[2].text, 'test|questions[5].text': 'Alter Stand', 'eintrag|motto': e.motto },
  };
  const r = K.entwurfAnwenden(stand, entwurf, f);
  assert.strictEqual(r.daten.test.questions[2].text, 'Entwurf 2');
  assert.strictEqual(r.daten.test.questions[5].text, d.questions[5].text, 'Repo-Wert bleibt');
  assert.strictEqual(r.daten.eintrag.motto, 'Neues Motto');
  assert.strictEqual(r.angewendet, 2);
  assert.deepStrictEqual(r.verworfen, [q5.label]);
  assert.ok(q2 && motto);
  assert.strictEqual(d.questions[2].text, tests[0].d.questions[2].text, 'Original unverändert');
});

test('entwurf_anwenden: alter Entwurf ohne Basis wird verworfen; gleicher Wert zählt nicht', () => {
  const { e, d } = tests[0];
  const f = K.felder(d, e);
  const q5 = f.find((x) => x.pfad === 'questions[5].text');
  const r = K.entwurfAnwenden({ test: d, eintrag: e },
    { werte: { 'test|questions[5].text': 'Alt', 'test|questions[2].text': d.questions[2].text } }, f);
  assert.strictEqual(r.daten.test, d);
  assert.strictEqual(r.angewendet, 0);
  assert.deepStrictEqual(r.verworfen, [q5.label]);
  assert.deepStrictEqual(K.entwurfAnwenden({ test: d, eintrag: e }, null, f), { daten: { test: d, eintrag: e }, angewendet: 0, verworfen: [] });
});

test('labels_eintrag: Kachel und Seitenkopf, Überschrift der Testseite, kein „Teaser:“', () => {
  for (const { e, d } of tests) {
    const f = K.felder(d, e);
    const label = (pfad) => f.find((x) => x.pfad === pfad && x.datei === 'eintrag').label;
    assert.strictEqual(label('titel'), 'Kachel und Seitenkopf: Titel', e.id);
    assert.strictEqual(label('motto'), 'Überschrift der Testseite', e.id);
    if (e.kurz) assert.strictEqual(label('kurz'), 'Kachel und Seitenkopf: Kurzinfo', e.id);
    assert.ok(!f.some((x) => x.label.startsWith('Teaser')), e.id);
  }
});

test('hinweise_erscheint: Eintragsfelder, name und status sagen, wo sie erscheinen', () => {
  for (const { e, d } of tests) {
    const f = K.felder(d, e);
    const pflicht = f.filter((x) => x.datei === 'eintrag' || x.pfad === 'name' || x.pfad === 'status');
    assert.ok(pflicht.length >= 4, e.id);
    for (const x of pflicht) assert.match(x.hinweis || '', /^Erscheint: .+\.$/, e.id + ' ' + x.pfad);
  }
  const { e, d } = tests.find((t) => t.d.id === 'antreiber');
  const f = K.felder(d, e);
  const h = (pfad, datei = 'test') => f.find((x) => x.pfad === pfad && x.datei === datei).hinweis;
  assert.match(h('name'), /Betreff/);
  assert.match(h('status'), /Kein Diagnoseinstrument/);
  assert.match(h('motto', 'eintrag'), /Hauptüberschrift/);
  assert.match(h('kurz', 'eintrag'), /So funktioniert es/);
  assert.match(h('beschreibung', 'eintrag'), /Kachel/);
  // bestehender Hinweis bleibt
  assert.ok(h('result.lead').includes('{names}'));
});

test('zeilen: nach Länge, mindestens 2, höchstens 12', () => {
  assert.strictEqual(K.zeilen(''), 2);
  assert.strictEqual(K.zeilen('kurz'), 2);
  assert.strictEqual(K.zeilen('a'.repeat(60)), 2);
  assert.strictEqual(K.zeilen('a'.repeat(61)), 3);
  assert.strictEqual(K.zeilen('a'.repeat(300)), 6);
  assert.strictEqual(K.zeilen('a'.repeat(5000)), 12);
  assert.strictEqual(K.zeilen('a\nb\nc\nd'), 5);
  for (const { e, d } of tests) for (const x of K.felder(d, e)) assert.strictEqual(x.zeilen, K.zeilen(x.wert));
});

test('passt: Suche in Label und Wert, ohne Groß-/Kleinschreibung, auch Umlaute', () => {
  const f = { label: 'Frage 1 (Bereich „Sei perfekt!“)' };
  assert.strictEqual(K.passt(f, 'Ich mache es gründlich', 'PERFEKT'), true);
  assert.strictEqual(K.passt(f, 'Ich mache es gründlich', 'GRÜNDLICH'), true);
  assert.strictEqual(K.passt(f, 'ÄRGER im Team', 'ärger'), true);
  assert.strictEqual(K.passt(f, 'Ich mache es gründlich', 'schnell'), false);
  assert.strictEqual(K.passt(f, 'x', '  frage 1 '), true);
  // zerlegtes ü (u + U+0308) findet auch das zusammengesetzte
  assert.strictEqual(K.passt(f, 'gründlich', 'gründlich'), true);
  assert.strictEqual(K.passt(f, 'x', ''), true);
});

test('fest: Test-name und Eintrag-titel nur als Info, nicht live änderbar', () => {
  for (const { e, d } of tests) {
    const f = K.felder(d, e);
    const fest = f.filter((x) => x.fest).map((x) => x.datei + '|' + x.pfad).sort();
    assert.deepStrictEqual(fest, ['eintrag|titel', 'test|name'], e.id);
    assert.ok(f.filter((x) => !x.fest).length > 10, e.id);
    // Änderungen an festen Feldern zählen nicht
    const n = { test: K.setze(d, 'name', 'Anders'), eintrag: Object.assign({}, e, { titel: 'Anders' }) };
    assert.deepStrictEqual(K.aenderungen({ test: d, eintrag: e }, n, f), [], e.id);
    // Entwürfe für feste Felder werden nicht angewendet (auch nicht als verworfen gemeldet)
    const r = K.entwurfAnwenden({ test: d, eintrag: e }, {
      werte: { 'test|name': 'X', 'eintrag|titel': 'Y' }, basis: { 'test|name': d.name, 'eintrag|titel': e.titel },
    }, f);
    assert.strictEqual(r.angewendet, 0);
    assert.deepStrictEqual(r.verworfen, []);
    assert.strictEqual(r.daten.test.name, d.name);
  }
});

test('export_ohne_pr: keine GitHub-/PR-Helfer mehr', () => {
  assert.strictEqual(K.prText, undefined);
  assert.strictEqual(K.nurErlaubteDateien, undefined);
  assert.strictEqual(K.wendeAn, undefined);
});

test('erfolgText: live -> "Ist live.", sonst Hinweis auf alten Text (kein "wird veröffentlicht")', () => {
  assert.strictEqual(K.erfolgText('Gespeichert', true), 'Gespeichert. Ist live.');
  assert.strictEqual(K.erfolgText('Rückgängig gemacht', true), 'Rückgängig gemacht. Ist live.');
  const nein = K.erfolgText('Gespeichert', false);
  assert.strictEqual(nein, 'Gespeichert, aber die Website zeigt noch den alten Text. Bitte wenden Sie sich an Seitenschwung.');
  assert.doesNotMatch(nein, /Ist live|veröffentlicht/);
  assert.match(K.erfolgText('Rückgängig gemacht', false), /^Rückgängig gemacht, aber die Website zeigt noch den alten Text\./);
});

test('ordneMeldungen: Feldmeldungen je Feld, feldlose getrennt', () => {
  const felder = new Set(['test|name', 'test|questions[0].text', 'eintrag|motto']);
  const r = K.ordneMeldungen([
    { pfad: 'questions[0].text', meldung: 'Darf nicht leer sein' },
    { pfad: 'questions[0].text', meldung: 'Zu lang' },
    { pfad: 'motto', meldung: 'Zu lang' },
    { pfad: '', meldung: 'questions: Anzahl 3 statt 4' },
    { pfad: 'gibtsnicht', meldung: 'Dieses Feld ist nicht änderbar' },
  ], (k) => felder.has(k));
  assert.deepStrictEqual([...r.jeFeld], [
    ['test|questions[0].text', ['Darf nicht leer sein', 'Zu lang']],
    ['eintrag|motto', ['Zu lang']],
  ]);
  assert.deepStrictEqual(r.ohneFeld, ['questions: Anzahl 3 statt 4', 'Dieses Feld ist nicht änderbar']);
  assert.deepStrictEqual(K.ordneMeldungen(undefined, () => true), { jeFeld: new Map(), ohneFeld: [] });
});

test('ausText: je grund eine Meldung, ohne grund neutral', () => {
  assert.match(K.ausText('nicht_schreibbar'), /Datenspeicher/);
  assert.match(K.ausText('gesperrt'), /in einem Moment/);
  assert.match(K.ausText('aus'), /nicht eingeschaltet/);
  assert.match(K.ausText('overlay_unlesbar'), /nicht gelesen/);
  const neutral = 'Der Editor ist gerade nicht verfügbar. Bitte versuchen Sie es in ein paar Minuten erneut.';
  assert.strictEqual(K.ausText(''), neutral);
  assert.strictEqual(K.ausText(undefined), neutral);
  assert.strictEqual(K.ausText('toString'), neutral);
});
