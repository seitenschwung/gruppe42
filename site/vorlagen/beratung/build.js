#!/usr/bin/env node
'use strict';
/*
 * Build-Skript für die Beratung-Vorlage – Website für Beratung, Training und Coaching
 * (klar, warm, professionell). Startseite + je Zielgruppe eine Workshop-Seite (zielgruppen[] → <id>.html)
 * + je Leistung mit "abschnitte" eine eigene Seite + Impressum und Datenschutz.
 *
 *   node build.js ../../kunden/<pfad>/<datei>.json   -> schreibt dist/
 *   BILDER_DIR=... DIST_DIR=... node build.js datei  -> so ruft build-all.js die Vorlage auf
 *
 * Keine npm-Abhängigkeiten; WebP/AVIF-Varianten über lib/bilder.js.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const h = require('../../lib/helfer');
const { bildVerarbeitung, bildTag, vorladen } = require('../../lib/bilder');
const W = require('../../lib/testwaechter');
const T = require('../../lib/testseite');
const { abdruckPfad, ABDRUCK_DATEI } = require('../../lib/struktur-erzeugen');

const ROOT = __dirname;
const DATEI = path.resolve(process.argv[2] || path.join(ROOT, '../../kunden/gruppe42/gruppe42.json'));
const BILDER = path.resolve(process.env.BILDER_DIR || path.join(ROOT, 'images'));
const DIST = path.resolve(process.env.DIST_DIR || path.join(ROOT, 'dist'));
const CACHE = path.resolve(process.env.CACHE_DIR || path.join(ROOT, '.bildcache'));

const warnungen = [];
const warn = (text) => warnungen.push(text);
const esc = h.esc;

// ---------------------------------------------------------------------------
// 1. Daten laden
// ---------------------------------------------------------------------------

let s;
try {
  s = JSON.parse(fs.readFileSync(DATEI, 'utf8'));
} catch (e) {
  console.error(`✖ ${path.basename(DATEI)} konnte nicht gelesen werden: ${e.message}`);
  process.exit(1);
}
if (!s.name) { console.error('✖ Pflichtfeld "name" fehlt.'); process.exit(1); }

const liste = (x) => (Array.isArray(x) ? x.filter(Boolean) : []);
s.kontakt = s.kontakt || {};
s.hero = s.hero || {};
s.zahlen = liste(s.zahlen).filter((z) => z.wert);
s.referenzen = s.referenzen || {};
s.geschichte = s.geschichte || {};
s.leistungen = s.leistungen || {};
s.leistungen.eintraege = liste(s.leistungen.eintraege).filter((l) => l.id && l.titel);
s.zielgruppen = liste(s.zielgruppen).filter((z) => z.id && z.titel).map((z) => ({ ...z, workshops: liste(z.workshops).filter((w) => w.titel) }));
s.rahmen = liste(s.rahmen).filter((r) => r.titel);
s.ablauf = s.ablauf || {};
s.stimmen = s.stimmen || {};
s.person = s.person || {};
s.kontaktband = s.kontaktband || {};
const demo = s.demo_modus === true;
const firma = s.firma || s.name;
const adresse = s.kontakt.adresse || {};

// Impulse (Blog) und Praxisbeispiele: optional, standardmäßig unsichtbar
s.impulse = s.impulse || {};
s.impulse.eintraege = liste(s.impulse.eintraege).filter((e) => e.id && e.titel);
s.fallstudien = s.fallstudien || {};
s.fallstudien.eintraege = liste(s.fallstudien.eintraege).filter((e) => e.kunde);
const impulseSichtbar = s.impulse.sichtbar === true;
const fallstudienSichtbar = s.fallstudien.sichtbar === true && s.fallstudien.eintraege.length > 0;

const reserviert = new Set(['index', 'impressum', 'datenschutz', 'shop', 'selbsttests', 'impulse', 'gespraechskarten', 'methodik', 'editor']);
const ids = [...s.impulse.eintraege.map((e) => e.id),...s.zielgruppen.map((z) => z.id), ...s.leistungen.eintraege.filter((l) => liste(l.abschnitte).length).map((l) => l.id)];
for (const id of ids) {
  if (reserviert.has(id)) { console.error(`✖ id "${id}" ist reserviert.`); process.exit(1); }
  if (ids.indexOf(id) !== ids.lastIndexOf(id)) { console.error(`✖ id "${id}" kommt doppelt vor.`); process.exit(1); }
}

// Wächter: Struktur gegen den eingecheckten Abdruck (tests/struktur.json), Texte gegen die Textregeln.
// Nach bewusster Strukturänderung Abdruck neu erzeugen: node site/lib/struktur-erzeugen.js <pfad>/gruppe42.json
let abdruckCache = null;
function ladeAbdruck() {
  if (abdruckCache) return abdruckCache;
  const pfad = abdruckPfad(DATEI);
  const erzeugen = 'node site/lib/struktur-erzeugen.js ' + path.relative(process.cwd(), DATEI);
  if (!fs.existsSync(pfad)) {
    console.error(`✖ ${ABDRUCK_DATEI} fehlt (${pfad}). Erzeugen mit: ${erzeugen}`);
    process.exit(1);
  }
  try { abdruckCache = JSON.parse(fs.readFileSync(pfad, 'utf8')); } catch (e) {
    console.error(`✖ ${ABDRUCK_DATEI} konnte nicht gelesen werden: ${e.message}`);
    process.exit(1);
  }
  return abdruckCache;
}
function testMeldungen(daten, abdruck) {
  const soll = abdruck.tests && abdruck.tests[daten.id];
  const aus = [];
  if (!soll) aus.push(`Kein Eintrag für "${daten.id}" in ${ABDRUCK_DATEI}`);
  else W.pruefeStruktur(daten, soll, W.TEXTFELDER_TEST).forEach((m) => aus.push('Struktur: ' + m));
  W.pruefeTexte(daten, W.TEXTFELDER_TEST).forEach((m) => aus.push(`${m.pfad}: ${m.meldung}`));
  return aus;
}
// Läuft vor jeder Bildverarbeitung: prüft alle Tests und die Einträge in tests.eintraege, sammelt alle Meldungen.
function pruefeTests() {
  const liste_ = liste(s.tests && s.tests.eintraege);
  // Ohne Tests und ohne Abdruck: nichts zu prüfen. Gibt es einen Abdruck, zählt er auch bei leerer Liste.
  if (!liste_.length && !fs.existsSync(abdruckPfad(DATEI))) return;
  const abdruck = ladeAbdruck();
  const aus = [];
  const sollEintraege = liste(abdruck.eintraege);
  if (sollEintraege.length !== liste_.length) aus.push(`tests.eintraege: Anzahl ${liste_.length} statt ${sollEintraege.length}`);
  else liste_.forEach((e, i) => {
    const pre = `tests.eintraege[${i}]`;
    W.pruefeStruktur(e, sollEintraege[i], W.TEXTFELDER_EINTRAG).forEach((m) => aus.push(`${pre}.${m}`));
    W.pruefeTexte(e, W.TEXTFELDER_EINTRAG).forEach((m) => aus.push(`${pre}.${m.pfad}: ${m.meldung}`));
  });
  for (const e of liste_) {
    if (!e || !e.daten) continue;
    let daten;
    try { daten = JSON.parse(fs.readFileSync(path.resolve(path.dirname(DATEI), e.daten), 'utf8')); } catch (err) {
      aus.push(`Test "${e.id}": ${e.daten} konnte nicht gelesen werden: ${err.message}`);
      continue;
    }
    testMeldungen(daten, abdruck).forEach((m) => aus.push(`Test "${e.id}": ${m}`));
  }
  if (aus.length) {
    aus.forEach((m) => console.error(`✖ ${m}`));
    console.error(`✖ Selbsttests: ${aus.length} Verstoß/Verstöße, Build abgebrochen.`);
    process.exit(1);
  }
}
pruefeTests();

// ---------------------------------------------------------------------------
// 2. Ausgabeordner, Schriften, Skript
// ---------------------------------------------------------------------------

fs.rmSync(DIST, { recursive: true, force: true });
for (const d of [DIST, path.join(DIST, 'img'), path.join(DIST, 'fonts'), path.join(DIST, 'js'), CACHE]) {
  fs.mkdirSync(d, { recursive: true });
}
for (const f of fs.readdirSync(path.join(ROOT, 'fonts'))) {
  if (f.endsWith('.woff2')) fs.copyFileSync(path.join(ROOT, 'fonts', f), path.join(DIST, 'fonts', f));
}
// Skript mit Versionsnummer (?v=Prüfsumme): nginx lässt JS 7 Tage im Browser-Cache
const mainJs = fs.readFileSync(path.join(ROOT, 'src/js/main.js'), 'utf8');
fs.writeFileSync(path.join(DIST, 'js/main.js'), mainJs);
const mainJsUrl = `js/main.js?v=${crypto.createHash('sha1').update(mainJs).digest('hex').slice(0, 8)}`;
// Antreiber-Test: eigenes Skript, nur auf dieser Seite geladen
const testsCfg = s.tests && s.tests.aktiv ? s.tests : null;
const tests = testsCfg ? liste(testsCfg.eintraege).filter((e) => e.id && e.daten && e.titel) : [];
const sichtbareTests = tests.filter((e) => e.sichtbar === true);
tests.forEach((e) => { if (reserviert.has(e.id)) { console.error(`✖ Test-id "${e.id}" ist reserviert.`); process.exit(1); } });
const testJs = fs.readFileSync(path.join(ROOT, 'src/js/antreiber.js'), 'utf8');
if (tests.length) fs.writeFileSync(path.join(DIST, 'js/antreiber.js'), testJs);
const testJsUrl = `js/antreiber.js?v=${crypto.createHash('sha1').update(testJs).digest('hex').slice(0, 8)}`;
// Ziel für Menü und Teaser: genau ein sichtbarer Test -> direkt dorthin, sonst Übersicht
// Gesprächskarten (optional, s.karten): eigene Seite, Skript nur dort geladen; sichtbar -> Karte in der Übersicht
const kartenCfg = s.karten && liste(s.karten.kartensaetze).length ? s.karten : null;
const kartenSichtbar = !!(kartenCfg && kartenCfg.sichtbar === true);
const kartenJs = kartenCfg ? fs.readFileSync(path.join(ROOT, 'src/js/karten.js'), 'utf8') : '';
if (kartenCfg) fs.writeFileSync(path.join(DIST, 'js/karten.js'), kartenJs);
const kartenJsUrl = `js/karten.js?v=${crypto.createHash('sha1').update(kartenJs).digest('hex').slice(0, 8)}`;
// Test-Editor (/editor/): eigene Skripte nur auf der Editor-Seite, je mit ?v=-Prüfsumme
const editorJs = tests.length ? [
  ['testwaechter', path.join(ROOT, '../../lib/testwaechter.js')],
  ['testseite', path.join(ROOT, '../../lib/testseite.js')],
  ['editor-kern', path.join(ROOT, 'src/js/editor-kern.js')],
  ['editor-github', path.join(ROOT, 'src/js/editor-github.js')],
  ['editor-vorschau', path.join(ROOT, 'src/js/editor-vorschau.js')],
  ['editor', path.join(ROOT, 'src/js/editor.js')],
].map(([name, quelle]) => {
  const inhalt = fs.readFileSync(quelle, 'utf8');
  fs.writeFileSync(path.join(DIST, `js/${name}.js`), inhalt);
  return `js/${name}.js?v=${crypto.createHash('sha1').update(inhalt).digest('hex').slice(0, 8)}`;
}) : [];
const testZiel = sichtbareTests.length === 1 && !kartenSichtbar ? `${sichtbareTests[0].id}.html` : 'selbsttests.html';

// ---------------------------------------------------------------------------
// 3. Bilder
// ---------------------------------------------------------------------------

const { verarbeite: verarbeiteBild } = bildVerarbeitung({ bilderDir: BILDER, distDir: DIST, cacheDir: CACHE, warn, qualitaet: 78, minBreite: 1000 });
const benutzt = new Map(); // datei -> { alt, credit }

function normBild(ref) {
  if (!ref) return { datei: '', alt: '' };
  if (typeof ref === 'string') return { datei: ref, alt: '' };
  return { datei: ref.datei || '', alt: ref.alt || '', fokus: ref.fokus || '', credit: ref.credit || '' };
}

function bild(ref, { sizes = '100vw', eager = false } = {}) {
  const r = normBild(ref);
  const info = r.datei ? verarbeiteBild(r.datei) : null;
  if (!info) return '<div class="platzhalter" aria-hidden="true"></div>'; // verarbeiteBild hat schon gewarnt
  benutzt.set(r.datei, r);
  return bildTag(info, sizes, [
    `width="${info.breite}" height="${info.hoehe}"`,
    `alt="${esc(r.alt)}"`,
    eager ? 'fetchpriority="high"' : 'loading="lazy"',
    'decoding="async"',
    r.fokus && `style="object-position:${esc(r.fokus)}"`,
  ]);
}

// ---------------------------------------------------------------------------
// 4. Bausteine
// ---------------------------------------------------------------------------

// *Wort* → <em>Wort</em> (alles andere maskiert)
const betont = (text) => esc(text || '').replace(/\*([^*]+)\*/g, '<em>$1</em>');
const ohneBetonung = (text) => String(text || '').replace(/\*/g, '');
// Inline-Markdown (Links, fett, kursiv) aus helfer.markdown ohne umschließenden Absatz
const inline = (text) => h.markdown(text).replace(/^<p>|<\/p>$/g, '');

