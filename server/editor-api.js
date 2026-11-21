'use strict';
// Editor-API (nur mit gültiger Sitzung): Stand lesen, Texte speichern, Verlauf, Rückgängig.
//   GET  /api/editor/stand
//   POST /api/editor/speichern    {testId, aenderungen:[{datei,pfad,alt,neu}]}
//   GET  /api/editor/verlauf?testId=
//   POST /api/editor/rueckgaengig {nr}
// "wer" kommt immer aus der Sitzung. Nie geloggt oder gemeldet: Texte, Sitzungs-IDs, Meldungs-URL.
const path = require('node:path');
const { konfiguration } = require('./editor-sitzung');
const { JSON_HEADERS, ipVon, leseJson, createLimiter } = require('./editor-http');

const RATE_LIMIT = 60; // Anfragen pro IP und Minute, alle Routen zusammen
const MAX_BODY = 64 * 1024;
const MAX_AENDERUNGEN = 200;
const VERLAUF_MAX = 50;
const MELDUNG_TIMEOUT = 5000;

// Standardpfade wie in den Einschränkungen (auch für die CLI).
function pfadeAusEnv(env) {
  return {
    dataDir: env.EDITOR_DATA_DIR || '/data/editor',
    basisDir: env.EDITOR_INHALT_DIR || '/app/inhalte',
  };
}

// https, oder http nur für localhost; sonst null.
function meldungUrl(wert) {
  if (typeof wert !== 'string' || !wert) return null;
  let u;
  try { u = new URL(wert); } catch { return null; }
  if (u.protocol === 'https:') return u.href;
  if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]')) return u.href;
  return null;
}

const istObjekt = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const formOk = (a) => istObjekt(a) && ['datei', 'pfad', 'alt', 'neu'].every((k) => typeof a[k] === 'string');

