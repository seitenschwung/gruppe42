'use strict';
// Gemeinsame Hilfsfunktionen aller Vorlagen (build.js, Templates, hub.js, Skripte) – ohne externe Abhängigkeiten.

const fs = require('fs');

// ---------- Text ----------

function esc(wert) {
  return String(wert ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Absätze aus einem String (getrennt durch Leerzeile) oder einem Array.
function absaetze(text) {
  if (!text) return [];
  if (Array.isArray(text)) return text.filter(Boolean);
  return String(text).split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
}

// Erlaubte Link-Ziele in Markdown (kein javascript: o. Ä.)
function sichererLink(url) {
  return /^(https?:\/\/|mailto:|tel:|#|\/|\.\/|[\w-]+\.html)/i.test(url) ? url : '#';
}

function inlineMd(text) {
  return esc(text)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => {
      const ziel = sichererLink(u.replace(/&amp;/g, '&'));
      const extern = /^https?:/i.test(ziel) ? ' rel="noopener"' : '';
      return `<a href="${esc(ziel)}"${extern}>${t}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
}

// Minimales Markdown: Überschriften (#), Listen (- / *), Absätze, Zeilenumbrüche,
// **fett**, *kursiv*, [Link](url). HTML-Tags werden bewusst nicht übernommen (Sicherheit).
// Die Seite selbst trägt die <h1>; Überschriften im Text beginnen daher bei <h2>.
function markdown(quelle) {
  if (!quelle) return '';
  // Kein Roh-HTML: alles wird maskiert, damit über die Inhalte kein Skript eingeschleust werden kann
  const zeilen = String(quelle).replace(/\r/g, '').split('\n');
  // Höchste vorkommende Ebene (# oder ##) wird zu <h2>, damit keine Ebene übersprungen wird
  const ebenen = zeilen.map((z) => (z.match(/^(#{1,4})\s/) || [])[1]).filter(Boolean).map((x) => x.length);
  const versatz = 2 - (ebenen.length ? Math.min(...ebenen) : 1);
  const out = [];
  let absatz = [];
  let liste = [];
  const flushAbsatz = () => {
    if (absatz.length) out.push(`<p>${absatz.map(inlineMd).join('<br>\n')}</p>`);
    absatz = [];
  };
  const flushListe = () => {
    if (liste.length) out.push(`<ul>${liste.map((l) => `<li>${inlineMd(l)}</li>`).join('')}</ul>`);
    liste = [];
  };
  for (const zeile of zeilen) {
    const h = zeile.match(/^(#{1,4})\s+(.*)$/);
    const li = zeile.match(/^\s*[-*]\s+(.*)$/);
    if (h) {
      flushAbsatz(); flushListe();
      const ebene = Math.min(h[1].length + versatz, 5);
      out.push(`<h${ebene}>${inlineMd(h[2])}</h${ebene}>`);
    } else if (li) {
      flushAbsatz();
      liste.push(li[1]);
    } else if (!zeile.trim()) {
      flushAbsatz(); flushListe();
    } else {
      flushListe();
      absatz.push(zeile.trim());
    }
  }
  flushAbsatz(); flushListe();
  return out.join('\n');
}

function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function initialen(name) {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((t) => t[0].toUpperCase()).join('');
}

// ---------- Farben ----------

function hexZuRgb(hex) {
  let h = String(hex || '').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function rgbZuHex(rgb) {
  return '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function luminanz(hex) {
  const [r, g, b] = hexZuRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function kontrast(a, b) {
  const [h, d] = [luminanz(a), luminanz(b)].sort((x, y) => y - x);
  return (h + 0.05) / (d + 0.05);
}

function mischen(a, b, anteilB) {
  const ra = hexZuRgb(a), rb = hexZuRgb(b);
  return rgbZuHex(ra.map((v, i) => v + (rb[i] - v) * anteilB));
}

// Dunkelt eine Farbe so lange ab, bis sie auf allen Hintergründen den Mindestkontrast erreicht.
function abdunkelnBisKontrast(hex, hintergruende, minimum = 4.6) {
  let farbe = hex;
  for (let i = 0; i < 40 && hintergruende.some((bg) => kontrast(farbe, bg) < minimum); i++) {
    farbe = mischen(farbe, '#000000', 0.05);
  }
  return farbe;
}

// ---------- Bildgrößen (PNG, JPEG, WebP) ohne externe Bibliothek ----------

function bildGroesse(datei) {
  const b = fs.readFileSync(datei);
  // PNG
  if (b.readUInt32BE(0) === 0x89504e47) return { breite: b.readUInt32BE(16), hoehe: b.readUInt32BE(20) };
  // JPEG
  if (b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o < b.length) {
      if (b[o] !== 0xff) { o++; continue; }
      const marker = b[o + 1];
      const laenge = b.readUInt16BE(o + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { hoehe: b.readUInt16BE(o + 5), breite: b.readUInt16BE(o + 7) };
      }
      o += 2 + laenge;
    }
  }
  // WebP
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return { breite: b.readUInt16LE(26) & 0x3fff, hoehe: b.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { breite: (bits & 0x3fff) + 1, hoehe: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') return { breite: b.readUIntLE(24, 3) + 1, hoehe: b.readUIntLE(27, 3) + 1 };
  }
  // SVG: Größe aus viewBox
  const text = b.toString('utf8', 0, Math.min(b.length, 2000));
  const vb = text.match(/viewBox="[\d.\s-]*?([\d.]+)\s+([\d.]+)"/);
  if (vb) return { breite: Math.round(+vb[1]), hoehe: Math.round(+vb[2]) };
  return null;
}

// ---------- Kontakt ----------

const LAENDER = {
  deutschland: { iso: 'DE', vorwahl: '49', locale: 'de_DE', zeitzone: 'Europe/Berlin' },
  de: { iso: 'DE', vorwahl: '49', locale: 'de_DE', zeitzone: 'Europe/Berlin' },
  österreich: { iso: 'AT', vorwahl: '43', locale: 'de_AT', zeitzone: 'Europe/Vienna' },
  oesterreich: { iso: 'AT', vorwahl: '43', locale: 'de_AT', zeitzone: 'Europe/Vienna' },
  at: { iso: 'AT', vorwahl: '43', locale: 'de_AT', zeitzone: 'Europe/Vienna' },
  schweiz: { iso: 'CH', vorwahl: '41', locale: 'de_CH', zeitzone: 'Europe/Zurich' },
  ch: { iso: 'CH', vorwahl: '41', locale: 'de_CH', zeitzone: 'Europe/Zurich' },
};

function landInfo(land) {
  return LAENDER[String(land || 'Deutschland').trim().toLowerCase()] || LAENDER.deutschland;
}

// "0431 000 12 34" -> "+494310001234"
function telefonInternational(nummer, land) {
  let d = String(nummer || '').replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('+')) return d;
  if (d.startsWith('00')) return '+' + d.slice(2);
  if (d.startsWith('0')) return '+' + landInfo(land).vorwahl + d.slice(1);
  return d;
}

// ---------- Öffnungszeiten ----------

const WOCHENTAGE = [
  { namen: ['montag', 'mo'], schema: 'Monday', nr: 1 },
  { namen: ['dienstag', 'di'], schema: 'Tuesday', nr: 2 },
  { namen: ['mittwoch', 'mi'], schema: 'Wednesday', nr: 3 },
  { namen: ['donnerstag', 'do'], schema: 'Thursday', nr: 4 },
  { namen: ['freitag', 'fr'], schema: 'Friday', nr: 5 },
  { namen: ['samstag', 'sa', 'sonnabend'], schema: 'Saturday', nr: 6 },
  { namen: ['sonntag', 'so'], schema: 'Sunday', nr: 7 },
];

// "09:00–13:00, 14:00–18:30" oder "9-18 Uhr" -> [{von:'09:00', bis:'13:00'}, ...]; "geschlossen" -> []
function zeitenParsen(text) {
  const t = String(text || '');
  if (!t.trim() || /geschlossen|ruhetag|closed/i.test(t)) return [];
  const bereiche = [];
  const re = /(\d{1,2})(?:[:.](\d{2}))?\s*(?:–|-|—|bis)\s*(\d{1,2})(?:[:.](\d{2}))?/g;
  let m;
  while ((m = re.exec(t))) {
    bereiche.push({ von: `${m[1].padStart(2, '0')}:${m[2] || '00'}`, bis: `${m[3].padStart(2, '0')}:${m[4] || '00'}` });
  }
  return bereiche;
}

function wochentag(name) {
  const n = String(name || '').trim().toLowerCase().replace('.', '');
  return WOCHENTAGE.find((w) => w.namen.includes(n)) || null;
}

// Preis: Zahl -> "149,90 €", Text bleibt unverändert
function preis(wert) {
  if (wert === undefined || wert === null || wert === '') return '';
  if (typeof wert === 'number') return wert.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  return String(wert);
}

module.exports = {
  preis,
  esc, absaetze, markdown, slug, initialen,
  hexZuRgb, kontrast, mischen, abdunkelnBisKontrast,
  bildGroesse, landInfo, telefonInternational, zeitenParsen, wochentag,
};