const ICONS = {
  pfeil: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  telefon: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  mail: '<path d="M3 6h18v12H3z"/><path d="m3 7 9 7 9-7"/>',
};
const icon = (n) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;

const telefon = s.kontakt.telefon || '';
const telLink = telefon ? `tel:${h.telefonInternational(telefon, adresse.land || 'Österreich') || telefon.replace(/[^\d+]/g, '')}` : '';
const email = s.kontakt.email || '';
const anfrageLink = email ? `mailto:${email}?subject=${encodeURIComponent('Anfrage Erstgespräch')}` : '#kontakt';

// "Gruppe 42" → Wortmarke mit runder Zahl, sonst schlicht der Name
function marke(href, aktuell) {
  const m = s.name.match(/^(.*\S)\s+(\d{1,3})$/);
  if (s.logo) return `<a class="marke" href="${href}"${aktuell ? ' aria-current="page"' : ''}><img class="marke-logo" src="${esc(s.logo)}" alt="${esc(s.name)}, Startseite" width="131" height="47"></a>`;
  const inhalt = m ? `${esc(m[1])}<span class="marke-zahl">${esc(m[2])}</span>` : esc(s.name);
  return `<a class="marke" href="${href}"${aktuell ? ' aria-current="page"' : ''} aria-label="${esc(s.name)}, Startseite">${inhalt}</a>`;
}

const seiteVon = (id) => `${id}.html`;
const kategorienVon = (z) => [...new Set(z.workshops.map((w) => w.kategorie).filter(Boolean))];

function kopfzeile(kicker, titel, rechts = '') {
  return `<div class="kopfzeile"><div>${kicker ? `<p class="kicker">${esc(kicker)}</p>` : ''}<h2 class="titel">${betont(titel)}</h2></div>${rechts}</div>`;
}

function stimmeFigur(st, klasse) {
  if (!st || !st.text) return '';
  return `<figure class="${klasse}"><blockquote><p>„${betont(st.text)}“</p></blockquote><figcaption><strong>${esc(st.wer)}</strong>${st.rolle ? ` · ${esc(st.rolle)}` : ''}</figcaption></figure>`;
}

function kontaktband() {
  const kb = s.kontaktband;
  return `<section class="kontaktband abschnitt" id="kontakt" aria-labelledby="kontakt-titel">
  <div class="container">
    <div class="kontaktband-text">
      <h2 id="kontakt-titel">${betont(kb.titel || 'Sprechen wir über dein Vorhaben.')}</h2>
      ${kb.text ? `<p>${esc(kb.text)}</p>` : ''}
    </div>
    <div class="knoepfe">
      ${email ? `<a class="knopf knopf-dunkel" href="${esc(anfrageLink)}">${icon('mail')}Erstgespräch vereinbaren</a>` : ''}
      ${telefon ? `<a class="knopf knopf-rand" href="${esc(telLink)}">${icon('telefon')}${esc(telefon)}</a>` : ''}
    </div>
  </div>
</section>`;
}

