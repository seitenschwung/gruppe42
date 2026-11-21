'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createInhalte } = require('./inhalte.js');

const FIXTURE = path.join(__dirname, '..', 'site', 'lib', '__fixtures__');
const ID = 'antreiber-test';

function umgebung() {
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'inhalte-'));
  const basisDir = path.join(wurzel, 'basis');
  fs.cpSync(FIXTURE, basisDir, { recursive: true });
  const dataDir = path.join(wurzel, 'data', 'editor');
  let n = 0;
  const jetzt = () => new Date(Date.UTC(2026, 10, 22, 10, 0, n++));
  const inh = createInhalte({ basisDir, dataDir, jetzt });
  return { wurzel, basisDir, dataDir, inh };
}
const fehlerArt = (fn) => { try { fn(); } catch (e) { return e; } assert.fail('kein Fehler'); };
const frage0 = (inh) => inh.wirksam(ID).daten.questions[0].text;
const aend = (inh, pfad, neu, datei = 'test') => {
  const w = inh.wirksam(ID);
  const alt = (datei === 'test' ? w.daten : w.eintrag);
  const wert = datei === 'eintrag' ? alt[pfad] : pfad.split(/[.[\]]+/).filter(Boolean).reduce((o, k) => o[k], alt);
  return { datei, pfad, alt: wert, neu };
};

test('ohne Overlay entspricht der wirksame Inhalt der Basis', () => {
  const { inh, basisDir } = umgebung();
  const basis = JSON.parse(fs.readFileSync(path.join(basisDir, 'tests/antreiber.json'), 'utf8'));
  const w = inh.wirksam(ID);
  assert.deepEqual(w.daten, basis);
  assert.equal(w.eintrag.id, ID);
  assert.equal(w.eintragIndex, 0);
  assert.deepEqual(w.verwaist, []);
  assert.equal(inh.liste().length, 4);
  assert.deepEqual(inh.liste()[0], { id: ID, titel: 'Antreiber-Test', sichtbar: true });
  assert.equal(inh.testsCfg().eintraege.length, 4);
  assert.equal(fehlerArt(() => inh.wirksam('gibt-es-nicht')).art, 'unbekannt');
});

test('speichern schreibt Overlay und Verlaufzeile, wirksam zeigt den neuen Text', () => {
  const { inh, dataDir } = umgebung();
  const r = inh.speichere(ID, [aend(inh, 'questions[0].text', 'Neuer Fragetext')], 'Ingrid');
  assert.equal(r.nr, 1);
  assert.match(r.zeit, /^2026-11-22T/);
  assert.equal(frage0(inh), 'Neuer Fragetext');
  const overlay = JSON.parse(fs.readFileSync(path.join(dataDir, 'inhalte.json'), 'utf8'));
  assert.deepEqual(overlay, { version: 1, tests: { antreiber: { 'questions[0].text': 'Neuer Fragetext' } }, eintraege: {} });
  const zeilen = fs.readFileSync(path.join(dataDir, 'verlauf.jsonl'), 'utf8').trim().split('\n').map((z) => JSON.parse(z));
  assert.equal(zeilen.length, 1);
  assert.equal(zeilen[0].nr, 1);
  assert.equal(zeilen[0].wer, 'Ingrid');
  assert.equal(zeilen[0].testId, ID);
  assert.equal(zeilen[0].aenderungen[0].neu, 'Neuer Fragetext');
  assert.equal(inh.speichere(ID, [aend(inh, 'motto', 'Neues *Motto*', 'eintrag')], 'Ingrid').nr, 2);
  assert.equal(inh.wirksam(ID).eintrag.motto, 'Neues *Motto*');
  assert.equal(inh.testsCfg().eintraege[0].motto, 'Neues *Motto*');
  assert.equal(inh.verlauf(ID).length, 2);
  assert.equal(inh.verlauf(ID)[0].nr, 2);
  assert.equal(inh.verlauf(ID, 1).length, 1);
  // frische Instanz liest den Stand von der Platte
  const inh2 = createInhalte({ basisDir: path.join(dataDir, '..', '..', 'basis'), dataDir });
  assert.equal(inh2.wirksam(ID).daten.questions[0].text, 'Neuer Fragetext');
  assert.equal(inh2.speichere(ID, [aend(inh2, 'questions[1].text', 'Zweite')], 'x').nr, 3);
});

test('Änderung zurück auf den Basiswert entfernt den Overlay-Schlüssel', () => {
  const { inh, dataDir } = umgebung();
  const basisText = frage0(inh);
  inh.speichere(ID, [aend(inh, 'questions[0].text', 'Anders')], 'a');
  inh.speichere(ID, [aend(inh, 'questions[0].text', basisText)], 'a');
  const overlay = JSON.parse(fs.readFileSync(path.join(dataDir, 'inhalte.json'), 'utf8'));
  assert.deepEqual(overlay, { version: 1, tests: {}, eintraege: {} });
});

