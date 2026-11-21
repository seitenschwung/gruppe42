'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { abdruckPfad, erzeuge } = require('./struktur-erzeugen.js');

const REPO = path.join(__dirname, '..', '..');
const KUNDE = path.join(REPO, 'site', 'kunden', 'gruppe42');
const BUILD = path.join(REPO, 'site', 'vorlagen', 'beratung', 'build.js');

test('abdruck_aktuell', () => {
  const datei = path.join(KUNDE, 'gruppe42.json');
  const eingecheckt = JSON.parse(fs.readFileSync(abdruckPfad(datei), 'utf8'));
  assert.deepStrictEqual(erzeuge(datei), eingecheckt);
});

function baueKopie(aendere) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'g42-'));
  const kopie = path.join(tmp, 'gruppe42');
  fs.cpSync(KUNDE, kopie, { recursive: true });
  // Pfade, die relativ zum Repo liegen (Shop-Daten), in der Kopie absolut machen
  const inhalt = path.join(kopie, 'gruppe42.json');
  const j = JSON.parse(fs.readFileSync(inhalt, 'utf8'));
  if (j.shop && j.shop.produkte) j.shop.produkte = path.resolve(KUNDE, j.shop.produkte);
  fs.writeFileSync(inhalt, JSON.stringify(j, null, 2) + '\n');
  aendere(kopie);
  const r = spawnSync('node', [BUILD, path.join(kopie, 'gruppe42.json')], {
    cwd: REPO, encoding: 'utf8',
    env: { ...process.env, DIST_DIR: path.join(tmp, 'dist'), CACHE_DIR: path.join(tmp, 'cache') },
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  return r;
}

test('build_bricht_ab', () => {
  const r = baueKopie((k) => {
    const p = path.join(k, 'tests', 'teamklima.json');
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    d.questions[0].reverse = true;
    fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n');
  });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /questions\[0\]\.reverse/);
});

test('build_ohne_abdruck', () => {
  const r = baueKopie((k) => fs.rmSync(path.join(k, 'tests', 'struktur.json')));
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /struktur\.json/);
});

test('abdruck_pfad_fest: immer tests/struktur.json neben der Inhalts-JSON, nicht aus den Daten', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'g42-'));
  const datei = path.join(tmp, 'gruppe42.json');
  fs.writeFileSync(datei, JSON.stringify({ tests: { eintraege: [{ id: 'x', daten: '../woanders/x.json' }] } }));
  assert.strictEqual(abdruckPfad(datei), path.join(tmp, 'tests', 'struktur.json'));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('build_leere_eintraege: Abdruck erwartet Tests -> Abbruch mit Anzahl', () => {
  const r = baueKopie((k) => {
    const p = path.join(k, 'gruppe42.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.tests.eintraege = [];
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /tests\.eintraege: Anzahl 0 statt \d+/);
});