// ---------------------------------------------------------------------------
// 5. Startseite
// ---------------------------------------------------------------------------

function startseite() {
  const he = s.hero;
  const g = s.geschichte;
  const stationen = liste(g.stationen);
  const quali = liste(g.qualifikationen);
  const ref = liste(s.referenzen.namen).concat((s.referenzen.logos || []).length ? [''] : []);
  const p = s.person;
  return `
<section class="hero" aria-labelledby="hero-titel">
  <div class="container hero-text">
    <div>
      ${he.kicker ? `<p class="kicker">${esc(he.kicker)}</p>` : ''}
      <h1 id="hero-titel">${betont(he.titel)}</h1>
    </div>
    <div>
      ${he.text ? `<p class="hero-lead">${esc(he.text)}</p>` : ''}
      <div class="knoepfe">
        <a class="knopf knopf-honig" href="#kontakt">Erstgespräch vereinbaren ${icon('pfeil')}</a>
        ${s.zielgruppen.length ? '<a class="knopf knopf-rand" href="#zielgruppen">Workshops ansehen</a>' : ''}
      </div>
    </div>
  </div>
  ${he.bild ? `<div class="hero-bild">${bild(he.bild, { sizes: '(min-width: 1360px) 1280px, 96vw', eager: true })}</div>` : ''}
  ${s.zahlen.length ? `<div class="container"><ul class="zahlen">${s.zahlen.map((z) => `<li><strong>${esc(z.wert)}</strong>${z.text ? `<span>${esc(z.text)}</span>` : ''}</li>`).join('')}</ul></div>` : ''}
</section>

${ref.length ? `<section class="sand referenzen" aria-label="Referenzen">
  <div class="container">
    ${s.referenzen.titel ? `<p class="referenzen-titel">${esc(s.referenzen.titel)}</p>` : ''}
    ${(s.referenzen.logos || []).length ? `<ul class="referenzen-logos">${s.referenzen.logos.map((l) => `<li><img src="${esc(l.bild)}" alt="${esc(l.name)}" width="200" height="60" loading="lazy"></li>`).join('')}</ul>` : `<ul>${ref.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`}
  </div>
</section>` : ''}

${s.haltung && s.haltung.text ? `<section class="haltung abschnitt" aria-label="${esc(s.haltung.kicker || 'Haltung')}">
  <div class="container">
    <div class="haltung-zitat">
      ${s.haltung.kicker ? `<p class="kicker">${esc(s.haltung.kicker)}</p>` : ''}
      <p>${betont(s.haltung.text)}</p>
    </div>
    ${s.haltung.nebentext ? `<p class="haltung-neben">${esc(s.haltung.nebentext)}</p>` : ''}
  </div>
</section>` : ''}

${stationen.length ? `<section class="geschichte abschnitt" id="geschichte" aria-labelledby="geschichte-titel">
  <div class="container">
    <div class="geschichte-intro">
      ${g.kicker ? `<p class="kicker">${esc(g.kicker)}</p>` : ''}
      <h2 class="titel" id="geschichte-titel">${betont(g.titel || 'Unsere Geschichte')}</h2>
      ${g.text ? `<p>${esc(g.text)}</p>` : ''}
      ${quali.length ? `<div class="qualifikationen"><h3>Qualifikationen</h3><ul>${quali.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></div>` : ''}
    </div>
    <ol class="zeitleiste">${stationen.map((st) => `
      <li${st.hervorheben ? ' class="hervor"' : ''}><span class="zeitleiste-jahr">${esc(st.jahr)}</span><span class="zeitleiste-text"><strong>${esc(st.titel)}</strong>${st.text ? `<span>${esc(st.text)}</span>` : ''}</span></li>`).join('')}
    </ol>
  </div>
</section>` : ''}

${s.leistungen.eintraege.length ? `<section class="sand abschnitt" id="leistungen" aria-labelledby="leistungen-titel">
  <div class="container">
    <div class="kopfzeile"><div>${s.leistungen.kicker ? `<p class="kicker">${esc(s.leistungen.kicker)}</p>` : ''}<h2 class="titel" id="leistungen-titel">${betont(s.leistungen.titel || 'Leistungen')}</h2></div></div>
    <ul class="karten">${s.leistungen.eintraege.map((l) => {
      const ziel = liste(l.abschnitte).length ? seiteVon(l.id) : (l.link || '#kontakt');
      return `
      <li class="karte">
        ${l.bild ? bild(l.bild, { sizes: '(min-width: 1200px) 370px, (min-width: 700px) 45vw, 92vw' }) : ''}
        <div class="karte-inhalt">
          <h3>${esc(l.titel)}</h3>
          ${l.text ? `<p>${esc(l.text)}</p>` : ''}
          ${liste(l.schlagworte).length ? `<ul class="schlagworte">${l.schlagworte.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
          <a class="textlink" href="${esc(ziel)}">Mehr erfahren<span class="sr-only"> über ${esc(l.titel)}</span></a>
        </div>
      </li>`;
    }).join('')}
    </ul>
  </div>
</section>` : ''}

${s.zielgruppen.length ? `<section class="abschnitt" id="zielgruppen" aria-labelledby="zielgruppen-titel">
  <div class="container">
    ${(() => { const k = s.zielgruppen_kopf || {}; return `<div class="kopfzeile"><div>${k.kicker ? `<p class="kicker">${esc(k.kicker)}</p>` : ''}<h2 class="titel" id="zielgruppen-titel">${betont(k.titel || 'Workshops und Programme')}</h2></div></div>`; })()}
    <ul class="zielgruppen">${s.zielgruppen.map((z) => `
      <li class="zielgruppe"><a href="${seiteVon(z.id)}">
        ${z.bild ? bild(z.bild, { sizes: '(min-width: 1200px) 270px, (min-width: 600px) 45vw, 92vw' }) : ''}
        <span class="zielgruppe-titel">${esc(z.titel)}</span>
        ${z.teaser ? `<span class="zielgruppe-teaser">${esc(z.teaser)}</span>` : ''}
        <span class="zielgruppe-info">${z.workshops.length} ${z.workshops.length === 1 ? 'Angebot' : 'Angebote'}${kategorienVon(z).length > 1 ? ` · ${kategorienVon(z).slice(0, 3).map(esc).join(', ')}` : ''}</span>
        ${z.foerderung ? '<span class="plakette">Förderung möglich</span>' : ''}
      </a></li>`).join('')}
    </ul>
  </div>
</section>` : ''}

${liste(s.ablauf.schritte).length ? `<section class="sand abschnitt" aria-labelledby="ablauf-titel">
  <div class="container">
    <div class="kopfzeile"><div>${s.ablauf.kicker ? `<p class="kicker">${esc(s.ablauf.kicker)}</p>` : ''}<h2 class="titel" id="ablauf-titel">${betont(s.ablauf.titel || 'So arbeiten wir')}</h2></div></div>
    <ol class="schritte">${s.ablauf.schritte.map((x) => `<li><strong>${esc(x.titel)}</strong>${x.text ? `<span>${esc(x.text)}</span>` : ''}</li>`).join('')}</ol>
  </div>
</section>` : ''}

${fallstudienAbschnitt()}

${s.stimmen.haupt || liste(s.stimmen.weitere).length ? `<section class="abschnitt" aria-label="${esc(s.stimmen.kicker || 'Stimmen')}">
  <div class="container">
    ${s.stimmen.kicker ? `<p class="kicker">${esc(s.stimmen.kicker)}</p>` : ''}
    <div class="stimmen">
      ${stimmeFigur(s.stimmen.haupt, 'stimme-haupt')}
      ${liste(s.stimmen.weitere).length ? `<div class="stimme-weitere">${s.stimmen.weitere.map((st) => stimmeFigur(st, 'stimme-karte')).join('')}</div>` : ''}
    </div>
  </div>
</section>` : ''}

${testsCfg && sichtbareTests.length ? teaser(testsCfg) : ''}

${p.name ? `<section class="sand abschnitt person" id="ueber" aria-labelledby="person-titel">
  <div class="container">
    <div class="person-bild">${bild(p.bild, { sizes: '(min-width: 900px) 440px, 92vw' })}</div>
    <div class="person-text">
      ${p.kicker ? `<p class="kicker">${esc(p.kicker)}</p>` : ''}
      <h2 class="titel" id="person-titel">${esc(p.name)}</h2>
      ${p.rolle ? `<p class="person-rolle">${esc(p.rolle)}</p>` : ''}
      ${p.text ? `<p>${esc(p.text)}</p>` : ''}
      ${liste(p.fakten).length ? `<ul class="fakten">${p.fakten.map((f) => `<li><strong>${esc(f.titel)}</strong>${esc(f.text || '')}</li>`).join('')}</ul>` : ''}
    </div>
  </div>
</section>` : ''}

${faqAbschnitt()}
${kontaktband()}`;
}

// ---------------------------------------------------------------------------
// 6. Unterseiten
// ---------------------------------------------------------------------------

function seitenkopf(titel, motto, intro, bildRef, kompakt = false) {
  return `<section class="seitenkopf${kompakt ? ' seitenkopf-kompakt' : ''}">
  <div class="container">
    <nav class="brotkrumen" aria-label="Brotkrumen"><ol><li><a href="./">Start</a></li><li aria-current="page">${esc(titel)}</li></ol></nav>
    <div class="seitenkopf-inhalt">
      <div class="seitenkopf-text">
        <p class="kicker">${esc(titel)}</p>
        <h1>${betont(motto || titel)}</h1>
        ${intro ? `<p>${esc(intro)}</p>` : ''}
      </div>
      ${bildRef ? `<div class="seitenkopf-bild">${bild(bildRef, { sizes: '(min-width: 1000px) 420px, 92vw', eager: true })}</div>` : ''}
    </div>
  </div>
</section>`;
}

function zielgruppenSeite(z) {
  const kat = kategorienVon(z);
  return `
${seitenkopf(z.titel, z.motto, z.intro, z.bild)}
<section class="abschnitt" aria-labelledby="angebote-titel">
  <div class="container">
    <div class="kopfzeile">
      <div><h2 class="titel" id="angebote-titel"><span data-anzahl>${z.workshops.length}</span> ${z.workshops.length === 1 ? 'Angebot' : 'Angebote'}${kat.length > 1 ? ', nach Schwerpunkt' : ''}.</h2></div>
      ${kat.length > 1 ? `<div class="filter" data-filter role="group" aria-label="Angebote filtern" hidden>
        <button type="button" data-wert="" aria-pressed="true">Alle</button>${kat.map((k) => `<button type="button" data-wert="${esc(k)}" aria-pressed="false">${esc(k)}</button>`).join('')}
      </div>` : ''}
    </div>
    <ul class="workshops" aria-live="polite">${z.workshops.map((w) => `
      <li data-kategorie="${esc(w.kategorie || '')}"><article class="workshop">
        ${w.kategorie ? `<p class="workshop-kat">${esc(w.kategorie)}</p>` : ''}
        <h3>${esc(w.titel)}</h3>
        ${w.text ? `<p>${esc(w.text)}</p>` : ''}
        <p class="workshop-fuss">${w.dauer ? `<span>Dauer <strong>${esc(w.dauer)}</strong></span>` : '<span>Dauer nach Vereinbarung</span>'}<a href="#kontakt">Anfragen<span class="sr-only">: ${esc(w.titel)}</span></a></p>
      </article></li>`).join('')}
    </ul>
    ${z.foerderung ? `<p class="foerderung"><strong>Förderung</strong><span>${inline(z.foerderung)}</span></p>` : ''}
  </div>
</section>
${s.rahmen.length ? `<section class="rahmen abschnitt" aria-labelledby="rahmen-titel">
  <div class="container">
    <h2 class="titel" id="rahmen-titel">Abgestimmt auf <em>dein</em> Unternehmen.</h2>
    <ul>${s.rahmen.map((r) => `<li><strong>${esc(r.titel)}</strong>${esc(r.text || '')}</li>`).join('')}</ul>
  </div>
</section>` : ''}
${z.stimme ? `<section class="sand abschnitt zitat-gross" aria-label="Stimme"><div class="container">${stimmeFigur(z.stimme, 'stimme-haupt')}</div></section>` : ''}
${kontaktband()}`;
}

function leistungsSeite(l) {
  return `
${seitenkopf(l.titel, l.motto, l.intro, l.bild)}
<section class="abschnitt" aria-label="${esc(l.titel)}">
  <div class="container">
    <ol class="abschnitte">${l.abschnitte.filter((a) => a && a.titel).map((a) => `
      <li><h2>${esc(a.titel)}</h2>${a.untertitel ? `<p class="untertitel">${esc(a.untertitel)}</p>` : ''}${a.text ? `<p>${esc(a.text)}</p>` : ''}</li>`).join('')}
    </ol>
  </div>
</section>
${kontaktband()}`;
}

// Shop: Produkte kommen aus der Serverdatei (s.shop.produkte, Pfad relativ zur Inhalts-JSON). Preise werden
// hier nur angezeigt; maßgeblich ist immer der Server. Kaufen-Knopf bleibt aus, bis der Checkout live ist.
const TYP = { online: 'Online', praesenz: 'Vor Ort' };
function shopSeite(cfg) {
  const daten = JSON.parse(fs.readFileSync(path.resolve(path.dirname(DATEI), cfg.produkte), 'utf8'));
  const eur = new Intl.NumberFormat('de-AT', { style: 'currency', currency: daten.waehrung.toUpperCase() });
  const entwurf = daten.produkte.some((p) => p.entwurf);
  const karten = daten.produkte.map((p) => {
    const b = p.bild || {};
    return `
      <li class="karte">
        ${bild(b, { sizes: '(min-width: 900px) 360px, 92vw' })}
        <div class="karte-inhalt">
          <ul class="schlagworte"><li>${esc(TYP[p.typ] || p.typ)}</li></ul>
          <h2>${esc(p.titel)}</h2>
          <p>${esc(p.beschreibung)}</p>
          <p class="shop-preis">${Number.isInteger(p.preis_cent) ? eur.format(p.preis_cent / 100) : 'Preis folgt'}</p>
          <button class="knopf knopf-dunkel" type="button" disabled>Bald buchbar<span class="sr-only">: ${esc(p.titel)}</span></button>
        </div>
      </li>`;
  }).join('');
  return `
${seitenkopf(cfg.titel || 'Seminare', cfg.motto, cfg.intro)}
<section class="abschnitt" aria-label="${esc(cfg.titel || 'Seminare')}">
  <div class="container">
    ${entwurf ? '<p class="shop-hinweis">Entwurf: Texte, Preise und Termine sind Platzhalter. Buchen ist noch nicht möglich.</p>' : ''}
    <ul class="karten">${karten}
    </ul>
    <p class="shop-recht">Vor dem Start: <a href="impressum.html">Impressum</a> und <a href="datenschutz.html">Datenschutz</a> prüfen; AGB und Widerrufsbelehrung folgen.</p>
  </div>
</section>
${kontaktband()}`;
}

// Tests: Fragen, Skala, Auswertungstexte liegen je Test in einer JSON-Datei (cfg.daten, neben der Inhalts-JSON).
// Die Seite liefert nur Gerüst und Daten; Ablauf, Auswertung und Ergebnis erzeugt js/antreiber.js im Browser
// (nichts wird übertragen). Auswertung: result.kind "ranking" (Rangfolge je Kategorie) oder "levels" (Stufe nach Gesamtpunkten).
function ladeTest(cfg) {
  const daten = JSON.parse(fs.readFileSync(path.resolve(path.dirname(DATEI), cfg.daten), 'utf8'));
  const kennung = `Test "${cfg.id}"`;
  const fehler = (m) => { console.error(`✖ ${kennung}: ${m}`); process.exit(1); };
  const abdruck = ladeAbdruck();
  const meldungen = testMeldungen(daten, abdruck);
  if (meldungen.length) { meldungen.forEach((m) => console.error(`✖ ${kennung}: ${m}`)); process.exit(1); }
  const kat = new Set(liste(daten.categories).map((c) => c.id));
  if (!kat.size || !liste(daten.questions).length || !daten.scale || !daten.result) fehler('categories, questions, scale und result sind Pflicht.');
  daten.questions.forEach((f) => { if (!kat.has(f.category)) fehler(`Frage ${f.id}: unbekannte Kategorie "${f.category}".`); });
  if (!['ranking', 'levels'].includes(daten.result.kind)) fehler('result.kind muss "ranking" oder "levels" sein.');
  if (daten.result.kind === 'levels' && !liste(daten.result.levels).length) fehler('result.levels fehlt.');
  return daten;
}

function testSeite(cfg, daten, testsCfg) {
  return `
<!--g42:kopf-->${T.kopf(cfg)}<!--/g42:kopf-->
${T.abschnitte(cfg, daten, testsCfg, kontaktband())}`;
}

function methodikSeite(cfg) {
  const m = cfg.methodik;
  const zeilen = sichtbareTests.map((e) => {
    const d = ladeTest(e);
    const umg = d.questions.filter((q) => q.reverse).length;
    const art = d.result.kind === 'levels' ? 'Stufe nach Gesamtwert' : 'Rangfolge der Bereiche';
    return `<tr><th scope="row"><a href="${e.id}.html">${esc(e.titel)}</a></th><td>${d.questions.length}</td><td>${d.categories.length}</td><td>${umg}</td><td>${art}</td></tr>`;
  }).join('');
  const abschnitte = liste(m.abschnitte).map((a) => `<section class="methodik-teil"><h2>${esc(a.titel)}</h2>${h.markdown(a.text)}</section>`).join('');
  return `
${seitenkopf(m.titel || 'So entstehen unsere Tests', m.motto, m.intro)}
<section class="abschnitt methodik" aria-label="${esc(m.titel || 'Methodik')}">
  <div class="container">
    <div class="methodik-text">${abschnitte}</div>
    <div class="methodik-tabelle" role="region" aria-label="Die Tests im Überblick" tabindex="0">
      <table class="test-tabelle">
        <caption>Die Tests im Überblick</caption>
        <thead><tr><th scope="col">Test</th><th scope="col">Aussagen</th><th scope="col">Bereiche</th><th scope="col">davon umgekehrt</th><th scope="col">Auswertung</th></tr></thead>
        <tbody>${zeilen}</tbody>
      </table>
    </div>
  </div>
</section>
${kontaktband()}`;
}

function testUebersicht(cfg) {
  const karten = '<!--g42:kacheln-->' + sichtbareTests.map((e) => T.kachel(e, seiteVon(e.id))).join('') + '<!--/g42:kacheln-->';
  const kartenKarte = kartenSichtbar ? `
      <li class="karte">
        <div class="karte-inhalt">
          <ul class="schlagworte"><li>Übung für Teams</li></ul>
          <h2>${esc(kartenCfg.titel || 'Gesprächskarten')}</h2>
          ${kartenCfg.intro ? `<p>${esc(kartenCfg.intro)}</p>` : ''}
          <a class="knopf knopf-dunkel" href="gespraechskarten.html">Karten öffnen<span class="sr-only">: ${esc(kartenCfg.titel || 'Gesprächskarten')}</span></a>
        </div>
      </li>` : '';
  return `
${seitenkopf(cfg.titel || 'Selbsttests', cfg.motto, cfg.intro, null, true)}
<section class="abschnitt" aria-label="${esc(cfg.titel || 'Selbsttests')}">
  <div class="container"><ul class="karten">${karten}${kartenKarte}
  </ul>${cfg.methodik ? '<p class="test-note methodik-link"><a href="methodik.html">So entstehen unsere Tests</a>: was sie können und was nicht.</p>' : ''}</div>
</section>
${kontaktband()}`;
}
// Test-Editor: nur das Gerüst; Ansichten (Anmelden, Testwahl, Formular, Vorschau) baut js/editor.js.
function editorSeite() {
  return `
<section class="abschnitt ed" aria-labelledby="ed-titel">
  <div class="container">
    <p class="kicker">Test-Editor</p>
    <h1 class="ed-titel" id="ed-titel">Texte der Selbsttests bearbeiten</h1>
    <noscript><p class="shop-hinweis">Für den Editor wird JavaScript benötigt.</p></noscript>
    <div class="ed-meldung" data-ed-meldung role="status" aria-live="polite"></div>
    <div class="ed-app" data-ed-app></div>
  </div>
</section>`;
}
// Gesprächskarten: Kartensätze liegen als JSON auf der Seite; js/karten.js zieht zufällig ohne Wiederholung.
// Ohne JavaScript bleibt die Liste aller Karten sichtbar.
function kartenSeite(cfg) {
  const saetze = liste(cfg.kartensaetze).filter((k) => k.id && liste(k.karten).length);
  const daten = JSON.stringify(saetze.map((k) => ({ id: k.id, titel: k.titel, karten: k.karten }))).replace(/</g, '\\u003c');
  const entwurf = cfg.sichtbar !== true;
  const alle = saetze.map((k) => `
      <section class="karten-satz-liste" aria-labelledby="ks-${esc(k.id)}">
        <h2 id="ks-${esc(k.id)}">${esc(k.titel || k.id)}</h2>
        <ul>${k.karten.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      </section>`).join('');
  return `
${seitenkopf(cfg.titel || 'Gesprächskarten', cfg.motto, cfg.intro, null, true)}
<section class="abschnitt gkarten" id="gkarten" aria-label="${esc(cfg.titel || 'Gesprächskarten')}">
  <div class="container">
    ${entwurf ? '<p class="shop-hinweis">Entwurf: Diese Seite ist noch nicht freigegeben (nicht im Menü, nicht indexierbar).</p>' : ''}
    <div class="gkarten-app" data-karten hidden>
      <div class="gkarten-wahl" role="group" aria-label="Kartenset wählen" data-wahl></div>
      <div class="gkarten-buehne" data-buehne>
        <p class="gkarten-zaehler" data-zaehler></p>
        <p class="gkarten-text" data-text tabindex="-1">Wähle ein Kartenset und ziehe eine Karte.</p>
      </div>
      <p class="sr-only" role="status" aria-live="polite" data-ansage></p>
      <div class="knoepfe gkarten-aktionen">
        <button class="knopf knopf-dunkel" type="button" data-weiter>Nächste Karte</button>
        <button class="knopf knopf-rand" type="button" data-neu hidden>Neu mischen</button>
        <button class="knopf knopf-rand" type="button" data-voll hidden>Vollbild</button>
      </div>
      <p class="test-note">Tipp: Leertaste oder Eingabetaste zieht die nächste Karte. Nichts wird gespeichert oder gesendet.</p>
    </div>
    <div class="gkarten-liste" data-liste>${alle}
    </div>
  </div>
</section>
${kontaktband()}
<script type="application/json" id="karten-daten">${daten}</script>`;
}

function teaser(cfg) {
  const t = cfg.teaser || {};
  return `<section class="test-teaser abschnitt" aria-labelledby="teaser-titel">
  <div class="container">
    <div class="test-teaser-text">
      ${t.kicker ? `<p class="kicker">${esc(t.kicker)}</p>` : ''}
      <h2 class="titel" id="teaser-titel">${betont(t.titel || cfg.titel)}</h2>
      ${t.text ? `<p>${esc(t.text)}</p>` : ''}
    </div>
    <a class="knopf knopf-dunkel" href="${testZiel}">${esc(t.knopf || 'Test starten')}</a>
  </div>
</section>`;
}

// --- Impulse (Blog) und Praxisbeispiele ---
const datumDe = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('de-AT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
};
const impulseSortiert = () => [...s.impulse.eintraege].sort((a, b) => String(b.datum || '').localeCompare(String(a.datum || '')));

function impulseUebersicht() {
  const cfg = s.impulse;
  return `
${seitenkopf(cfg.titel || 'Impulse', cfg.motto, cfg.intro)}
<section class="abschnitt" aria-label="Artikel">
  <div class="container">
    <ul class="karten">${impulseSortiert().map((e) => `
      <li class="karte"><article class="karte-inhalt">
        ${e.kategorie ? `<ul class="schlagworte"><li>${esc(e.kategorie)}</li></ul>` : ''}
        <h2><a href="${esc(seiteVon(e.id))}">${esc(e.titel)}</a></h2>
        ${e.teaser ? `<p>${esc(e.teaser)}</p>` : ''}
        <p class="impuls-meta">${e.datum ? `<time datetime="${esc(e.datum)}">${esc(datumDe(e.datum))}</time>` : ''}${e.lesezeit ? ` · ${esc(e.lesezeit)} Lesezeit` : ''}</p>
      </article></li>`).join('')}
    </ul>
  </div>
</section>
${kontaktband()}`;
}

function impulseArtikel(e) {
  return `
<section class="seitenkopf">
  <div class="container">
    <nav class="brotkrumen" aria-label="Brotkrumen"><ol><li><a href="./">Start</a></li><li><a href="impulse.html">${esc(s.impulse.titel || 'Impulse')}</a></li><li aria-current="page">${esc(e.titel)}</li></ol></nav>
    <div class="seitenkopf-inhalt"><div class="seitenkopf-text impuls-kopf">
      ${e.kategorie ? `<p class="kicker">${esc(e.kategorie)}</p>` : ''}
      <h1>${esc(e.titel)}</h1>
      <p class="impuls-meta">${e.datum ? `<time datetime="${esc(e.datum)}">${esc(datumDe(e.datum))}</time>` : ''}${s.person.name ? ` · ${esc(s.person.name)}` : ''}${e.lesezeit ? ` · ${esc(e.lesezeit)} Lesezeit` : ''}</p>
    </div></div>
  </div>
</section>
<article class="abschnitt impuls-artikel">
  <div class="container">
    <div class="impuls-text">${liste(e.absaetze).map((a) => `<p>${betont(a)}</p>`).join('')}</div>
    <p class="impuls-zurueck"><a href="impulse.html">&larr; Alle ${esc(s.impulse.titel || 'Impulse')}</a></p>
  </div>
</article>
${kontaktband()}`;
}

function impulseJsonLd(e) {
  return `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Article', headline: e.titel,
    description: e.teaser || undefined, datePublished: e.datum || undefined,
    author: s.person.name ? { '@type': 'Person', name: s.person.name } : undefined,
    publisher: { '@type': 'Organization', name: firma },
    mainEntityOfPage: websiteUrl ? `${websiteUrl}/${seiteVon(e.id)}` : undefined,
  }).replace(/</g, '\\u003c')}</script>`;
}

function fallstudienAbschnitt() {
  if (!fallstudienSichtbar) return '';
  const f = s.fallstudien;
  const teil = (titel, text) => text ? `<div class="fall-teil"><h4>${titel}</h4><p>${esc(text)}</p></div>` : '';
  return `<section class="sand abschnitt" id="praxisbeispiele" aria-labelledby="praxis-titel">
  <div class="container">
    <div class="kopfzeile"><div>${f.kicker ? `<p class="kicker">${esc(f.kicker)}</p>` : ''}<h2 class="titel" id="praxis-titel">${betont(f.titel || 'Praxisbeispiele')}</h2></div></div>
    <ul class="karten fallstudien">${f.eintraege.map((e) => `
      <li class="karte"><article class="karte-inhalt">
        <p class="fall-kunde"><strong>${esc(e.kunde)}</strong>${e.branche ? ` · ${esc(e.branche)}` : ''}</p>
        ${teil('Ausgangslage', e.ausgangslage)}${teil('Ansatz', e.ansatz)}${teil('Ergebnis', e.ergebnis)}
        ${e.zahl && e.zahl.wert ? `<p class="fall-zahl"><strong>${esc(e.zahl.wert)}</strong><span>${esc(e.zahl.label || '')}</span></p>` : ''}
      </article></li>`).join('')}
    </ul>
  </div>
</section>`;
}

function rechtsSeite(datei, ueberschrift, quelle) {
  if (!quelle) warn(`${ueberschrift} ist leer – bitte ergänzen, bevor die Seite online geht.`);
  const nachweise = datei === 'impressum.html' ? [...benutzt.values()].filter((b) => b.credit) : [];
  const liste2 = nachweise.length
    ? `<h2>Bildnachweise</h2><ul>${nachweise.map((b) => `<li>${esc(b.alt || b.datei)}: ${esc(b.credit)}</li>`).join('')}</ul>`
    : '';
  return {
    datei, titel: `${ueberschrift} – ${s.name}`, beschreibung: `${ueberschrift} der Website von ${firma}.`,
    inhalt: `<section class="abschnitt rechtliches"><div class="container"><h1>${ueberschrift}</h1><div class="rechtstext">${quelle ? h.markdown(quelle) : '<p>Dieser Text wird noch ergänzt.</p>'}${liste2}</div></div></section>`,
  };
}

// --- FAQ + strukturierte Daten (JSON-LD) -------------------------------------
// FAQ erscheint nur bei faq.sichtbar === true (Texte sprechen für die Inhaberin, bis dahin Platzhalter).
const faqEintraege = () => liste((s.faq || {}).eintraege).filter((e) => e.frage && e.antwort);
const faqSichtbar = () => (s.faq || {}).sichtbar === true && faqEintraege().length > 0;
function faqAbschnitt() {
  if (!faqSichtbar()) return '';
  const f = s.faq;
  return `<section class="faq abschnitt" id="faq" aria-labelledby="faq-titel">
  <div class="container">
    <div class="kopfzeile"><div>${f.kicker ? `<p class="kicker">${esc(f.kicker)}</p>` : ''}<h2 class="titel" id="faq-titel">${betont(f.titel || 'Häufige Fragen')}</h2></div></div>
    <div class="faq-liste">${faqEintraege().map((e) => `
      <details><summary>${esc(e.frage)}</summary><div class="faq-antwort"><p>${esc(e.antwort)}</p></div></details>`).join('')}
    </div>
  </div>
</section>`;
}
const ldTag = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
// Ergänzt jede indexierbare Seite um JSON-LD. Nur Daten, die vorhanden sind (keine Preise/Bewertungen).
function ergaenzeStrukturdaten(seitenListe) {
  for (const seite of seitenListe) {
    if (seite.noindex) continue;
    const start = seite.datei === 'index.html';
    const tags = [];
    if (start && faqSichtbar()) {
      tags.push(ldTag({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqEintraege().map((e) => ({ '@type': 'Question', name: e.frage, acceptedAnswer: { '@type': 'Answer', text: e.antwort } })) }));
    }
    if (!start && websiteUrl && !['impressum.html', 'datenschutz.html'].includes(seite.datei)) {
      const url = `${websiteUrl}/${seite.datei}`;
      const name = seite.titel.split(' – ')[0].split(':')[0];
      const graph = [
        { '@type': 'BreadcrumbList', itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Start', item: `${websiteUrl}/` },
          { '@type': 'ListItem', position: 2, name, item: url },
        ] },
        { '@type': 'WebPage', '@id': url, url, name: seite.titel, description: seite.beschreibung, inLanguage: 'de-AT', isPartOf: { '@type': 'WebSite', name: s.name, url: `${websiteUrl}/` } },
      ];
      const z = s.zielgruppen.find((x) => seiteVon(x.id) === seite.datei);
      if (z) {
        for (const w of z.workshops) {
          graph.push({ '@type': 'Course', name: w.titel, description: w.text || undefined, inLanguage: 'de-AT', provider: { '@type': 'Organization', name: firma, url: `${websiteUrl}/` }, url });
        }
      }
      tags.push(ldTag({ '@context': 'https://schema.org', '@graph': graph }));
    }
    if (tags.length) seite.zusatzHead = (seite.zusatzHead || '') + tags.join('');
  }
}

// ---------------------------------------------------------------------------
// 7. Seitengerüst
// ---------------------------------------------------------------------------

const websiteUrl = (s.website_url || '').replace(/\/+$/, '');
const absolut = (rel) => (websiteUrl ? `${websiteUrl}/${rel}` : rel);
const fotografen = () => [...new Set([...benutzt.values()].map((b) => b.credit).filter(Boolean))];

function minifyCss(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{}:;,>])\s*/g, '$1').replace(/;}/g, '}').trim();
}
const css = minifyCss(fs.readFileSync(path.join(ROOT, 'src/css/style.css'), 'utf8'));
const heroInfo = s.hero.bild ? verarbeiteBild(normBild(s.hero.bild).datei) : null;
const ogBild = heroInfo ? absolut(heroInfo.src) : '';

// Hauptmenü: "Angebot" als aufklappbare Liste (<details>, funktioniert auch ohne JavaScript), darunter Workshops nach
// Zielgruppe, Leistungen und Seminare als echte Links. Ein Knopf "Kontakt aufnehmen" statt Text-Link plus Knopf.
function hauptnav({ aktiv, anker, kontaktZiel }) {
  const aktuell = (id) => (aktiv === id ? ' aria-current="page"' : '');
  const leistungsSeiten = s.leistungen.eintraege.filter((l) => liste(l.abschnitte).length);
  const shopSichtbar = s.shop && s.shop.aktiv && s.shop.sichtbar === true;
  const gruppen = [
    s.zielgruppen.length && { titel: 'Workshops', links: s.zielgruppen.map((z) => ({ id: z.id, href: seiteVon(z.id), text: z.titel })) },
    leistungsSeiten.length && { titel: 'Leistungen', links: leistungsSeiten.map((l) => ({ id: l.id, href: seiteVon(l.id), text: l.titel })) },
    shopSichtbar && { titel: esc(s.shop.titel || 'Seminare') === 'Seminare' ? 'Seminare' : esc(s.shop.titel), links: [{ id: 'shop', href: 'shop.html', text: `${s.shop.titel || 'Seminare'} buchen` }] },
  ].filter(Boolean);
  const imAngebot = gruppen.some((g) => g.links.some((l) => l.id === aktiv));
  const angebot = gruppen.length ? `<li class="nav-gruppe"><details${imAngebot ? ' class="ist-aktiv"' : ''}>
          <summary>Angebot</summary>
          <div class="nav-panel">${gruppen.map((g) => `
            <div><p class="nav-titel">${g.titel}</p><ul>${g.links.map((l) => `<li><a href="${l.href}"${aktuell(l.id)}>${esc(l.text)}</a></li>`).join('')}</ul></div>`).join('')}
            ${s.leistungen.eintraege.length ? `<p class="nav-alle"><a href="${anker('leistungen')}">Alle Leistungen im Überblick</a></p>` : ''}
          </div>
        </details></li>` : '';
  const testLabel = sichtbareTests.length === 1 && !kartenSichtbar ? sichtbareTests[0].titel : (testsCfg && testsCfg.titel) || 'Selbsttests';
  const testAktiv = aktiv === 'selbsttests' || aktiv === 'gespraechskarten' || sichtbareTests.some((e) => e.id === aktiv);
  return `<nav class="hauptnav" aria-label="Hauptmenü">
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav-liste" hidden>Menü<span class="nav-toggle-strich" aria-hidden="true"></span></button>
      <ul id="nav-liste">
        ${angebot}
        ${testsCfg && sichtbareTests.length ? `<li><a href="${testZiel}"${testAktiv ? ' aria-current="page"' : ''}>${esc(testLabel)}</a></li>` : ''}
        ${impulseSichtbar && s.impulse.eintraege.length ? `<li><a href="impulse.html"${aktuell('impulse')}>${esc(s.impulse.titel || 'Impulse')}</a></li>` : ''}
        ${liste(s.geschichte.stationen).length ? `<li><a href="${anker('geschichte')}">Über uns</a></li>` : ''}
        <li><a class="knopf knopf-dunkel" href="${kontaktZiel}">Kontakt aufnehmen</a></li>
      </ul>
    </nav>`;
}

// basis: Seite in einem Unterordner (editor/index.html) -> <base href="/">, damit Fonts, CSS-URLs und Links stimmen
function layout({ datei, titel, beschreibung, inhalt, aktiv = '', zusatzHead = '', noindex = false, basis = false }) {
  const start = datei === 'index.html';
  // Seiten im Unterordner (Editor) bekommen keine kanonische URL und kein og:url
  const seitenUrl = websiteUrl && !basis ? `${websiteUrl}/${start ? '' : datei}` : '';
  const anker = (id) => (start ? `#${id}` : `./#${id}`);
  // Kontaktband vorhanden -> Sprung auf der Seite; sonst zur Startseite (sonst tut der Knopf nichts)
  const kontaktZiel = inhalt.includes('id="kontakt"') ? '#kontakt' : './#kontakt';
  const og = [
    ['og:type', 'website'], ['og:locale', 'de_AT'], ['og:site_name', s.name],
    ['og:title', titel], ['og:description', beschreibung],
    seitenUrl && ['og:url', seitenUrl], ogBild && ['og:image', ogBild],
  ].filter(Boolean).map(([p, v]) => `<meta property="${p}" content="${esc(v)}">`).join('\n');
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">${basis ? '\n<base href="/">' : ''}
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titel)}</title>
<meta name="description" content="${esc(beschreibung)}">
${demo || noindex ? '<meta name="robots" content="noindex, nofollow">' : ''}
${seitenUrl ? `<link rel="canonical" href="${esc(seitenUrl)}">` : ''}
<meta name="theme-color" content="#FFFBF5">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="preload" href="fonts/newsreader-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="fonts/figtree-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
${zusatzHead}
${og}
<meta name="twitter:card" content="summary_large_image">
<style>${css}</style>
<script src="${mainJsUrl}" defer></script>
</head>
<body>
<a class="skip-link" href="${basis ? esc(datei.replace(/index\.html$/, '')) : ''}#inhalt">Zum Inhalt springen</a>
${demo ? `<div class="entwurf" role="note">Entwurf der neuen Website für ${esc(s.name)}${s.ersteller ? `, erstellt von ${esc(s.ersteller)}` : ''}</div>` : ''}
<header class="kopf">
  <div class="container kopf-innen">
    ${marke('./', start)}
    ${hauptnav({ aktiv, anker, kontaktZiel })}
  </div>
