'use strict';
// Live-Fassung der Testseiten: ersetzt in den gebauten HTML-Dateien die mit <!--g42:...--> markierten
// Bereiche durch Markup aus den wirksamen Inhalten (Basis + Overlay). Nur Seiten, die sich dadurch
// tatsächlich ändern, werden im Speicher gehalten; alles andere liefert der normale Static-Server.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Ersetzt den Bereich zwischen <!--g42:name--> und <!--/g42:name--> (Marker bleiben). null, wenn ein Marker fehlt.
function ersetze(html, name, neu) {
  const auf = `<!--g42:${name}-->`;
  const zu = `<!--/g42:${name}-->`;
  const a = html.indexOf(auf);
  if (a < 0) return null;
  const b = html.indexOf(zu, a + auf.length);
  if (b < 0) return null;
  // Funktions-Ersatz-Semantik: kein "$&"-Muster in Texten.
  return html.slice(0, a + auf.length) + neu + html.slice(b);
}

// Inhalt zwischen den Markern eines von testseite.js erzeugten Bereichs.
function innen(text, name) {
  const auf = `<!--g42:${name}-->`;
  return text.slice(auf.length, text.length - `<!--/g42:${name}-->`.length);
}

function createSeiten({ root, inhalte, Testseite }) {
  const T = Testseite;
  const rootDir = path.resolve(root);
  const seiten = new Map(); // pathname -> {html, etag}

  const lies = (datei) => { try { return fs.readFileSync(path.join(rootDir, datei), 'utf8'); } catch (e) { return null; } };
  const etagVon = (html) => '"' + crypto.createHash('sha1').update(html).digest('hex').slice(0, 20) + '"';

  function ablegen(pathname, original, html) {
    if (html === null || html === original) seiten.delete(pathname);
    else seiten.set(pathname, { html, etag: etagVon(html) });
  }

  function testSeite(id) {
    const pathname = '/' + id + '.html';
    const original = lies(id + '.html');
    if (original === null) { seiten.delete(pathname); return; }
    const w = inhalte.wirksam(id);
    const testsCfg = inhalte.testsCfg();
    let html = ersetze(original, 'kopf', T.kopf(w.eintrag));
    if (html !== null) html = ersetze(html, 'test', innen(T.sektionen(w.eintrag, w.daten, testsCfg), 'test'));
    if (html !== null) html = ersetze(html, 'daten', innen(T.datenSkript(w.daten), 'daten'));
    ablegen(pathname, original, html);
  }

  function uebersicht() {
    const original = lies('selbsttests.html');
    if (original === null) { seiten.delete('/selbsttests.html'); return; }
    const eintraege = (inhalte.testsCfg().eintraege || []).filter((e) => e && e.id && e.daten && e.titel && e.sichtbar === true);
    const karten = eintraege.map((e) => T.kachel(e, e.id + '.html')).join('');
    ablegen('/selbsttests.html', original, ersetze(original, 'kacheln', karten));
  }

  function aktualisiere(testId) {
    if (!inhalte) { seiten.clear(); return; }
    const ids = testId ? [testId] : inhalte.liste().map((t) => t.id);
    for (const id of ids) {
      try { testSeite(id); } catch (e) { seiten.delete('/' + id + '.html'); }
    }
    try { uebersicht(); } catch (e) { seiten.delete('/selbsttests.html'); }
  }

  aktualisiere();
  return { aktualisiere, seite: (pathname) => seiten.get(pathname) || null };
}

module.exports = { createSeiten };
