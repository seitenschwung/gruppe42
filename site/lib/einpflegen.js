#!/usr/bin/env node
'use strict';
// Repo-Abgleich: überträgt das Live-Overlay (Export aus dem Container) in die Inhaltsdateien des Repos.
//   node server/editor-export.js > overlay.json        (im Container)
//   node site/lib/einpflegen.js overlay.json [--kunde site/kunden/gruppe42]
// Wendet nur erlaubte Textfelder an (Wächter-Textfelder außer Test-name und Eintrag-titel), prüft mit dem Wächter
// (Texte + Struktur) und schreibt erst, wenn alles in Ordnung ist. Danach: commit/PR, deploy, dann
//   node server/editor-export.js --leeren <sha256>      (im Container; die ausgegebene Prüfsumme)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const W = require('./testwaechter.js');

const NICHT_LIVE = { test: ['name'], eintrag: ['titel'] };
const hat = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const istObjekt = (w) => w !== null && typeof w === 'object' && !Array.isArray(w);
const serial = (x) => JSON.stringify(x, null, 2) + '\n';

// "questions[3].text" -> ['questions', 3, 'text']; null, wenn nicht kanonisch.
function schritte(pfad) {
  if (typeof pfad !== 'string' || !pfad) return null;
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  const aus = [];
  let pos = 0;
  let m;
  while ((m = re.exec(pfad))) {
    if (m.index !== pos && !(m.index === pos + 1 && pfad[pos] === '.')) return null;
    pos = re.lastIndex;
    aus.push(m[1] !== undefined ? m[1] : Number(m[2]));
  }
  if (pos !== pfad.length || !aus.length) return null;
  const kanon = aus.reduce((s, t, i) => (typeof t === 'number' ? s + '[' + t + ']' : s + (i ? '.' : '') + t), '');
  return kanon === pfad && typeof aus[0] === 'string' ? aus : null;
}
function hole(wurzel, st) {
  let w = wurzel;
  for (const t of st) {
    if (typeof t === 'number') { if (!Array.isArray(w) || t >= w.length) return undefined; w = w[t]; }
    else { if (!istObjekt(w) || !hat(w, t)) return undefined; w = w[t]; }
  }
  return w;
}

// Reine Logik: -> { fehler: [..], dateien: { relativerPfad: objekt }, bericht: { datei: n }, verwaist: [..], sha256 }
function berechne(kundeDir, eingabe) {
  const rohOverlay = istObjekt(eingabe) && hat(eingabe, 'overlay') ? eingabe.overlay : eingabe;
  const fehler = [];
  const bericht = {};
  const verwaist = [];
  const dateien = {};
  if (!istObjekt(rohOverlay) || rohOverlay.version !== 1 || !istObjekt(rohOverlay.tests) || !istObjekt(rohOverlay.eintraege)) {
    return { fehler: ['Eingabe ist kein gültiges Overlay (version 1, tests, eintraege)'], dateien, bericht, verwaist, sha256: null };
  }
  const sha256 = crypto.createHash('sha256').update(serial(rohOverlay)).digest('hex');
  if (istObjekt(eingabe) && hat(eingabe, 'sha256') && eingabe.sha256 !== sha256) {
    return { fehler: ['Prüfsumme passt nicht zum Overlay (Datei verändert?)'], dateien, bericht, verwaist, sha256 };
  }
  const lies = (rel) => JSON.parse(fs.readFileSync(path.join(kundeDir, rel), 'utf8'));
  const cfg = lies('gruppe42.json');
  const abdruck = lies(path.join('tests', 'struktur.json'));
  const eintraege = (cfg.tests && Array.isArray(cfg.tests.eintraege)) ? cfg.tests.eintraege : [];
  const bekannteTests = new Set();
  const bekannteEintraege = new Set();
  let cfgGeaendert = false;

  eintraege.forEach((e, index) => {
    if (!e || !e.id || !e.daten) return;
    const datenRel = path.normalize(e.daten);
    const daten = lies(datenRel);
    bekannteTests.add(daten.id);
    bekannteEintraege.add(e.id);
    const quellen = [
      ['test', daten, rohOverlay.tests[daten.id], W.TEXTFELDER_TEST, datenRel],
      ['eintrag', e, rohOverlay.eintraege[e.id], W.TEXTFELDER_EINTRAG, 'gruppe42.json'],
    ];
    for (const [art, ziel, o, felder, datei] of quellen) {
      if (!istObjekt(o)) continue;
      const bez = art === 'test' ? daten.id : e.id;
      let n = 0;
      for (const pfad of Object.keys(o)) {
        const st = schritte(pfad);
        const ok = st && felder.includes(W.muster(pfad)) && !NICHT_LIVE[art].includes(W.muster(pfad))
          && typeof hole(ziel, st) === 'string' && typeof o[pfad] === 'string';
        if (!ok) { verwaist.push(art + ':' + bez + ':' + pfad); continue; }
        const eltern = hole(ziel, st.slice(0, -1));
        const schluessel = st[st.length - 1];
        if (eltern[schluessel] !== o[pfad]) {
          eltern[schluessel] = o[pfad];
          n++;
          dateien[datei] = true;
          if (datei === 'gruppe42.json') cfgGeaendert = true;
        }
      }
      if (n) bericht[datei] = (bericht[datei] || 0) + n;
    }
    // Wächter auf die neue Fassung
    W.pruefeTexte(daten, W.TEXTFELDER_TEST).forEach((m) => fehler.push(daten.id + ': ' + m.pfad + ': ' + m.meldung));
    if (!abdruck.tests || !abdruck.tests[daten.id]) fehler.push(daten.id + ': Kein Struktur-Abdruck');
    else W.pruefeStruktur(daten, abdruck.tests[daten.id], W.TEXTFELDER_TEST).forEach((m) => fehler.push(daten.id + ': ' + m));
    W.pruefeTexte(e, W.TEXTFELDER_EINTRAG).forEach((m) => fehler.push(e.id + ': ' + m.pfad + ': ' + m.meldung));
    const soll = abdruck.eintraege && abdruck.eintraege[index];
    if (!soll) fehler.push(e.id + ': Kein Struktur-Abdruck für den Eintrag');
    else W.pruefeStruktur(e, soll, W.TEXTFELDER_EINTRAG).forEach((m) => fehler.push(e.id + ': ' + m));
    if (dateien[datenRel]) dateien[datenRel] = daten;
  });
  for (const k of Object.keys(rohOverlay.tests)) if (!bekannteTests.has(k)) verwaist.push('test:' + k + ' (unbekannt)');
  for (const k of Object.keys(rohOverlay.eintraege)) if (!bekannteEintraege.has(k)) verwaist.push('eintrag:' + k + ' (unbekannt)');
  if (cfgGeaendert) dateien['gruppe42.json'] = cfg; else delete dateien['gruppe42.json'];
  for (const k of Object.keys(dateien)) if (dateien[k] === true) delete dateien[k];
  return { fehler, dateien, bericht, verwaist, sha256 };
}

