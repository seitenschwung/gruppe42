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
  const paar = K.aenderungen({ test: d, eintrag: e }, { test: d, eintrag: Object.assign({}, e, { titel: 'T2' }) }, f);
  assert.deepStrictEqual(paar.map((x) => x.neu), ['T2']);
});

test('pr_text', () => {
  const liste = [{ label: 'Frage 3 (Bereich „X“)', alt: 'a', neu: 'b' }, { label: 'Name des Tests', alt: 'c', neu: 'd' }];
  const r = K.prText('Antreiber-Test', liste, 'Bitte prüfen.');
  assert.strictEqual(r.titel, 'Inhalt: Antreiber-Test (2 Änderungen)');
  assert.strictEqual(r.text,
    'Bitte prüfen.\n\n- Frage 3 (Bereich „X“): „a“ → „b“\n- Name des Tests: „c“ → „d“\n\nErstellt mit dem Test-Editor.');
  const ohne = K.prText('T', liste.slice(0, 1), '');
  assert.ok(ohne.text.startsWith('- Frage 3'));
  assert.strictEqual(ohne.titel, 'Inhalt: T (1 Änderung)');
});

test('pr_text_entschaerft: keine Erwähnungen/Querverweise, Listenpunkte einzeilig', () => {
  const liste = [{ label: 'Frage 1', alt: 'hallo @team/x\nzweite Zeile', neu: 'siehe #12\r\nund o/r#5' }];
  const r = K.prText('Test @a #3', liste, 'Danke @someone, siehe #12.\n\nAbsatz bleibt');
  const alles = r.titel + '\n' + r.text;
  assert.ok(!/@(?!\u200b)/.test(alles));
  assert.ok(!/#(?=\d)/.test(alles));
  assert.ok(r.text.includes('@\u200bsomeone') && r.text.includes('#\u200b12'));
  assert.ok(r.text.includes('Danke @\u200bsomeone, siehe #\u200b12.\n\nAbsatz bleibt'));
  const zeilen = r.text.split('\n').filter((z) => z.startsWith('- '));
  assert.strictEqual(zeilen.length, 1);
  assert.ok(zeilen[0].includes('zweite Zeile') && zeilen[0].includes('und o/r#\u200b5'));
});

test('setze_pfadarten: length und Nicht-Zahlen bei Arrays werden abgelehnt', () => {
  const o = { a: ['x', 'y'] };
  assert.throws(() => K.setze(o, 'a.length', 1), /Pfad/);
  assert.throws(() => K.setze(o, 'a.0', 'z'), /Pfad/);
  assert.throws(() => K.setze(o, 'a[5]', 'z'), /Pfad/);
  assert.deepStrictEqual(K.setze(o, 'a[1]', 'z'), { a: ['x', 'z'] });
});

test('wende_an: fremde Änderung auf main bleibt, eigene kommt dazu', () => {
  const { e, d } = tests[0];
  const f = K.felder(d, e).filter((x) => x.datei === 'test');
  const jetzt = K.setze(d, 'questions[2].text', 'Neu von Ingrid');
  // Inzwischen auf main: anderes Textfeld und ein Nicht-Textfeld geändert
  let frisch = K.setze(d, 'questions[5].text', 'Fremd geändert');
  frisch = K.setze(frisch, 'result.kind', d.result.kind);
  frisch = Object.assign({}, frisch, { neuesFeld: 1 });
  const r = K.wendeAn(frisch, d, jetzt, f);
  assert.ok(!r.konflikt);
  assert.strictEqual(r.daten.questions[2].text, 'Neu von Ingrid');
  assert.strictEqual(r.daten.questions[5].text, 'Fremd geändert');
  assert.strictEqual(r.daten.neuesFeld, 1);
  assert.strictEqual(d.questions[2].text, tests[0].d.questions[2].text, 'Start unverändert');
});

test('wende_an: dasselbe Feld inzwischen geändert -> konflikt', () => {
  const { e, d } = tests[0];
  const f = K.felder(d, e).filter((x) => x.datei === 'test');
  const jetzt = K.setze(d, 'questions[2].text', 'Neu von Ingrid');
  const frisch = K.setze(d, 'questions[2].text', 'Anders auf main');
  assert.deepStrictEqual(K.wendeAn(frisch, d, jetzt, f), { konflikt: 'questions[2].text' });
  // Feld auf main entfernt (Struktur geändert) -> ebenfalls konflikt
  const ohne = Object.assign({}, d, { questions: d.questions.slice(0, 2) });
  assert.deepStrictEqual(K.wendeAn(ohne, d, jetzt, f), { konflikt: 'questions[2].text' });
  // Keine eigenen Änderungen -> frischer Stand unverändert zurück
  assert.strictEqual(K.wendeAn(frisch, d, d, f).daten, frisch);
});

test('wende_an: frischer Wert ist schon der eigene neue Wert -> kein Konflikt', () => {
  const { e, d } = tests[0];
  const f = K.felder(d, e).filter((x) => x.datei === 'test');
  const jetzt = K.setze(d, 'questions[2].text', 'Neu von Ingrid');
  const frisch = K.setze(d, 'questions[2].text', 'Neu von Ingrid');
  const r = K.wendeAn(frisch, d, jetzt, f);
  assert.ok(!r.konflikt);
  assert.strictEqual(r.daten.questions[2].text, 'Neu von Ingrid');
  assert.strictEqual(r.daten, frisch, 'nichts zu ändern -> derselbe Stand');
});

test('entwurf_anwenden: nur Felder mit unveränderter Basis, sonst verworfen mit Label', () => {
  const { e, d } = tests[0];
  const f = K.felder(d, e);
  const stand = { test: d, eintrag: e };
  const q2 = f.find((x) => x.pfad === 'questions[2].text');
  const q5 = f.find((x) => x.pfad === 'questions[5].text');
  const titel = f.find((x) => x.datei === 'eintrag' && x.pfad === 'titel');
  const entwurf = {
    werte: { 'test|questions[2].text': 'Entwurf 2', 'test|questions[5].text': 'Entwurf 5', 'eintrag|titel': 'Neuer Titel' },
    basis: { 'test|questions[2].text': d.questions[2].text, 'test|questions[5].text': 'Alter Stand', 'eintrag|titel': e.titel },
  };
  const r = K.entwurfAnwenden(stand, entwurf, f);
  assert.strictEqual(r.daten.test.questions[2].text, 'Entwurf 2');
  assert.strictEqual(r.daten.test.questions[5].text, d.questions[5].text, 'Repo-Wert bleibt');
  assert.strictEqual(r.daten.eintrag.titel, 'Neuer Titel');
  assert.strictEqual(r.angewendet, 2);
  assert.deepStrictEqual(r.verworfen, [q5.label]);
  assert.ok(q2 && titel);
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
