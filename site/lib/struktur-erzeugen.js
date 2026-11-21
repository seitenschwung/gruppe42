#!/usr/bin/env node
'use strict';
// Strukturabdruck der Selbsttests: hält fest, welche Felder (außer den Textfeldern) die Test-JSONs und
// tests.eintraege haben. Der Build vergleicht dagegen (siehe testwaechter.js). Nach bewusster Strukturänderung neu erzeugen:
//   node site/lib/struktur-erzeugen.js site/kunden/gruppe42/gruppe42.json
const fs = require('fs');
const path = require('path');
const { TEXTFELDER_TEST, TEXTFELDER_EINTRAG, struktur } = require('./testwaechter.js');

const ABDRUCK_DATEI = 'struktur.json';

const liste = (x) => (Array.isArray(x) ? x : []);

// Fester Ort: tests/struktur.json neben der Inhalts-JSON (nicht aus den Daten abgeleitet, damit eine
// Änderung an tests.eintraege den Abdruck nicht umlenken kann).
function abdruckPfad(inhaltsDatei) {
  return path.join(path.dirname(path.resolve(inhaltsDatei)), 'tests', ABDRUCK_DATEI);
}

function erzeuge(inhaltsDatei) {
  const dir = path.dirname(path.resolve(inhaltsDatei));
  const s = JSON.parse(fs.readFileSync(inhaltsDatei, 'utf8'));
  const eintraege = liste(s.tests && s.tests.eintraege);
  const tests = {};
  for (const e of eintraege) {
    if (!e || !e.daten) continue;
    const daten = JSON.parse(fs.readFileSync(path.resolve(dir, e.daten), 'utf8'));
    tests[daten.id] = struktur(daten, TEXTFELDER_TEST);
  }
  return { version: 1, tests, eintraege: eintraege.map((e) => struktur(e, TEXTFELDER_EINTRAG)) };
}

module.exports = { ABDRUCK_DATEI, abdruckPfad, erzeuge };

if (require.main === module) {
  const datei = process.argv[2];
  if (!datei) { console.error('Aufruf: node site/lib/struktur-erzeugen.js <pfad>/gruppe42.json'); process.exit(1); }
  const ziel = abdruckPfad(datei);
  fs.writeFileSync(ziel, JSON.stringify(erzeuge(datei), null, 2) + '\n');
  console.log('✔ ' + ziel + ' geschrieben');
}
