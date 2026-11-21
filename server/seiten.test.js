'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { createInhalte } = require('./inhalte.js');
const { createSeiten } = require('./seiten.js');
const { createServer } = require('./server.js');
const Testseite = require('../site/lib/testseite.js');

const REPO = path.join(__dirname, '..');
const FIXTURE = path.join(REPO, 'site', 'lib', '__fixtures__');
const ID = 'antreiber-test';
const MARKER = ['kopf', 'test', 'daten'];

// Ein Build pro Testlauf (Fixture hat keine Bilder).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seiten-'));
const dist = path.join(tmp, 'dist');
const r = spawnSync(process.execPath, [path.join(REPO, 'site/vorlagen/beratung/build.js'), path.join(FIXTURE, 'gruppe42.json')], {
  cwd: REPO, encoding: 'utf8', env: { ...process.env, DIST_DIR: dist, CACHE_DIR: path.join(tmp, 'cache') },
});
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const datei = (n) => fs.readFileSync(path.join(dist, n), 'utf8');

let zaehler = 0;
function umgebung() {
  const basisDir = path.join(tmp, 'basis' + zaehler);
  fs.cpSync(FIXTURE, basisDir, { recursive: true });
  const dataDir = path.join(tmp, 'data' + zaehler++, 'editor');
  const inhalte = createInhalte({ basisDir, dataDir });
  const seiten = createSeiten({ root: dist, inhalte, Testseite });
  return { inhalte, seiten };
}
const alt = (inh, pfad) => pfad.split(/[.[\]]+/).filter(Boolean).reduce((o, k) => o[k], inh.wirksam(ID).daten);
const aend = (inh, pfad, neu) => ({ datei: 'test', pfad, alt: alt(inh, pfad), neu });

test('Build enthält alle Marker je Testseite und Übersicht', () => {
  assert.equal(r.status, 0, r.stderr);
  for (const s of ['antreiber-test', 'teamklima-check', 'fuehrungsstil-check', 'employer-branding-check']) {
    const h = datei(s + '.html');
    for (const m of MARKER) {
      assert.equal(h.split(`<!--g42:${m}-->`).length, 2, s + ' ' + m);
      assert.equal(h.split(`<!--/g42:${m}-->`).length, 2, s + ' /' + m);
    }
  }
  const hub = datei('selbsttests.html');
  assert.ok(hub.includes('<!--g42:kacheln-->') && hub.includes('<!--/g42:kacheln-->'));
});

test('ohne Overlay: keine Live-Seiten (normales Ausliefern)', () => {
  const { seiten } = umgebung();
  assert.equal(seiten.seite('/' + ID + '.html'), null);
  assert.equal(seiten.seite('/selbsttests.html'), null);
  assert.equal(seiten.seite('/index.html'), null);
});

test('nach speichere: Frage, Ergebnis, Kachel und Kopf live, Zeichen escaped', () => {
  const { inhalte, seiten } = umgebung();
  const q = 'Neue "Frage" & mehr';
  inhalte.speichere(ID, [
    aend(inhalte, 'questions[0].text', q),
    aend(inhalte, 'result.intro', 'Neues Ergebnis & so'),
    { datei: 'eintrag', pfad: 'kurz', alt: inhalte.wirksam(ID).eintrag.kurz, neu: 'Kurz & "neu"' },
    { datei: 'eintrag', pfad: 'motto', alt: inhalte.wirksam(ID).eintrag.motto, neu: 'Anderes *Motto*' },
  ], 'Ingrid');
  seiten.aktualisiere(ID);
  const s = seiten.seite('/' + ID + '.html');
  assert.ok(s && /^"[0-9a-f]+"$/.test(s.etag));
  // Daten-Skript: JSON, "<" wird zu <; Anführungszeichen JSON-escaped
  const m = s.html.match(/<script type="application\/json" id="antreiber-daten">([\s\S]*?)<\/script>/);
  const daten = JSON.parse(m[1]);
  assert.equal(daten.questions[0].text, q);
  assert.equal(daten.result.intro, 'Neues Ergebnis & so');
  assert.match(s.html, /Anderes <em>Motto<\/em>/);
  // Kopf und Struktur außerhalb der Bereiche unverändert
  const orig = datei(ID + '.html');
  assert.equal(s.html.split('<!--g42:kopf-->')[0], orig.split('<!--g42:kopf-->')[0]);
  assert.equal(s.html.split('<!--/g42:daten-->')[1], orig.split('<!--/g42:daten-->')[1]);
  const hub = seiten.seite('/selbsttests.html');
  assert.ok(hub.html.includes('Kurz &amp; &quot;neu&quot;'));
  assert.ok(!hub.html.includes('Kurz & "neu"'));
  assert.notEqual(hub.etag, s.etag);
});