</header>
<main id="inhalt">
${inhalt}
</main>
<footer class="fuss">
  <div class="container fuss-innen">
    <div>
      ${marke('./', false)}
      <address>${esc(firma)}${adresse.strasse ? `<br>${esc(adresse.strasse)}` : ''}${adresse.ort ? `<br>${esc([adresse.plz, adresse.ort].filter(Boolean).join(' '))}` : ''}</address>
    </div>
    <div>
      <h2>Kontakt</h2>
      <ul>
        ${telefon ? `<li><a href="${esc(telLink)}">${esc(telefon)}</a></li>` : ''}
        ${email ? `<li><a href="mailto:${esc(email)}">${esc(email)}</a></li>` : ''}
      </ul>
    </div>
    ${s.zielgruppen.length ? `<div>
      <h2>Workshops</h2>
      <ul>${s.zielgruppen.map((z) => `<li><a href="${seiteVon(z.id)}">${esc(z.titel)}</a></li>`).join('')}</ul>
    </div>` : ''}
    <div>
      <h2>Rechtliches</h2>
      <ul><li><a href="impressum.html">Impressum</a></li><li><a href="datenschutz.html">Datenschutz</a></li></ul>
    </div>
  </div>
  <div class="container fuss-unten">
    <p>© <span data-jahr>${new Date().getFullYear()}</span> ${esc(firma)}${fotografen().length ? ` · Fotos: ${fotografen().map(esc).join(', ')}` : ''}</p>
  </div>
