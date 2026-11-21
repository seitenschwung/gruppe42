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

test('editor_seite', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-'));
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
    const dist = path.join(tmp, 'dist');
    const editor = fs.readFileSync(path.join(dist, 'editor', 'index.html'), 'utf8');
    assert.match(editor, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(editor, /<base href="\/">/);
    assert.doesNotMatch(editor, /rel="canonical"|og:url/);
    assert.match(editor, /Für den Editor wird JavaScript benötigt\./);
    // Editor-Skripte nur auf der Editor-Seite, je mit ?v=-Hash, und als Dateien vorhanden
    for (const js of ['testwaechter', 'testseite', 'editor-kern', 'editor-github', 'editor-vorschau', 'editor']) {
      assert.match(editor, new RegExp(`<script src="js/${js}\\.js\\?v=[0-9a-f]{8}" defer></script>`), js);
      assert.ok(fs.existsSync(path.join(dist, 'js', js + '.js')), js + '.js fehlt');
    }
    assert.doesNotMatch(editor, /<script>/, 'kein Inline-Skript (CSP)');
    assert.doesNotMatch(fs.readFileSync(path.join(dist, 'antreiber-test.html'), 'utf8'), /editor\.js/);
    assert.match(fs.readFileSync(path.join(dist, 'robots.txt'), 'utf8'), /^Disallow: \/editor\/$/m);
    assert.doesNotMatch(fs.readFileSync(path.join(dist, 'sitemap.xml'), 'utf8'), /editor/);
    assert.doesNotMatch(fs.readFileSync(path.join(dist, 'index.html'), 'utf8'), /href="[^"]*editor\//);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
