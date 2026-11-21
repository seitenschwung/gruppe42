'use strict';
// CLI for editor access (run in the container):
//   node server/editor-einladung.js "<Name>"            creates a one-time invitation (7 days), prints the link
//   node server/editor-einladung.js --liste             lists invitations and passkeys (no secrets)
//   node server/editor-einladung.js --entfernen <id>    removes the passkey whose id starts with <id>
// Same env as the server: EDITOR_ORIGIN, EDITOR_RP_ID, EDITOR_DATA_DIR (default /data/editor).
const crypto = require('node:crypto');
const { konfiguration, datenSpeicher, sha256 } = require('./editor-sitzung');

const GUELTIG = 7 * 864e5;

function fehler(text) {
  process.stderr.write('Fehler: ' + text + '\n');
  process.exit(1);
}

function main(args, env) {
  const daten = datenSpeicher(env.EDITOR_DATA_DIR || '/data/editor');

  if (args[0] === '--liste') {
    if (args.length !== 1) fehler('--liste erwartet keine weiteren Argumente');
    const einladungen = daten.einladungen();
    const passkeys = daten.passkeys();
    const jetzt = Date.now();
    const zeilen = ['Einladungen:'];
    if (!einladungen.length) zeilen.push('  (keine)');
    for (const e of einladungen) {
      const stand = e.benutzt ? 'benutzt' : Date.parse(e.ablauf) > jetzt ? 'offen' : 'abgelaufen';
      zeilen.push(`  ${e.name}  bis ${e.ablauf}  ${stand}`);
    }
    zeilen.push('Passkeys:');
    if (!passkeys.length) zeilen.push('  (keine)');
    for (const p of passkeys) zeilen.push(`  ${String(p.id).slice(0, 8)}  ${p.name}  seit ${p.erstellt}`);
    process.stdout.write(zeilen.join('\n') + '\n');
    return;
  }

  if (args[0] === '--entfernen') {
    const praefix = args[1];
    if (args.length !== 2 || typeof praefix !== 'string' || !praefix) fehler('--entfernen <Passkey-ID-Anfang>');
    const weg = daten.sperre(() => {
      const passkeys = daten.passkeys();
      const treffer = passkeys.filter((p) => typeof p.id === 'string' && p.id.startsWith(praefix));
      // No fehler() (process.exit) inside the lock: finally must release it.
      if (treffer.length === 0) return { meldung: 'kein Passkey mit diesem ID-Anfang' };
      if (treffer.length > 1) return { meldung: 'ID-Anfang mehrdeutig (' + treffer.length + ' Passkeys), bitte länger angeben' };
      daten.schreibePasskeys(passkeys.filter((p) => p !== treffer[0]));
      return treffer[0];
    });
    if (weg.meldung) fehler(weg.meldung);
    process.stdout.write(`Passkey ${weg.id.slice(0, 8)} (${weg.name}) entfernt.\n`);
    return;
  }

  if (args.length !== 1 || args[0].startsWith('--')) fehler('Aufruf: editor-einladung.js "<Name>" | --liste | --entfernen <ID-Anfang>');
  const name = args[0].trim();
  if (!name || name.length > 64 || /[\u0000-\u001f\u007f]/.test(name)) fehler('Name: 1 bis 64 Zeichen, keine Steuerzeichen');
  const cfg = konfiguration(env);
  if (!cfg) fehler('EDITOR_ORIGIN und EDITOR_RP_ID fehlen oder sind ungültig');
  const code = crypto.randomBytes(32).toString('base64url');
  daten.sperre(() => {
    const einladungen = daten.einladungen();
    einladungen.push({
      hash: sha256(code), name, userId: crypto.randomBytes(16).toString('base64url'),
      erstellt: new Date().toISOString(), ablauf: new Date(Date.now() + GUELTIG).toISOString(), benutzt: false,
    });
    daten.schreibeEinladungen(einladungen);
  });
  process.stdout.write(`${cfg.origin}/editor/#einladung=${code}\n`);
}

try {
  main(process.argv.slice(2), process.env);
} catch (e) {
  if (e.art === 'gesperrt') fehler('Datenverzeichnis gesperrt (Server schreibt gerade?), bitte erneut versuchen');
  fehler(e.code ? `${e.code} (Datenverzeichnis)` : 'Datei unlesbar oder ungültig');
}