test('falsches alt -> konflikt mit Pfad, nichts geschrieben', () => {
  const { inh, dataDir } = umgebung();
  const e = fehlerArt(() => inh.speichere(ID, [{ datei: 'test', pfad: 'questions[0].text', alt: 'falsch', neu: 'x' }], 'a'));
  assert.equal(e.art, 'konflikt');
  assert.equal(e.pfad, 'questions[0].text');
  assert.equal(fs.existsSync(path.join(dataDir, 'inhalte.json')), false);
});

test('all-or-nothing: eine ungültige Änderung verhindert alle', () => {
  const { inh, dataDir } = umgebung();
  const gut = aend(inh, 'questions[0].text', 'Gut');
  const schlecht = aend(inh, 'questions[1].text', 'Schlecht <b>');
  const e = fehlerArt(() => inh.speichere(ID, [gut, schlecht], 'a'));
  assert.equal(e.art, 'ungueltig');
  assert.equal(e.meldungen[0].pfad, 'questions[1].text');
  const e2 = fehlerArt(() => inh.speichere(ID, [gut, { datei: 'test', pfad: 'questions[1].text', alt: 'falsch', neu: 'x' }], 'a'));
  assert.equal(e2.art, 'konflikt');
  assert.notEqual(frage0(inh), 'Gut');
  assert.equal(fs.existsSync(path.join(dataDir, 'inhalte.json')), false);
  assert.equal(fs.existsSync(path.join(dataDir, 'verlauf.jsonl')), false);
});

test('name, titel, reverse, Strukturfelder und unbekannte Pfade -> ungueltig', () => {
  const { inh } = umgebung();
  const w = inh.wirksam('teamklima-check');
  const faelle = [
    { datei: 'test', pfad: 'name', alt: inh.wirksam(ID).daten.name, neu: 'Anders' },
    { datei: 'eintrag', pfad: 'titel', alt: 'Antreiber-Test', neu: 'Anders' },
    { datei: 'eintrag', pfad: 'id', alt: ID, neu: 'anders' },
    { datei: 'eintrag', pfad: 'sichtbar', alt: true, neu: false },
    { datei: 'test', pfad: 'questions[0].zahl', alt: 'a', neu: 'b' },
    { datei: 'test', pfad: 'questions[999].text', alt: 'a', neu: 'b' },
    { datei: 'test', pfad: 'gibtsnicht.text', alt: 'a', neu: 'b' },
    { datei: 'test', pfad: '__proto__.x', alt: 'a', neu: 'b' },
    { datei: 'test', pfad: 'questions[0].text.x', alt: 'a', neu: 'b' },
    { datei: 'test', pfad: 'questions[00].text', alt: 'a', neu: 'b' },
    { datei: 'sonstwas', pfad: 'name', alt: 'a', neu: 'b' },
  ];
  for (const f of faelle) assert.equal(fehlerArt(() => inh.speichere(ID, [f], 'a')).art, 'ungueltig', JSON.stringify(f));
  const r = w.daten.questions.findIndex((q) => q.reverse);
  const e = fehlerArt(() => inh.speichere('teamklima-check', [{ datei: 'test', pfad: `questions[${r}].reverse`, alt: true, neu: false }], 'a'));
  assert.equal(e.art, 'ungueltig');
  assert.equal(e.meldungen[0].pfad, `questions[${r}].reverse`);
  assert.equal(fehlerArt(() => inh.speichere(ID, [], 'a')).art, 'ungueltig');
  assert.equal(fehlerArt(() => inh.speichere('nein', [faelle[0]], 'a')).art, 'unbekannt');
  const kein = aend(inh, 'questions[0].text', frage0(inh));
  assert.equal(fehlerArt(() => inh.speichere(ID, [kein], 'a')).art, 'ungueltig');
});

test('Wächterverstöße -> ungueltig mit Pfad', () => {
  const { inh } = umgebung();
  const versuche = [
    'Mit <b>Tag</b>', 'Steuer\u0001zeichen', 'Zeile\nzwei', 'Unsichtbar​es', 'Link [x](http://a)', '   ', 'x'.repeat(401), 'Mit *Stern*',
  ];
  for (const text of versuche) {
    const e = fehlerArt(() => inh.speichere(ID, [aend(inh, 'questions[0].text', text)], 'a'));
    assert.equal(e.art, 'ungueltig', text);
    assert.equal(e.meldungen[0].pfad, 'questions[0].text', text);
  }
  // Platzhalter {names} entfernen oder verdoppeln
  const alt = inh.wirksam(ID).daten.result.lead;
  assert.ok(alt.includes('{names}'));
  const ohne = fehlerArt(() => inh.speichere(ID, [aend(inh, 'result.lead', 'Ohne Platzhalter')], 'a'));
  assert.equal(ohne.art, 'ungueltig');
  assert.match(ohne.meldungen[0].pfad, /result\.lead/);
  assert.match(ohne.meldungen[0].meldung, /\{names\}/);
  assert.equal(fehlerArt(() => inh.speichere(ID, [aend(inh, 'result.lead', '{names} und {names}')], 'a')).art, 'ungueltig');
  assert.equal(inh.speichere(ID, [aend(inh, 'result.lead', 'Neu: {names}')], 'a').nr, 1);
  // Einträge: Betonung nur in motto
  assert.equal(fehlerArt(() => inh.speichere(ID, [aend(inh, 'kurz', 'Mit *x*', 'eintrag')], 'a')).art, 'ungueltig');
  assert.equal(inh.speichere(ID, [aend(inh, 'kurz', 'Neu kurz', 'eintrag')], 'a').nr, 2);
});

