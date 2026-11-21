'use strict';
// CLI (im Container):
//   node server/editor-export.js                    gibt {overlay, sha256} als JSON aus
//   node server/editor-export.js --leeren <sha256>  leert das Overlay nur, wenn der Stand noch zu diesem Hash passt
// Gleiche Env wie der Server: EDITOR_DATA_DIR (Standard /data/editor), EDITOR_INHALT_DIR (Standard /app/inhalte).
const { createInhalte } = require('./inhalte');
const { pfadeAusEnv } = require('./editor-api');

function fehler(text) {
  process.stderr.write('Fehler: ' + text + '\n');
  process.exit(1);
}

function main(args, env) {
  let inhalte;
  try { inhalte = createInhalte(pfadeAusEnv(env)); } catch (e) { fehler('Inhalte nicht lesbar'); }
  if (args.length === 0) {
    if (inhalte.zustand() === 'overlay_unlesbar') fehler('Overlay nicht lesbar');
    process.stdout.write(JSON.stringify(inhalte.export(), null, 2) + '\n');
    return;
  }
  if (args[0] === '--leeren' && args.length === 2 && /^[0-9a-f]{64}$/.test(args[1])) {
    let ok;
    try { ok = inhalte.leeren(args[1]); } catch (e) { fehler(e.gesperrt ? 'Datenverzeichnis gesperrt, bitte erneut versuchen' : 'Speicher nicht verfügbar'); }
    if (!ok) fehler('Der Stand hat sich geändert (oder ist nicht lesbar); nichts geleert. Bitte neu exportieren.');
    process.stdout.write('Overlay geleert.\n');
    return;
  }
  fehler('Aufruf: editor-export.js [--leeren <sha256>]');
}

main(process.argv.slice(2), process.env);
