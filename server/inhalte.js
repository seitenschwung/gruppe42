'use strict';
// Live-Inhalte: Basis (Image) + Overlay (Textüberschreibungen im Datenverzeichnis) + Verlauf.
// Serverseitiger Durchsetzungspunkt: was hier gespeichert wird, zeigt die öffentliche Seite ohne Freigabe.
// Alle Prüfungen laufen über den gemeinsamen Wächter (site/lib/testwaechter.js).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const W = require('../site/lib/testwaechter.js');
const { mitSperre } = require('./datei-sperre');

const OVERLAY_DATEI = 'inhalte.json';
const VERLAUF_DATEI = 'verlauf.jsonl';
// Test-name und Eintrag-titel stehen in <title>, JSON-LD und Methodik-Tabelle: nicht live änderbar.
const NICHT_LIVE = { test: ['name'], eintrag: ['titel'] };

const hat = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const kopie = (x) => JSON.parse(JSON.stringify(x));
const istObjekt = (w) => w !== null && typeof w === 'object' && !Array.isArray(w);
const serial = (x) => JSON.stringify(x, null, 2) + '\n';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function fehler(art, text, extra) {
  const e = new Error(text || art);
  e.art = art;
  return Object.assign(e, extra || {});
}

// "questions[3].text" -> ['questions', 3, 'text']; null bei allem, was nicht kanonisch ist.
function schritte(pfad) {
  if (typeof pfad !== 'string' || !pfad) return null;
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  const aus = [];
  let m;
  let pos = 0;
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
function setze(wurzel, st, wert) {
  const eltern = hole(wurzel, st.slice(0, -1));
  eltern[st[st.length - 1]] = wert;
}
const muster = W.muster;

function meldungVonText(prefix, text) {
  const i = text.indexOf(': ');
  return i > 0 ? { pfad: text.slice(0, i), meldung: text.slice(i + 2) } : { pfad: prefix || '', meldung: text };
}

// Wirft synchron, wenn Basis (gruppe42.json, tests/*.json) oder tests/struktur.json fehlen oder unlesbar sind;
// der Aufrufer (Server-Start) muss das abfangen. Das Datenverzeichnis wird dagegen erst bei Bedarf geprüft.
function createInhalte({ basisDir, dataDir, jetzt = () => new Date() }) {
  const lies = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
  const basisCfg = lies(path.join(basisDir, 'gruppe42.json'));
  const abdruck = lies(path.join(basisDir, 'tests', 'struktur.json'));
  const testsCfgBasis = (basisCfg.tests) || {};
  const eintraegeBasis = (Array.isArray(testsCfgBasis.eintraege) ? testsCfgBasis.eintraege : []);
  const tests = new Map(); // eintrag.id -> {eintrag, index, daten, datenId}
  eintraegeBasis.forEach((e, index) => {
    if (!e || !e.id || !e.daten) return;
    const daten = lies(path.resolve(basisDir, e.daten));
    if (!abdruck.tests || !abdruck.tests[daten.id]) throw new Error('Kein Struktur-Abdruck für Test "' + daten.id + '"');
    tests.set(e.id, { eintrag: e, index, daten, datenId: daten.id });
  });

  const overlayPfad = path.join(dataDir, OVERLAY_DATEI);
  const verlaufPfad = path.join(dataDir, VERLAUF_DATEI);
  const leer = () => ({ version: 1, tests: {}, eintraege: {} });

  // null = Overlay vorhanden, aber unlesbar/falsch aufgebaut (nie überschreiben); fehlende Datei = leer.
  function leseOverlay() {
    let text;
    try { text = fs.readFileSync(overlayPfad, 'utf8'); } catch (e) { return e.code === 'ENOENT' || e.code === 'ENOTDIR' ? leer() : null; }
    try {
      const o = JSON.parse(text);
      if (!istObjekt(o) || o.version !== 1 || !istObjekt(o.tests) || !istObjekt(o.eintraege)) return null;
      return o;
    } catch (e) { return null; }
  }
  // Alle Zeilen (ungültige bleiben unberührt und werden hier übersprungen).
  function leseZeilen() {
    let text;
    try { text = fs.readFileSync(verlaufPfad, 'utf8'); } catch (e) { return []; }
    const aus = [];
    for (const z of text.split('\n')) {
      if (!z.trim()) continue;
      try { const o = JSON.parse(z); if (istObjekt(o)) aus.push(o); } catch (e) { /* kaputte Zeile überspringen */ }
    }
    return aus;
  }
  // Wirksame Verlaufseinträge: ohne Fehlschlag-Marker und ohne die als fehlgeschlagen markierten Zeilen.
  function leseVerlauf() {
    const alle = leseZeilen();
    const schlecht = new Set(alle.filter((z) => z.ergebnis === 'fehlgeschlagen').map((z) => z.nr));
    return alle.filter((z) => z.ergebnis !== 'fehlgeschlagen' && !schlecht.has(z.nr));
  }
  function haengeAn(zeile) {
    let vorsatz = '';
    try {
      const fd = fs.openSync(verlaufPfad, 'r');
      try {
        const groesse = fs.fstatSync(fd).size;
        if (groesse) { const b = Buffer.alloc(1); fs.readSync(fd, b, 0, 1, groesse - 1); if (b[0] !== 10) vorsatz = '\n'; }
      } finally { fs.closeSync(fd); }
    } catch (e) { /* Datei fehlt noch */ }
    fs.appendFileSync(verlaufPfad, vorsatz + JSON.stringify(zeile) + '\n', { mode: 0o600 });
  }

  // Prüfung einer wirksamen Fassung: Textregeln und Struktur. [] = ok.
  function pruefe(t, daten, eintrag) {
    const aus = [];
    W.pruefeTexte(daten, W.TEXTFELDER_TEST).forEach((m) => aus.push({ pfad: m.pfad, meldung: m.meldung }));
    W.pruefeStruktur(daten, abdruck.tests[t.datenId], W.TEXTFELDER_TEST).forEach((m) => aus.push(meldungVonText('', m)));
    W.pruefeTexte(eintrag, W.TEXTFELDER_EINTRAG).forEach((m) => aus.push({ pfad: m.pfad, meldung: m.meldung }));
    const soll = abdruck.eintraege && abdruck.eintraege[t.index];
    if (!soll) aus.push({ pfad: '', meldung: 'Kein Struktur-Abdruck für den Eintrag' });
    else W.pruefeStruktur(eintrag, soll, W.TEXTFELDER_EINTRAG).forEach((m) => aus.push(meldungVonText('', m)));
    return aus;
  }

  // Ist der Pfad ein live änderbares Textfeld der Basis? -> Schritte oder null.
  function editierbar(t, datei, pfad) {
    const st = schritte(pfad);
    if (!st) return null;
    const m = muster(pfad);
    const felder = datei === 'test' ? W.TEXTFELDER_TEST : W.TEXTFELDER_EINTRAG;
    if (!felder.includes(m) || NICHT_LIVE[datei].includes(m)) return null;
    const basis = datei === 'test' ? t.daten : t.eintrag;
    return typeof hole(basis, st) === 'string' ? st : null;
  }

  function wirksamMit(t, overlay) {
    const daten = kopie(t.daten);
    const eintrag = kopie(t.eintrag);
    const verwaist = [];
    const quellen = [
      ['test', daten, (overlay.tests && overlay.tests[t.datenId]) || {}],
      ['eintrag', eintrag, (overlay.eintraege && overlay.eintraege[t.eintrag.id]) || {}],
    ];
    for (const [datei, ziel, o] of quellen) {
      if (!istObjekt(o)) continue;
      for (const pfad of Object.keys(o)) {
        const st = editierbar(t, datei, pfad);
        if (!st || typeof o[pfad] !== 'string') { verwaist.push(datei + ':' + pfad); continue; }
        const vorher = hole(ziel, st);
        setze(ziel, st, o[pfad]);
        // Wert, der den Wächter verletzt (z. B. nach Änderung der Basis), nicht ausliefern.
        if (pruefe(t, daten, eintrag).length) { setze(ziel, st, vorher); verwaist.push(datei + ':' + pfad); }
      }
    }
    return { daten, eintrag, eintragIndex: t.index, verwaist };
  }

  function finde(testId) {
    const t = tests.get(testId);
    if (!t) throw fehler('unbekannt', 'Unbekannter Test');
    return t;
  }

  // --- Verfügbarkeit ---
  let schreibbarCache = false;
  function probe() {
    try {
      fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      const p = path.join(dataDir, '.probe-' + process.pid + '-' + crypto.randomBytes(4).toString('hex'));
      fs.writeFileSync(p, 'x', { mode: 0o600 });
      fs.unlinkSync(p);
      return true;
    } catch (e) { return false; }
  }
  // 'ok' | 'overlay_unlesbar' | 'nicht_schreibbar'. Erfolg der Schreibprobe wird gemerkt, ein Fehlschlag jedes Mal neu geprüft.
  function zustand() {
    if (leseOverlay() === null) return 'overlay_unlesbar';
    if (!schreibbarCache) schreibbarCache = probe();
    return schreibbarCache ? 'ok' : 'nicht_schreibbar';
  }
  function verfuegbar() { return zustand() === 'ok'; }

  function schreibeAtomar(pfad, text) {
    const tmp = pfad + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
    try {
      fs.writeFileSync(tmp, text, { mode: 0o600 });
      fs.renameSync(tmp, pfad);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (e2) { /* nichts da */ }
      throw e;
    }
  }

  // Lesen-Ändern-Schreiben unter der Dateisperre (gemeinsam mit den CLIs, z. B. Export/Leeren).
  // Sperre nicht zu bekommen -> nicht_verfuegbar (gesperrt: true), Schreibbarkeit bleibt gemerkt.
  function gesperrt(fn) {
    try { return mitSperre(dataDir, fn); } catch (e) {
      if (e.art === 'gesperrt') throw fehler('nicht_verfuegbar', 'Datenverzeichnis gesperrt', { gesperrt: true });
      if (!e.art) { schreibbarCache = false; throw fehler('nicht_verfuegbar', 'Schreiben fehlgeschlagen'); }
      throw e;
    }
  }

  function uebernehme(testId, aenderungen, wer, extraZeile) {
    if (!verfuegbar()) throw fehler('nicht_verfuegbar', 'Speicher nicht verfügbar');
    return gesperrt(() => uebernehmeGesperrt(testId, aenderungen, wer, extraZeile));
  }

  // Synchron: kein await, daher können zwei Aufrufe im Prozess nicht ineinander laufen.
  function uebernehmeGesperrt(testId, aenderungen, wer, extraZeile) {
    const t = finde(testId);
    if (!Array.isArray(aenderungen) || !aenderungen.length) {
      throw fehler('ungueltig', 'Keine Änderungen', { meldungen: [{ pfad: '', meldung: 'Keine Änderungen' }] });
    }
    const overlay = leseOverlay();
    if (overlay === null) throw fehler('nicht_verfuegbar', 'Overlay nicht lesbar');
    // 1) Form und Editierbarkeit
    const ungueltig = [];
    const gesehen = new Set();
    const eintraege = [];
    for (const a of aenderungen) {
      const datei = a && a.datei;
      const pfad = a && a.pfad;
      if (datei !== 'test' && datei !== 'eintrag') { ungueltig.push({ pfad: String(pfad || ''), meldung: 'Unbekannte Datei' }); continue; }
      if (!editierbar(t, datei, pfad)) { ungueltig.push({ pfad: String(pfad || ''), meldung: 'Dieses Feld ist nicht änderbar' }); continue; }
      if (typeof a.alt !== 'string' || typeof a.neu !== 'string') { ungueltig.push({ pfad, meldung: 'Kein Text' }); continue; }
      if (gesehen.has(datei + ':' + pfad)) { ungueltig.push({ pfad, meldung: 'Feld mehrfach angegeben' }); continue; }
      gesehen.add(datei + ':' + pfad);
      eintraege.push({ datei, pfad, alt: a.alt, neu: a.neu });
    }
    if (ungueltig.length) throw fehler('ungueltig', 'Ungültige Änderung', { meldungen: ungueltig });
    // 2) Konflikte gegen den aktuellen wirksamen Stand
    const ist = wirksamMit(t, overlay);
    for (const a of eintraege) {
      const aktuell = hole(a.datei === 'test' ? ist.daten : ist.eintrag, schritte(a.pfad));
      if (aktuell !== a.alt) throw fehler('konflikt', 'Konflikt', { pfad: a.pfad });
    }
    const echte = eintraege.filter((a) => a.alt !== a.neu);
    if (!echte.length) throw fehler('ungueltig', 'Keine Änderung', { meldungen: [{ pfad: '', meldung: 'Keine Änderung' }] });
    // 3) Anwenden und prüfen
    const daten = kopie(ist.daten);
    const eintrag = kopie(ist.eintrag);
    for (const a of echte) setze(a.datei === 'test' ? daten : eintrag, schritte(a.pfad), a.neu);
    const meldungen = pruefe(t, daten, eintrag);
    if (meldungen.length) throw fehler('ungueltig', 'Wächter', { meldungen });
    // 4) Overlay neu aufbauen: nur Abweichungen von der Basis
    const neuOverlay = kopie(overlay);
    for (const a of echte) {
      const bucket = a.datei === 'test' ? 'tests' : 'eintraege';
      const key = a.datei === 'test' ? t.datenId : t.eintrag.id;
      const basisWert = hole(a.datei === 'test' ? t.daten : t.eintrag, schritte(a.pfad));
      if (!istObjekt(neuOverlay[bucket][key])) neuOverlay[bucket][key] = {};
      if (a.neu === basisWert) delete neuOverlay[bucket][key][a.pfad];
      else neuOverlay[bucket][key][a.pfad] = a.neu;
      if (!Object.keys(neuOverlay[bucket][key]).length) delete neuOverlay[bucket][key];
    }
    const nr = leseZeilen().reduce((m, z) => Math.max(m, Number.isSafeInteger(z.nr) ? z.nr : 0), 0) + 1;
    const zeit = jetzt().toISOString();
    const zeile = Object.assign({ nr, zeit, wer, testId, aenderungen: echte }, extraZeile || {});
    // Erst der Verlauf, dann das Overlay: nie eine Live-Änderung ohne Verlaufszeile.
    try { haengeAn(zeile); } catch (e) { schreibbarCache = false; throw fehler('nicht_verfuegbar', 'Schreiben fehlgeschlagen'); }
    try {
      schreibeAtomar(overlayPfad, serial(neuOverlay));
    } catch (e) {
      schreibbarCache = false;
      try { haengeAn({ nr, ergebnis: 'fehlgeschlagen' }); } catch (e2) { /* best effort */ }
      throw fehler('nicht_verfuegbar', 'Schreiben fehlgeschlagen');
    }
    return { nr, zeit };
  }

  return {
    verfuegbar,
    zustand,
    liste() {
      return [...tests.values()].map((t) => ({ id: t.eintrag.id, titel: t.eintrag.titel, sichtbar: t.eintrag.sichtbar === true }));
    },
    wirksam(testId) {
      return wirksamMit(finde(testId), leseOverlay() || leer());
    },
    // Konfiguration des Testbereichs mit wirksamen Einträgen (für Menü, Teaser, Übersicht).
    testsCfg() {
      const cfg = kopie(testsCfgBasis);
      const overlay = leseOverlay() || leer();
      cfg.eintraege = eintraegeBasis.map((e, i) => {
        const t = e && e.id && tests.get(e.id);
        return t && t.index === i ? wirksamMit(t, overlay).eintrag : kopie(e);
      });
      return cfg;
    },
    speichere(testId, aenderungen, wer) {
      return uebernehme(testId, aenderungen, wer);
    },
    verlauf(testId, max = 50) {
      finde(testId);
      return leseVerlauf().filter((z) => z.testId === testId).reverse().slice(0, max);
    },
    rueckgaengig(nr, wer) {
      const zeile = Number.isSafeInteger(nr) ? leseVerlauf().find((z) => z.nr === nr) : null;
      if (!zeile || typeof zeile.testId !== 'string' || !Array.isArray(zeile.aenderungen) || !zeile.aenderungen.length
        || !zeile.aenderungen.every((a) => istObjekt(a) && typeof a.alt === 'string' && typeof a.neu === 'string')) throw fehler('unbekannt', 'Unbekannte Änderung');
      const umgekehrt = zeile.aenderungen.map((a) => ({ datei: a.datei, pfad: a.pfad, alt: a.neu, neu: a.alt }));
      const r = uebernehme(zeile.testId, umgekehrt, wer, { rueckgaengigVon: nr });
      return { nr: r.nr, zeit: r.zeit, testId: zeile.testId };
    },
    export() {
      const overlay = leseOverlay() || leer();
      return { overlay, sha256: sha(serial(overlay)) };
    },
    leeren(sha256) {
      if (!verfuegbar()) throw fehler('nicht_verfuegbar', 'Speicher nicht verfügbar');
      return gesperrt(() => {
        const overlay = leseOverlay();
        if (overlay === null || sha(serial(overlay)) !== sha256) return false;
        try { schreibeAtomar(overlayPfad, serial(leer())); } catch (e) { schreibbarCache = false; throw fehler('nicht_verfuegbar', 'Schreiben fehlgeschlagen'); }
        return true;
      });
    },
  };
}

module.exports = { createInhalte };
