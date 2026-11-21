'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const SKRIPT = path.join(__dirname, 'einpflegen.js');
const FIXTURE = path.join(__dirname, '__fixtures__');

function kopie() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'g42-einpf-'));
  const kunde = path.join(tmp, 'kunde');
  fs.cpSync(FIXTURE, kunde, { recursive: true });
  return { tmp, kunde };
}
const lies = (p) => fs.readFileSync(p, 'utf8');
const sha = (o) => crypto.createHash('sha256').update(JSON.stringify(o, null, 2) + '\n').digest('hex');
function lauf(tmp, kunde, overlay, mitSha) {
  const datei = path.join(tmp, 'overlay.json');
  fs.writeFileSync(datei, JSON.stringify(mitSha ? { overlay, sha256: sha(overlay) } : overlay));
  return spawnSync('node', [SKRIPT, datei, '--kunde', kunde], { encoding: 'utf8' });
}
const alle = (kunde) => [path.join(kunde, 'gruppe42.json')].concat(
  fs.readdirSync(path.join(kunde, 'tests')).map((f) => path.join(kunde, 'tests', f))).map((p) => [p, lies(p)]);

test('wendet_texte_an_und_meldet_sha', () => {
  const { tmp, kunde } = kopie();
  const cfg = JSON.parse(lies(path.join(kunde, 'gruppe42.json')));
  const e = cfg.tests.eintraege[0];
  const t = JSON.parse(lies(path.join(kunde, e.daten)));
  const overlay = {
    version: 1,
    tests: { [t.id]: { 'questions[0].text': 'Neuer Fragetext' } },
    eintraege: { [e.id]: { kurz: 'Neue Kurzfassung' } },
  };
  const r = lauf(tmp, kunde, overlay, true);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(sha(overlay)));
  const t2 = lies(path.join(kunde, e.daten));
  assert.strictEqual(JSON.parse(t2).questions[0].text, 'Neuer Fragetext');
  assert.strictEqual(t2, JSON.stringify(JSON.parse(t2), null, 2) + '\n');
  const c2 = lies(path.join(kunde, 'gruppe42.json'));
  assert.strictEqual(JSON.parse(c2).tests.eintraege[0].kurz, 'Neue Kurzfassung');
  assert.strictEqual(c2, JSON.stringify(JSON.parse(c2), null, 2) + '\n');
  // Bares Overlay ohne Prüfsumme geht auch, zweiter Lauf ändert nichts
  const r2 = lauf(tmp, kunde, overlay, false);
  assert.strictEqual(r2.status, 0, r2.stderr);
  assert.ok(r2.stdout.includes('Keine Änderungen'));
});

test('verwaiste_und_nicht_live_felder_werden_ignoriert', () => {
  const { tmp, kunde } = kopie();
  const vorher = alle(kunde);
  const cfg = JSON.parse(lies(path.join(kunde, 'gruppe42.json')));
  const e = cfg.tests.eintraege[0];
  const t = JSON.parse(lies(path.join(kunde, e.daten)));
  const overlay = {
    version: 1,
    tests: { [t.id]: { 'questions[999].text': 'weg', name: 'Neuer Name' }, 'gibt-es-nicht': { status: 'x' } },
    eintraege: { [e.id]: { titel: 'Neuer Titel' } },
  };
  const r = lauf(tmp, kunde, overlay, true);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('questions[999].text') && r.stdout.includes('name') && r.stdout.includes('titel') && r.stdout.includes('gibt-es-nicht'));
  assert.deepStrictEqual(alle(kunde), vorher);
});

test('wachter_verstoss_schreibt_nichts', () => {
  const { tmp, kunde } = kopie();
  const vorher = alle(kunde);
  const cfg = JSON.parse(lies(path.join(kunde, 'gruppe42.json')));
  const e = cfg.tests.eintraege[0];
  const t = JSON.parse(lies(path.join(kunde, e.daten)));
  const overlay = {
    version: 1,
    tests: { [t.id]: { 'questions[0].text': 'Gut', 'questions[1].text': 'Böse <b>' } },
    eintraege: { [e.id]: { kurz: 'Auch gut' } },
  };
  const r = lauf(tmp, kunde, overlay, true);
  assert.notStrictEqual(r.status, 0);
  assert.ok(r.stderr.includes('questions[1].text'), r.stderr);
  assert.deepStrictEqual(alle(kunde), vorher);
});

test('falsche_pruefsumme_und_kaputte_eingabe', () => {
  const { tmp, kunde } = kopie();
  const vorher = alle(kunde);
  const overlay = { version: 1, tests: {}, eintraege: {} };
  const datei = path.join(tmp, 'o.json');
  fs.writeFileSync(datei, JSON.stringify({ overlay, sha256: '0'.repeat(64) }));
  assert.notStrictEqual(spawnSync('node', [SKRIPT, datei, '--kunde', kunde]).status, 0);
  fs.writeFileSync(datei, '{kaputt');
  assert.notStrictEqual(spawnSync('node', [SKRIPT, datei, '--kunde', kunde]).status, 0);
  assert.deepStrictEqual(alle(kunde), vorher);
});
