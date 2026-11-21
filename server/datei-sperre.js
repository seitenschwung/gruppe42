'use strict';
// Cross-process lock for read-modify-write in a data dir (server and CLIs): <dir>/.sperre created with
// O_EXCL. Waits up to WARTEN ms (sleeping, no CPU spin); a lock older than ALT ms counts as stale and is
// taken over. Synchronous on purpose: callers keep their critical sections free of await.
const fs = require('node:fs');
const path = require('node:path');

const WARTEN = 2000;
const ALT = 30_000;
const SCHRITT = 25;
const schlafZelle = new Int32Array(new SharedArrayBuffer(4));
const schlafe = (ms) => Atomics.wait(schlafZelle, 0, 0, ms);

function gesperrt() {
  const e = new Error('Datenverzeichnis gesperrt');
  e.art = 'gesperrt';
  return e;
}

function mitSperre(dir, fn, { warten = WARTEN, alt = ALT } = {}) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const pfad = path.join(dir, '.sperre');
  const ende = Date.now() + warten;
  let fd;
  for (;;) {
    try {
      fd = fs.openSync(pfad, 'wx', 0o600);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    try {
      if (Date.now() - fs.statSync(pfad).mtimeMs > alt) { fs.unlinkSync(pfad); continue; }
    } catch (e) {
      if (e.code === 'ENOENT') continue; // released meanwhile
      throw e;
    }
    if (Date.now() >= ende) throw gesperrt();
    schlafe(SCHRITT);
  }
  try {
    fs.writeSync(fd, String(process.pid));
    return fn();
  } finally {
    try { fs.closeSync(fd); } catch { /* schon zu */ }
    try { fs.unlinkSync(pfad); } catch { /* weg */ }
  }
}

module.exports = { mitSperre };