// inhalte darf null sein (Start ohne Basis): dann antworten alle Routen mit 503.
function createEditorApi({ env = process.env, inhalte, seiten, sitzung, fetch: fetchFn = globalThis.fetch, log, jetzt = () => Date.now() }) {
  const cfg = konfiguration(env);
  const url = meldungUrl(env.EDITOR_MELDUNG_URL);
  const limited = createLimiter(RATE_LIMIT, () => +jetzt());

  function grund() {
    if (!cfg || !inhalte) return 'aus';
    const z = inhalte.zustand();
    return z === 'ok' ? null : z;
  }

  function aktualisiere(testId) {
    if (!seiten) return false;
    try { return seiten.aktualisiere(testId) === true; } catch { if (log) log('editor: Seiten aktualisieren fehlgeschlagen'); return false; }
  }

  // Nur Titel, Name und Anzahl; Fehler werden ignoriert.
  function melde(testId, wer, anzahl) {
    if (!url || typeof fetchFn !== 'function') return;
    try {
      const t = inhalte.liste().find((x) => x.id === testId);
      const body = JSON.stringify({ titel: 'Test-Editor: ' + (t ? t.titel : testId), text: `${wer} hat ${anzahl} Text(e) geändert` });
      Promise.resolve(fetchFn(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(MELDUNG_TIMEOUT),
      })).catch(() => {});
    } catch { /* ignoriert */ }
  }

  function anzahlVon(testId, nr, vorgabe) {
    try {
      const z = inhalte.verlauf(testId, VERLAUF_MAX).find((x) => x.nr === nr);
      if (z && Array.isArray(z.aenderungen)) return z.aenderungen.length;
    } catch { /* Vorgabe */ }
    return vorgabe;
  }

  function route({ post, fn }) {
    return async (req, res, send) => {
      const reply = (status, obj) => send(res, status, JSON_HEADERS, JSON.stringify(obj) + '\n');
      if (limited(ipVon(req))) return reply(429, { error: 'rate_limited' });
      const g = grund();
      if (g) return reply(503, { error: 'editor_aus', grund: g });
      if (req.headers['x-g42-editor'] !== '1' || (post && req.headers.origin !== cfg.origin)) return reply(403, { error: 'herkunft' });
      const s = sitzung.pruefe(req);
      if (!s) return reply(401, { error: 'anmeldung' });
      let body = {};
      if (post) {
        try { body = await leseJson(req, MAX_BODY); } catch (e) { return reply(e.status || 400, { error: 'bad_request' }); }
      }
      try {
        return fn({ wer: s.wer, body, req, reply });
      } catch (e) {
        switch (e && e.art) {
          case 'konflikt': return reply(409, { error: 'konflikt', pfad: e.pfad });
          case 'ungueltig': return reply(422, { error: 'ungueltig', meldungen: e.meldungen });
          case 'unbekannt': return reply(404, { error: 'unbekannt' });
          case 'nicht_verfuegbar': return reply(503, { error: 'editor_aus', grund: e.gesperrt ? 'gesperrt' : (grund() || 'nicht_schreibbar') });
          default: return reply(500, { error: 'intern' });
        }
      }
    };
  }

  const stand = route({ fn: ({ wer, reply }) => {
    const tests = inhalte.liste().map((t) => {
      const w = inhalte.wirksam(t.id);
      return { id: t.id, titel: t.titel, sichtbar: t.sichtbar, daten: w.daten, eintrag: w.eintrag, verwaist: w.verwaist };
    });
    return reply(200, { wer, zustand: inhalte.zustand(), tests, testsCfg: inhalte.testsCfg() });
  } });

  const speichern = route({ post: true, fn: ({ wer, body, reply }) => {
    const { testId, aenderungen } = body;
    if (typeof testId !== 'string' || !testId || !Array.isArray(aenderungen) || !aenderungen.length
      || aenderungen.length > MAX_AENDERUNGEN || !aenderungen.every(formOk)) return reply(400, { error: 'bad_request' });
    const r = inhalte.speichere(testId, aenderungen.map(({ datei, pfad, alt, neu }) => ({ datei, pfad, alt, neu })), wer);
    const live = aktualisiere(testId);
    melde(testId, wer, anzahlVon(testId, r.nr, aenderungen.length));
    return reply(200, { nr: r.nr, zeit: r.zeit, live });
  } });

  const verlauf = route({ fn: ({ req, reply }) => {
    const testId = new URL(req.url, 'http://localhost').searchParams.get('testId');
    if (!testId) return reply(400, { error: 'bad_request' });
    const eintraege = inhalte.verlauf(testId, VERLAUF_MAX).map((z) => ({
      nr: z.nr, zeit: z.zeit, wer: z.wer,
      aenderungen: (Array.isArray(z.aenderungen) ? z.aenderungen : []).map((a) => ({ datei: a.datei, pfad: a.pfad, alt: a.alt, neu: a.neu })),
    }));
    return reply(200, { verlauf: eintraege });
  } });

  const rueckgaengig = route({ post: true, fn: ({ wer, body, reply }) => {
    // Nur echte Ganzzahlen, keine Umwandlung von Strings.
    if (!Number.isSafeInteger(body.nr)) return reply(400, { error: 'bad_request' });
    const r = inhalte.rueckgaengig(body.nr, wer);
    const live = aktualisiere(r.testId);
    melde(r.testId, wer, anzahlVon(r.testId, r.nr, 1));
    return reply(200, { nr: r.nr, zeit: r.zeit, live });
  } });

  return {
    routes: {
      '/api/editor/stand': { method: 'GET', handler: stand },
      '/api/editor/speichern': { method: 'POST', handler: speichern },
      '/api/editor/verlauf': { method: 'GET', handler: verlauf },
      '/api/editor/rueckgaengig': { method: 'POST', handler: rueckgaengig },
    },
  };
}

module.exports = { createEditorApi, pfadeAusEnv, meldungUrl };
