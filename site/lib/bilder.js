'use strict';
// Gemeinsame Bildverarbeitung aller Vorlagen: responsive WebP-Varianten (cwebp) und – falls
// `avifenc` installiert ist – zusätzlich AVIF (rund 25 % kleiner). Ergebnisse landen im Cache
// (CACHE_DIR), benannt nach einer Prüfsumme des Originals: Ein ausgetauschtes Foto wird neu
// umgewandelt, ein unverändertes nie – egal, welches Dateidatum es beim Kopieren bekommt.
// Ohne cwebp werden die Originale unverändert kopiert.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const { slug, bildGroesse } = require('./helfer');

const STANDARD_BREITEN = [480, 800, 1200, 1600, 2000];
const programmDa = (name, arg) => spawnSync(name, [arg]).status === 0;

/**
 * Erzeugt eine Bildverarbeitung für einen Build.
 *   bilderDir   Ordner mit den Originalen        distDir  Zielordner der Seite (Bilder in img/)
 *   cacheDir    Cache für Varianten               warn     Funktion für Hinweise
 *   qualitaet   WebP-Qualität (Standard 76)       minBreite  ab dieser Breite keine Warnung (0 = aus)
 *   avif        AVIF erzeugen, falls avifenc da ist (Standard: true)
 * Rückgabe: verarbeite(datei) -> { breite, hoehe, src, srcset, avifSrcset, groesste } | null
 */