</footer>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// 8. Seiten schreiben
// ---------------------------------------------------------------------------

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'ProfessionalService',
  name: firma,
  description: s.kurzbeschreibung || undefined,
  url: websiteUrl || undefined,
  telephone: telefon || undefined,
  email: email || undefined,
  image: heroInfo ? absolut(heroInfo.groesste) : undefined,
  address: adresse.strasse ? {
    '@type': 'PostalAddress', streetAddress: adresse.strasse, postalCode: adresse.plz, addressLocality: adresse.ort, addressCountry: adresse.land === 'Deutschland' ? 'DE' : 'AT',
  } : undefined,
  founder: s.person.name ? { '@type': 'Person', name: s.person.name, jobTitle: s.person.rolle || undefined } : undefined,
};

const titelHero = ohneBetonung(s.hero.titel);
// Inhalte zuerst erzeugen (dabei werden benutzte Bilder gesammelt), dann mit Gerüst schreiben
const seiten = [
  {
    datei: 'index.html', aktiv: 'start', inhalt: startseite(),
    titel: `${s.name} – ${titelHero}`,
    beschreibung: (s.kurzbeschreibung || s.hero.text || s.name).slice(0, 160),
    zusatzHead: `${vorladen(heroInfo, '(min-width: 1360px) 1280px, 96vw')}<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`,
  },
  ...s.zielgruppen.map((z) => ({
    datei: seiteVon(z.id), aktiv: z.id, inhalt: zielgruppenSeite(z),
    titel: `${z.titel}: Workshops und Programme – ${s.name}`,
    beschreibung: (z.intro || `${z.titel} – Workshops von ${s.name}`).slice(0, 160),
  })),
  ...s.leistungen.eintraege.filter((l) => liste(l.abschnitte).length).map((l) => ({
    datei: seiteVon(l.id), aktiv: l.id, inhalt: leistungsSeite(l),
    titel: `${l.titel} – ${s.name}`,
    beschreibung: (l.intro || l.text || l.titel).slice(0, 160),
  })),
];
// Shop-Seite: nicht im Menü, nicht in der Sitemap, noindex, bis s.shop.sichtbar true ist (Rechtstexte freigegeben)
if (s.shop && s.shop.aktiv) {
  const sichtbar = s.shop.sichtbar === true;
  seiten.push({
    datei: 'shop.html', aktiv: 'shop', inhalt: shopSeite(s.shop), noindex: !sichtbar,
    titel: `${s.shop.titel || 'Seminare'} – ${s.name}`,
    beschreibung: (s.shop.intro || `Seminare von ${s.name}`).slice(0, 160),
  });
}
if (testsCfg) {
  if (sichtbareTests.length + (kartenSichtbar ? 1 : 0) > 1) {
    seiten.push({
      datei: 'selbsttests.html', aktiv: 'selbsttests', inhalt: testUebersicht(testsCfg), noindex: false,
      titel: `${testsCfg.titel || 'Selbsttests'} – ${s.name}`,
      beschreibung: (testsCfg.intro || 'Selbsttests und Reflexion').slice(0, 160),
    });
  }
  if (testsCfg.methodik && sichtbareTests.length) {
    seiten.push({
      datei: 'methodik.html', aktiv: 'selbsttests', inhalt: methodikSeite(testsCfg), noindex: false,
      titel: `${testsCfg.methodik.titel || 'So entstehen unsere Tests'} – ${s.name}`,
      beschreibung: (testsCfg.methodik.intro || 'Methodik der Selbsttests').slice(0, 160),
    });
  }
  tests.forEach((e) => {
    const daten = ladeTest(e);
    seiten.push({
      datei: seiteVon(e.id), aktiv: e.id, inhalt: testSeite(e, daten, testsCfg), noindex: e.sichtbar !== true,
      titel: daten.name && daten.name !== e.titel ? `${e.titel}: ${daten.name} – ${s.name}` : `${e.titel} – ${s.name}`,
      beschreibung: (e.intro || daten.name).slice(0, 160),
      zusatzHead: `<script src="${testJsUrl}" defer></script>`,
    });
  });
}
// Impulse: Seiten werden immer gebaut; unsichtbar = noindex, kein Menü, keine Sitemap
if (s.impulse.eintraege.length) {
  seiten.push({
    datei: 'impulse.html', aktiv: 'impulse', inhalt: impulseUebersicht(), noindex: !impulseSichtbar,
    titel: `${s.impulse.titel || 'Impulse'} – ${s.name}`,
    beschreibung: (s.impulse.intro || `Impulse von ${s.name}`).slice(0, 160),
  });
  for (const e of s.impulse.eintraege) {
    seiten.push({
      datei: seiteVon(e.id), aktiv: 'impulse', inhalt: impulseArtikel(e), noindex: !impulseSichtbar,
      titel: `${e.titel} – ${s.name}`,
      beschreibung: (e.teaser || e.titel).slice(0, 160),
      zusatzHead: impulseJsonLd(e),
    });
  }
}
if (kartenCfg) {
  seiten.push({
    datei: 'gespraechskarten.html', aktiv: 'gespraechskarten', inhalt: kartenSeite(kartenCfg), noindex: !kartenSichtbar,
    titel: `${kartenCfg.titel || 'Gesprächskarten'} – ${s.name}`,
    beschreibung: (kartenCfg.intro || 'Gesprächskarten für Teammeetings').slice(0, 160),
    zusatzHead: `<script src="${kartenJsUrl}" defer></script>`,
  });
}
// Test-Editor: nicht im Menü, noindex (damit nicht in der Sitemap), in robots.txt ausgeschlossen
if (editorJs.length) {
  fs.mkdirSync(path.join(DIST, 'editor'), { recursive: true });
  seiten.push({
    datei: 'editor/index.html', aktiv: 'editor', inhalt: editorSeite(), noindex: true, basis: true,
    titel: `Test-Editor – ${s.name}`,
    beschreibung: 'Texte der Selbsttests bearbeiten und zur Freigabe senden.',
    zusatzHead: editorJs.map((u) => `<script src="${u}" defer></script>`).join(''),
  });
}
seiten.push(rechtsSeite('impressum.html', 'Impressum', s.impressum), rechtsSeite('datenschutz.html', 'Datenschutz', s.datenschutz));
ergaenzeStrukturdaten(seiten);
for (const seite of seiten) fs.writeFileSync(path.join(DIST, seite.datei), layout(seite));