test('verwaister Overlay-Pfad wird ignoriert und gemeldet', () => {
  const { inh, dataDir } = umgebung();
  inh.speichere(ID, [aend(inh, 'questions[0].text', 'Gut')], 'a');
  const p = path.join(dataDir, 'inhalte.json');
  const o = JSON.parse(fs.readFileSync(p, 'utf8'));
  o.tests.antreiber['questions[999].text'] = 'Weg';
  o.tests.antreiber.name = 'Böse';
  o.tests.antreiber['questions[1].text'] = '<script>';
  o.eintraege[ID] = { titel: 'Böse', motto: 'Ok *so*' };
  fs.writeFileSync(p, JSON.stringify(o));
  const w = inh.wirksam(ID);
  assert.equal(w.daten.questions[0].text, 'Gut');
  assert.notEqual(w.daten.questions[1].text, '<script>');
  assert.equal(w.daten.name, inh.wirksam(ID).daten.name);
  assert.equal(w.eintrag.titel, 'Antreiber-Test');
  assert.equal(w.eintrag.motto, 'Ok *so*');
  assert.deepEqual(w.verwaist.sort(), ['eintrag:titel', 'test:name', 'test:questions[1].text', 'test:questions[999].text']);
});

test('rueckgaengig stellt alt wieder her, Konflikt wenn das Feld inzwischen anders ist', () => {
  const { inh } = umgebung();
  const basisText = frage0(inh);
  const a = inh.speichere(ID, [aend(inh, 'questions[0].text', 'Eins')], 'a');
  const b = inh.speichere(ID, [aend(inh, 'questions[0].text', 'Zwei')], 'a');
  const e = fehlerArt(() => inh.rueckgaengig(a.nr, 'b'));
  assert.equal(e.art, 'konflikt');
  assert.equal(e.pfad, 'questions[0].text');
  const r = inh.rueckgaengig(b.nr, 'b');
  assert.equal(r.nr, 3);
  assert.equal(r.testId, ID);
  assert.equal(frage0(inh), 'Eins');
  inh.rueckgaengig(a.nr, 'b');
  assert.equal(frage0(inh), basisText);
  assert.equal(inh.verlauf(ID)[0].wer, 'b');
  assert.equal(inh.verlauf(ID)[0].rueckgaengigVon, a.nr);
  assert.equal(fehlerArt(() => inh.rueckgaengig(99, 'b')).art, 'unbekannt');
});

test('Datenverzeichnis nicht schreibbar -> verfuegbar false, speichere wirft nicht_verfuegbar', () => {
  const { wurzel, basisDir } = umgebung();
  const datei = path.join(wurzel, 'keinverzeichnis');
  fs.writeFileSync(datei, 'x');
  const inh = createInhalte({ basisDir, dataDir: path.join(datei, 'editor') });
  assert.equal(inh.verfuegbar(), false);
  assert.equal(inh.wirksam(ID).daten.id, 'antreiber');
  assert.equal(fehlerArt(() => inh.speichere(ID, [aend(inh, 'questions[0].text', 'x')], 'a')).art, 'nicht_verfuegbar');
  assert.equal(fehlerArt(() => inh.leeren('x')).art, 'nicht_verfuegbar');
});

test('Verzeichnis wird angelegt; keine .tmp-Reste', () => {
  const { inh, dataDir } = umgebung();
  assert.equal(inh.verfuegbar(), true);
  inh.speichere(ID, [aend(inh, 'questions[0].text', 'A')], 'a');
  inh.speichere(ID, [aend(inh, 'questions[0].text', 'B')], 'a');
  assert.deepEqual(fs.readdirSync(dataDir).sort(), ['inhalte.json', 'verlauf.jsonl']);
});

test('export und leeren: sha256 muss zum Stand passen', () => {
  const { inh, dataDir } = umgebung();
  inh.speichere(ID, [aend(inh, 'questions[0].text', 'A')], 'a');
  const ex = inh.export();
  assert.equal(ex.overlay.tests.antreiber['questions[0].text'], 'A');
  assert.match(ex.sha256, /^[0-9a-f]{64}$/);
  assert.equal(inh.leeren('0'.repeat(64)), false);
  assert.equal(frage0(inh), 'A');
  inh.speichere(ID, [aend(inh, 'questions[1].text', 'B')], 'a');
  assert.equal(inh.leeren(ex.sha256), false, 'Stand hat sich geändert');
  assert.equal(inh.leeren(inh.export().sha256), true);
  assert.notEqual(frage0(inh), 'A');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'inhalte.json'), 'utf8')), { version: 1, tests: {}, eintraege: {} });
  assert.equal(inh.speichere(ID, [aend(inh, 'questions[0].text', 'C')], 'a').nr, 3, 'nr läuft weiter');
});