function bildVerarbeitung({ bilderDir, distDir, cacheDir, warn, qualitaet = 76, minBreite = 0, avif = true, breiten = STANDARD_BREITEN }) {
  const hatCwebp = programmDa('cwebp', '-version');
  const hatAvif = avif && hatCwebp && programmDa('avifenc', '--version');
  if (!hatCwebp) warn('cwebp nicht gefunden – Bilder werden ohne Größenvarianten kopiert (siehe README, Abschnitt Bilder).');
  else if (avif && !hatAvif) warn('avifenc nicht gefunden – Bilder nur als WebP (für AVIF: Paket „libavif-bin“ bzw. „libavif-apps“).');
  fs.mkdirSync(path.join(distDir, 'img'), { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const cache = new Map();

  // Variante im Cache erzeugen (falls noch nicht vorhanden) und in die Seite kopieren
  function variante(quelle, datei, name, pruefsumme, erzeugen) {
    const ziel = path.join(cacheDir, `${pruefsumme}-${name}`);
    if (!fs.existsSync(ziel)) {
      // erst unter Prozess-eigenem Namen schreiben, dann umbenennen: parallele Builds teilen sich den Cache
      const zwischen = path.join(cacheDir, `.${process.pid}-${pruefsumme}-${name}`);
      const r = erzeugen(zwischen);
      if (r.status !== 0) throw new Error(`Bildfehler bei ${datei}: ${r.stderr}`);
      fs.renameSync(zwischen, ziel);
    }
    fs.copyFileSync(ziel, path.join(distDir, 'img', name));
  }

  function verarbeite(datei) {
    if (!datei) return null;
    if (cache.has(datei)) return cache.get(datei);
    const quelle = path.join(bilderDir, datei);
    let info = null;
    if (!fs.existsSync(quelle)) {
      warn(`Bild fehlt: images/${datei} – Platzhalter wird angezeigt.`);
    } else {
      const groesse = bildGroesse(quelle);
      const ext = path.extname(datei).toLowerCase();
      const basis = slug(path.basename(datei, ext));
      const pruefsumme = crypto.createHash('sha1').update(fs.readFileSync(quelle)).digest('hex').slice(0, 10);
      if (!groesse) {
        warn(`Bildformat von images/${datei} nicht erkannt (erlaubt: JPG, PNG, WebP, SVG).`);
      } else if (ext === '.svg' || !hatCwebp) {
        const name = basis + ext;
        fs.copyFileSync(quelle, path.join(distDir, 'img', name));
        info = { breite: groesse.breite, hoehe: groesse.hoehe, src: `img/${name}`, srcset: '', avifSrcset: '', groesste: `img/${name}` };
      } else {
        const maxBreite = Math.min(groesse.breite, breiten[breiten.length - 1]);
        const stufen = [...new Set([...breiten.filter((b) => b < maxBreite), maxBreite])];
        const webp = stufen.map((b) => {
          const name = `${basis}-${b}.webp`;
          variante(quelle, datei, name, pruefsumme, (ziel) => {
            const args = ['-quiet', '-q', String(qualitaet), '-metadata', 'none'];
            if (b < groesse.breite) args.push('-resize', String(b), '0');
            return spawnSync('cwebp', [...args, quelle, '-o', ziel]);
          });
          return { b, url: `img/${name}` };
        });
        // AVIF aus einer verlustfreien, passend skalierten Zwischenstufe (avifenc kann nicht skalieren;
        // aus dem fertigen WebP würde doppelt komprimiert und die Ersparnis wäre klein)
        const avifs = hatAvif
          ? stufen.map((b) => {
              const name = `${basis}-${b}.avif`;
              variante(quelle, datei, name, pruefsumme, (ziel) => {
                const tmpWebp = ziel.replace(/\.avif$/, '.tmp.webp');
                const tmpPng = ziel.replace(/\.avif$/, '.tmp.png');
                const args = ['-quiet', '-lossless', '-z', '0', '-metadata', 'none']; // schnellste verlustfreie Stufe
                if (b < groesse.breite) args.push('-resize', String(b), '0');
                const schritte = [
                  () => spawnSync('cwebp', [...args, quelle, '-o', tmpWebp]),
                  () => spawnSync('dwebp', ['-quiet', tmpWebp, '-o', tmpPng]),
                  () => spawnSync('avifenc', ['-q', '55', '-s', '6', '-j', 'all', tmpPng, ziel]),
                ];
                let r;
                for (const schritt of schritte) { r = schritt(); if (r.status !== 0) break; }
                fs.rmSync(tmpWebp, { force: true });
                fs.rmSync(tmpPng, { force: true });
                return r;
              });
              return { b, url: `img/${name}` };
            })
          : [];
        const mittel = webp.find((v) => v.b >= 1200) || webp[webp.length - 1];
        info = {
          breite: maxBreite,
          hoehe: Math.round((groesse.hoehe * maxBreite) / groesse.breite),
          src: mittel.url,
          srcset: webp.map((v) => `${v.url} ${v.b}w`).join(', '),
          avifSrcset: avifs.map((v) => `${v.url} ${v.b}w`).join(', '),
          groesste: webp[webp.length - 1].url,
        };
      }
      if (groesse && minBreite && groesse.breite < minBreite) {
        warn(`images/${datei} ist nur ${groesse.breite} px breit – für große Darstellung ggf. bessere Datei anfragen.`);
      }
    }
    cache.set(datei, info);
    return info;
  }

  return { verarbeite, hatCwebp, hatAvif };
}

/**
 * <img>-Tag, bei vorhandenen AVIF-Varianten in <picture> mit AVIF-Quelle verpackt.
 * `attribute` sind die übrigen Attribute des <img> in gewünschter Reihenfolge (bereits maskiert).
 */
function bildTag(info, sizes, attribute) {
  const img = `<img ${[
    `src="${info.src}"`,
    info.srcset && `srcset="${info.srcset}"`,
    info.srcset && `sizes="${sizes}"`,
    ...attribute,
  ].filter(Boolean).join(' ')}>`;
  if (!info.avifSrcset) return img;
  return `<picture><source type="image/avif" srcset="${info.avifSrcset}" sizes="${sizes}">${img}</picture>`;
}

/**
 * <link rel="preload"> für ein großes Startbild. Gibt es AVIF, wird nur die AVIF-Variante vorgeladen
 * (mit type, damit Browser ohne AVIF sie überspringen) – sonst lüde der Browser das Bild doppelt.
 */
function vorladen(info, sizes) {
  if (!info) return '';
  if (info.avifSrcset) {
    const href = info.src.replace(/\.webp$/, '.avif');
    return `<link rel="preload" as="image" type="image/avif" href="${href}" imagesrcset="${info.avifSrcset}" imagesizes="${sizes}" fetchpriority="high">`;
  }
  return `<link rel="preload" as="image" href="${info.src}"${info.srcset ? ` imagesrcset="${info.srcset}" imagesizes="${sizes}"` : ''} fetchpriority="high">`;
}

module.exports = { bildVerarbeitung, bildTag, vorladen, STANDARD_BREITEN };
