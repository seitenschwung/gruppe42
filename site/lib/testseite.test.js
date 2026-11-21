'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const SEITEN = ['antreiber-test', 'teamklima-check', 'fuehrungsstil-check', 'employer-branding-check', 'selbsttests'];

// Nur <main id="inhalt"> wird verglichen (CSS ist inline, Asset-Hashes ändern sich legitim).
function hauptteil(html) {
  const m = html.match(/<main id="inhalt"[^>]*>([\s\S]*?)<\/main>/);
  assert.ok(m, 'main#inhalt fehlt');
  return m[1].replace(/\?v=[0-9a-f]{8}/g, '?v=X');
}

test('ausgabe_unveraendert', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'testseite-'));
  try {
    const r = spawnSync(process.execPath, [
      path.join(REPO, 'site', 'vorlagen', 'beratung', 'build.js'),
      path.join(REPO, 'site', 'kunden', 'gruppe42', 'gruppe42.json'),
    ], {
      cwd: REPO, encoding: 'utf8',
      env: { ...process.env, DIST_DIR: path.join(tmp, 'dist'), CACHE_DIR: path.join(tmp, 'cache') },
    });
    assert.ifError(r.error);
    assert.strictEqual(r.status, 0, r.stderr);
    for (const s of SEITEN) {
      const ist = hauptteil(fs.readFileSync(path.join(tmp, 'dist', s + '.html'), 'utf8'));
      const soll = fs.readFileSync(path.join(__dirname, '__snapshots__', s + '.html'), 'utf8');
      assert.ok(ist === soll, `${s}.html weicht vom Snapshot ab`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('kopf_maskiert', () => {
  const T = require('./testseite.js');
  const k = T.kopf({ titel: '<x>', motto: '*a*' });
  assert.match(k, /&lt;x&gt;/);
  assert.match(k, /<em>a<\/em>/);
  assert.doesNotMatch(k, /<x>/);
});
