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

const reserviert = new Set(['index', 'impressum', 'datenschutz', 'shop']);
const ids = [...s.zielgruppen.map((z) => z.id), ...s.leistungen.eintraege.filter((l) => liste(l.abschnitte).length).map((l) => l.id)];
for (const id of ids) {
  if (reserviert.has(id)) { console.error(`✖ id "${id}" ist reserviert.`); process.exit(1); }
  if (ids.indexOf(id) !== ids.lastIndexOf(id)) { console.error(`✖ id "${id}" kommt doppelt vor.`); process.exit(1); }
}

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
      <h2 id="kontakt-titel">${betont(kb.titel || 'Sprechen wir über Ihr Vorhaben.')}</h2>
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

${s.stimmen.haupt || liste(s.stimmen.weitere).length ? `<section class="abschnitt" aria-label="${esc(s.stimmen.kicker || 'Stimmen')}">
  <div class="container">
    ${s.stimmen.kicker ? `<p class="kicker">${esc(s.stimmen.kicker)}</p>` : ''}
    <div class="stimmen">
      ${stimmeFigur(s.stimmen.haupt, 'stimme-haupt')}
      ${liste(s.stimmen.weitere).length ? `<div class="stimme-weitere">${s.stimmen.weitere.map((st) => stimmeFigur(st, 'stimme-karte')).join('')}</div>` : ''}
    </div>
  </div>
</section>` : ''}

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

${kontaktband()}`;
}

// ---------------------------------------------------------------------------
// 6. Unterseiten
// ---------------------------------------------------------------------------

function seitenkopf(titel, motto, intro, bildRef) {
  return `<section class="seitenkopf">
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
    <h2 class="titel" id="rahmen-titel">Abgestimmt auf <em>Ihr</em> Unternehmen.</h2>
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
    if (b.datei) benutzt.set(b.datei, { datei: b.datei, alt: b.alt || '', credit: b.credit || '' });
    return `
      <li class="karte">
        ${b.datei ? `<img src="${esc(b.datei)}" alt="${esc(b.alt || '')}" width="960" height="640" loading="lazy" decoding="async">` : '<div class="platzhalter" aria-hidden="true"></div>'}
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

function layout({ datei, titel, beschreibung, inhalt, aktiv = '', zusatzHead = '', noindex = false }) {
  const start = datei === 'index.html';
  const seitenUrl = websiteUrl ? `${websiteUrl}/${start ? '' : datei}` : '';
  const anker = (id) => (start ? `#${id}` : `./#${id}`);
  const og = [
    ['og:type', 'website'], ['og:locale', 'de_AT'], ['og:site_name', s.name],
    ['og:title', titel], ['og:description', beschreibung],
    seitenUrl && ['og:url', seitenUrl], ogBild && ['og:image', ogBild],
  ].filter(Boolean).map(([p, v]) => `<meta property="${p}" content="${esc(v)}">`).join('\n');
  const zielgruppenNav = s.zielgruppen.length ? `<li><a href="${anker('zielgruppen')}"${s.zielgruppen.some((z) => z.id === aktiv) ? ' aria-current="page"' : ''}>Workshops</a></li>` : '';
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
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
<a class="skip-link" href="#inhalt">Zum Inhalt springen</a>
${demo ? `<div class="entwurf" role="note">Entwurf der neuen Website für ${esc(s.name)}${s.ersteller ? `, erstellt von ${esc(s.ersteller)}` : ''}</div>` : ''}
<header class="kopf">
  <div class="container kopf-innen">
    ${marke('./', start)}
    <nav class="hauptnav" aria-label="Hauptmenü">
      <ul>
        ${s.leistungen.eintraege.length ? `<li><a href="${anker('leistungen')}"${s.leistungen.eintraege.some((l) => l.id === aktiv) ? ' aria-current="page"' : ''}>Leistungen</a></li>` : ''}
        ${zielgruppenNav}
        ${s.shop && s.shop.aktiv && s.shop.sichtbar === true ? `<li><a href="shop.html"${aktiv === 'shop' ? ' aria-current="page"' : ''}>${esc(s.shop.titel || 'Seminare')}</a></li>` : ''}
        ${liste(s.geschichte.stationen).length ? `<li><a href="${anker('geschichte')}">Über uns</a></li>` : ''}
        <li><a href="#kontakt">Kontakt</a></li>
        <li><a class="knopf knopf-dunkel" href="#kontakt">Erstgespräch vereinbaren</a></li>
      </ul>
    </nav>
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
seiten.push(rechtsSeite('impressum.html', 'Impressum', s.impressum), rechtsSeite('datenschutz.html', 'Datenschutz', s.datenschutz));
for (const seite of seiten) fs.writeFileSync(path.join(DIST, seite.datei), layout(seite));

// ---------------------------------------------------------------------------
// 9. Favicon, robots.txt, sitemap.xml
// ---------------------------------------------------------------------------

const zahl = (s.name.match(/(\d{1,3})$/) || [])[1];
fs.writeFileSync(path.join(DIST, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#F2B33D"/><text x="32" y="41" font-family="Arial, sans-serif" font-weight="700" font-size="${zahl ? 26 : 24}" text-anchor="middle" fill="#2E2520">${esc(zahl || h.initialen(s.name))}</text></svg>`);
fs.writeFileSync(path.join(DIST, 'robots.txt'),
  demo ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nAllow: /\n${websiteUrl ? `Sitemap: ${websiteUrl}/sitemap.xml\n` : ''}`);
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