// ---------------------------------------------------------------------------
// 9. Favicon, robots.txt, sitemap.xml
// ---------------------------------------------------------------------------

const zahl = (s.name.match(/(\d{1,3})$/) || [])[1];
fs.writeFileSync(path.join(DIST, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#F2B33D"/><text x="32" y="41" font-family="Arial, sans-serif" font-weight="700" font-size="${zahl ? 26 : 24}" text-anchor="middle" fill="#2E2520">${esc(zahl || h.initialen(s.name))}</text></svg>`);
fs.writeFileSync(path.join(DIST, 'robots.txt'),
  demo ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nAllow: /\n${editorJs.length ? 'Disallow: /editor/\n' : ''}${websiteUrl ? `Sitemap: ${websiteUrl}/sitemap.xml\n` : ''}`);
if (websiteUrl && !demo) {
  const heute = new Date().toISOString().slice(0, 10);
  const urls = seiten.filter((p) => !p.noindex).map((p) => `<url><loc>${websiteUrl}/${p.datei === 'index.html' ? '' : p.datei}</loc><lastmod>${heute}</lastmod></url>`).join('');
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>\n`);
}
if (!demo && !websiteUrl) warn('website_url ist leer – ohne sie fehlen canonical-Link, absolute Open-Graph-Bilder und sitemap.xml.');

// ---------------------------------------------------------------------------
// 10. Zusammenfassung
// ---------------------------------------------------------------------------

const groesse = (function summe(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => {
    const p = path.join(dir, e.name);
    return n + (e.isDirectory() ? summe(p) : fs.statSync(p).size);
  }, 0);
})(DIST);
console.log(`✔ ${s.name} gebaut → ${path.relative(process.cwd(), DIST) || '.'}  (${(groesse / 1024 / 1024).toFixed(1)} MB, ${demo ? 'DEMO-Modus: noindex' : 'live: indexierbar'})`);
console.log(`  Seiten: ${seiten.map((p) => p.datei).join(', ')}`);
if (warnungen.length) {
  console.log(`\n⚠ ${warnungen.length} Hinweis(e):`);
  warnungen.forEach((w) => console.log('  - ' + w));
}