function main(argv, out, err) {
  const args = argv.slice();
  let kunde = path.join(__dirname, '..', 'kunden', 'gruppe42');
  const i = args.indexOf('--kunde');
  if (i >= 0) { kunde = path.resolve(args[i + 1] || ''); args.splice(i, 2); }
  if (args.length !== 1) { err('Aufruf: einpflegen.js <overlay.json> [--kunde <dir>]\n'); return 2; }
  let eingabe;
  try { eingabe = JSON.parse(fs.readFileSync(args[0], 'utf8')); } catch (e) { err('Fehler: Overlay-Datei nicht lesbar oder kein JSON\n'); return 1; }
  let r;
  try { r = berechne(kunde, eingabe); } catch (e) { err('Fehler: Inhaltsdateien nicht lesbar (' + e.message + ')\n'); return 1; }
  if (r.fehler.length) {
    err('Nichts geschrieben. Der Wächter lehnt ab:\n' + r.fehler.map((f) => '  - ' + f).join('\n') + '\n');
    return 1;
  }
  for (const rel of Object.keys(r.dateien)) {
    const ziel = path.join(kunde, rel);
    const tmp = ziel + '.tmp-' + process.pid;
    try { fs.writeFileSync(tmp, serial(r.dateien[rel])); fs.renameSync(tmp, ziel); } catch (e) {
      try { fs.unlinkSync(tmp); } catch (e2) { /* nichts da */ }
      err('Fehler: Schreiben von ' + rel + ' fehlgeschlagen (' + e.message + ')\n');
      return 1;
    }
  }
  const dateiNamen = Object.keys(r.bericht);
  out(dateiNamen.length ? dateiNamen.map((d) => '  ' + d + ': ' + r.bericht[d] + ' Feld(er) geändert').join('\n') + '\n' : '  Keine Änderungen gegenüber dem Repo.\n');
  if (r.verwaist.length) out('Ignoriert (nicht mehr vorhanden oder nicht änderbar):\n' + r.verwaist.map((v) => '  - ' + v).join('\n') + '\n');
  out('sha256 für "node server/editor-export.js --leeren <sha256>": ' + r.sha256 + '\n');
  return 0;
}

module.exports = { berechne, main };

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2), (s) => process.stdout.write(s), (s) => process.stderr.write(s));
}