test('nur die geänderte Testseite wird live gehalten', () => {
  const { inhalte, seiten } = umgebung();
  inhalte.speichere(ID, [aend(inhalte, 'questions[1].text', 'Zweite Frage')], 'x');
  seiten.aktualisiere(ID);
  assert.equal(seiten.seite('/teamklima-check.html'), null);
  assert.ok(seiten.seite('/' + ID + '.html').html.includes('Zweite Frage'));
});

test('Rücksetzen auf Basis: Seite wird wieder byte-gleich (null)', () => {
  const { inhalte, seiten } = umgebung();
  const basis = alt(inhalte, 'questions[0].text');
  inhalte.speichere(ID, [aend(inhalte, 'questions[0].text', 'X')], 'x');
  seiten.aktualisiere(ID);
  assert.ok(seiten.seite('/' + ID + '.html'));
  inhalte.speichere(ID, [aend(inhalte, 'questions[0].text', basis)], 'x');
  seiten.aktualisiere(ID);
  assert.equal(seiten.seite('/' + ID + '.html'), null);
});

test('fehlender Marker: Originalseite (null)', () => {
  const wurzel = path.join(tmp, 'ohne');
  fs.cpSync(dist, wurzel, { recursive: true });
  const p = path.join(wurzel, ID + '.html');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('<!--/g42:test-->', ''));
  const basisDir = path.join(tmp, 'basis-m');
  fs.cpSync(FIXTURE, basisDir, { recursive: true });
  const inhalte = createInhalte({ basisDir, dataDir: path.join(tmp, 'data-m', 'editor') });
  inhalte.speichere(ID, [aend(inhalte, 'questions[0].text', 'Neu')], 'x');
  const seiten = createSeiten({ root: wurzel, inhalte, Testseite });
  assert.equal(seiten.seite('/' + ID + '.html'), null);
});

test('Server: Live-Seite mit neuem ETag, 304, HEAD, Header; ohne seiten unverändert', async () => {
  const { inhalte, seiten } = umgebung();
  const roh = createServer({ root: dist, version: 'v' });
  const srv = createServer({ root: dist, version: 'v', seiten });
  await Promise.all([roh, srv].map((x) => new Promise((ok) => x.listen(0, '127.0.0.1', ok))));
  const hole = (s, p, o = {}) => new Promise((ok, no) => {
    http.request({ port: s.address().port, host: '127.0.0.1', path: p, method: o.method || 'GET', headers: o.headers }, (res) => {
      const b = []; res.on('data', (c) => b.push(c)); res.on('end', () => ok({ res, body: Buffer.concat(b).toString('utf8') }));
    }).on('error', no).end();
  });
  try {
    // ohne Overlay: identisch zur Datei
    const a = await hole(srv, '/' + ID + '.html');
    assert.equal(a.body, datei(ID + '.html'));
    inhalte.speichere(ID, [aend(inhalte, 'questions[0].text', 'Live & neu')], 'x');
    seiten.aktualisiere(ID);
    const b = await hole(srv, '/' + ID + '.html');
    assert.equal(b.res.statusCode, 200);
    assert.ok(b.body.includes('Live & neu'));
    assert.match(b.res.headers['content-type'], /^text\/html; charset=utf-8$/);
    assert.equal(b.res.headers['x-content-type-options'], 'nosniff');
    assert.equal(b.res.headers['content-length'], String(Buffer.byteLength(b.body)));
    assert.ok(b.res.headers.etag && b.res.headers.etag !== a.res.headers.etag);
    const c = await hole(srv, '/' + ID + '.html', { headers: { 'If-None-Match': b.res.headers.etag } });
    assert.equal(c.res.statusCode, 304);
    const h = await hole(srv, '/' + ID + '.html', { method: 'HEAD' });
    assert.equal(h.res.statusCode, 200);
    assert.equal(h.body, '');
    // Server ohne seiten liefert weiter die Datei
    const d = await hole(roh, '/' + ID + '.html');
    assert.equal(d.body, datei(ID + '.html'));
  } finally { roh.close(); srv.close(); }
});
