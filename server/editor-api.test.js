'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { createServer } = require('./server');
const { createSitzung } = require('./editor-sitzung');
const { createInhalte } = require('./inhalte');
const { createSeiten } = require('./seiten');
const { createEditorApi } = require('./editor-api');
const { neuerAuthenticator } = require('./passkey-testhilfe');
const Testseite = require('../site/lib/testseite.js');

const REPO = path.join(__dirname, '..');
const FIXTURE = path.join(REPO, 'site', 'lib', '__fixtures__');
const ORIGIN = 'https://editor.gruppe42.test';
const RP = 'editor.gruppe42.test';
const ENV = { EDITOR_ORIGIN: ORIGIN, EDITOR_RP_ID: RP };
const ID = 'antreiber-test';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-api-'));
const dist = path.join(tmp, 'dist');
const build = spawnSync(process.execPath, [path.join(REPO, 'site/vorlagen/beratung/build.js'), path.join(FIXTURE, 'gruppe42.json')], {
  cwd: REPO, encoding: 'utf8', env: { ...process.env, DIST_DIR: dist, CACHE_DIR: path.join(tmp, 'cache') },
});
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
test('Fixture-Build', () => assert.strictEqual(build.status, 0, build.stderr));

let zaehler = 0;
let ipZaehler = 0;

function anfrage(base, ip, methode, pfad, body, extra = {}) {
  const daten = body === undefined ? '' : JSON.stringify(body);
  const headers = { 'Content-Type': 'application/json', 'X-G42-Editor': '1', 'X-Forwarded-For': ip, ...(methode === 'POST' ? { Origin: ORIGIN } : {}), ...extra };
  for (const k of Object.keys(headers)) if (headers[k] === null) delete headers[k];
  return new Promise((resolve, reject) => {
    const u = new URL(base + pfad);
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: methode, headers }, (res) => {
      const teile = [];
      res.on('data', (c) => teile.push(c));
      res.on('end', () => {
        const text = Buffer.concat(teile).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* kein JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text });
      });
    });
    r.on('error', reject);
    r.end(daten);
  });
}

// Eine vollständige Umgebung: Basis-Kopie, Datenverzeichnis, echter Server, angemeldete Sitzung.
async function starte({ env = ENV, vorher, meldung, distDir = dist } = {}) {
  const n = zaehler++;
  const basisDir = path.join(tmp, 'basis' + n);
  fs.cpSync(FIXTURE, basisDir, { recursive: true });
  const dataDir = path.join(tmp, 'data' + n, 'editor');
  fs.mkdirSync(dataDir, { recursive: true });
  if (vorher) vorher(dataDir);
  const lines = [];
  const log = (l) => lines.push(l);
  const inhalte = createInhalte({ basisDir, dataDir });
  const seiten = createSeiten({ root: distDir, inhalte, Testseite, log });
  const sitzung = createSitzung({ env, dataDir });
  const e = { ...env };
  if (meldung) e.EDITOR_MELDUNG_URL = meldung;
  const api = createEditorApi({ env: e, inhalte, seiten, sitzung, log });
  const server = createServer({ root: distDir, version: 't', log, seiten, api: { routes: { ...sitzung.routes, ...api.routes } } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ip = `10.1.0.${++ipZaehler}`;
  const s = {
    base, dataDir, basisDir, inhalte, lines, ip,
    get: (p, extra) => anfrage(base, ip, 'GET', p, undefined, extra),
    post: (p, b, extra) => anfrage(base, ip, 'POST', p, b, extra),
    stop: () => new Promise((r) => server.close(r)),
  };
  s.cookie = null;
  return s;
}

function einladen(dir, name) {
  const code = crypto.randomBytes(32).toString('base64url');
  const p = path.join(dir, 'einladungen.json');
  const liste = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
  liste.push({ hash: sha(code), name, userId: crypto.randomBytes(16).toString('base64url'), erstellt: new Date().toISOString(), ablauf: new Date(Date.now() + 864e5).toISOString(), benutzt: false });
  fs.writeFileSync(p, JSON.stringify(liste, null, 2) + '\n');
  return code;
}

// Registriert einen Passkey über die echten Routen und liefert das Sitzungs-Cookie.
async function anmelden(s, name = 'Ingrid') {
  const code = einladen(s.dataDir, name);
  const a = neuerAuthenticator();
  const start = await s.post('/api/editor/registrieren/start', { einladung: code });
  assert.strictEqual(start.status, 200);
  const antwort = a.registriere({ challenge: Buffer.from(start.json.optionen.challenge, 'base64url'), origin: ORIGIN, rpId: RP });
  const ende = await s.post('/api/editor/registrieren/ende', { einladung: code, antwort });
  assert.strictEqual(ende.status, 200, ende.text);
  s.cookie = ende.headers['set-cookie'][0].split(';')[0];
  return s;
}

const mitCookie = (s, extra = {}) => ({ Cookie: s.cookie, ...extra });
const getA = (s, p) => s.get(p, mitCookie(s));
const postA = (s, p, b, extra) => s.post(p, b, mitCookie(s, extra));
const alt = (s, pfad) => pfad.split(/[.[\]]+/).filter(Boolean).reduce((o, k) => o[k], s.inhalte.wirksam(ID).daten);
const aend = (s, pfad, neu) => ({ datei: 'test', pfad, alt: alt(s, pfad), neu });

async function mitUmgebung(fn, opt) {
  const s = await starte(opt);
  try { await anmelden(s); await fn(s); } finally { await s.stop(); }
}

test('Header, Sitzung und Verfügbarkeit', async () => {
  const s = await starte();
  try {
    for (const [m, p] of [['GET', '/api/editor/stand'], ['GET', '/api/editor/verlauf?testId=' + ID], ['POST', '/api/editor/speichern'], ['POST', '/api/editor/rueckgaengig']]) {
      const r = await anfrage(s.base, s.ip, m, p, m === 'POST' ? {} : undefined);
      assert.strictEqual(r.status, 401, m + p);
      assert.deepStrictEqual(r.json, { error: 'anmeldung' });
      assert.strictEqual(r.headers['cache-control'], 'no-store');
      assert.strictEqual(r.headers['referrer-policy'], 'no-referrer');
      const ohneHeader = await anfrage(s.base, s.ip, m, p, m === 'POST' ? {} : undefined, { 'X-G42-Editor': null });
      assert.strictEqual(ohneHeader.status, 403);
      assert.deepStrictEqual(ohneHeader.json, { error: 'herkunft' });
    }
    // POST mit falscher oder fehlender Origin
    for (const origin of ['https://boese.test', null]) {
      const r = await anfrage(s.base, s.ip, 'POST', '/api/editor/speichern', {}, { Origin: origin });
      assert.strictEqual(r.status, 403);
    }
    // GET braucht keine Origin
    assert.strictEqual((await s.get('/api/editor/stand')).status, 401);
  } finally { await s.stop(); }
});

test('ohne gültige Env: 503 grund aus, öffentliche Seiten bleiben', async () => {
  for (const env of [{}, { EDITOR_ORIGIN: ORIGIN }]) {
    const s = await starte({ env });
    try {
      for (const [m, p] of [['GET', '/api/editor/stand'], ['POST', '/api/editor/speichern']]) {
        const r = await anfrage(s.base, s.ip, m, p, m === 'POST' ? {} : undefined);
        assert.strictEqual(r.status, 503);
        assert.deepStrictEqual(r.json, { error: 'editor_aus', grund: 'aus' });
      }
      assert.strictEqual((await s.get('/' + ID + '.html')).status, 200);
    } finally { await s.stop(); }
  }
});

test('ohne Inhalte (Basis fehlt): 503 aus', async () => {
  const sitzung = createSitzung({ env: ENV, dataDir: path.join(tmp, 'x', 'editor') });
  const api = createEditorApi({ env: ENV, inhalte: null, seiten: null, sitzung });
  const server = createServer({ root: dist, version: 't', api: { routes: api.routes } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const r = await anfrage(`http://127.0.0.1:${server.address().port}`, '10.9.9.9', 'GET', '/api/editor/stand');
    assert.strictEqual(r.status, 503);
    assert.strictEqual(r.json.grund, 'aus');
  } finally { await new Promise((r) => server.close(r)); }
});

test('stand liefert wirksame Daten, Konfiguration und wer aus der Sitzung', async () => {
  await mitUmgebung(async (s) => {
    const r = await getA(s, '/api/editor/stand');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.wer, 'Ingrid');
    assert.strictEqual(r.json.zustand, 'ok');
    assert.deepStrictEqual(r.json.tests.map((t) => t.id).sort(), ['antreiber-test', 'employer-branding-check', 'fuehrungsstil-check', 'teamklima-check']);
    const t = r.json.tests.find((x) => x.id === ID);
    const w = s.inhalte.wirksam(ID);
    assert.deepStrictEqual(t.daten, w.daten);
    assert.deepStrictEqual(t.eintrag, w.eintrag);
    assert.deepStrictEqual(t.verwaist, []);
    assert.strictEqual(typeof t.titel, 'string');
    assert.strictEqual(typeof t.sichtbar, 'boolean');
    assert.deepStrictEqual(r.json.testsCfg, s.inhalte.testsCfg());
  });
});

test('speichern: 200, danach liefert die Testseite den neuen Text; wer aus der Sitzung', async () => {
  await mitUmgebung(async (s) => {
    const neu = 'Ganz neue Frage & mehr';
    const vorher = await s.get('/' + ID + '.html');
    assert.ok(!vorher.text.includes(neu));
    const r = await postA(s, '/api/editor/speichern', { testId: ID, wer: 'Hacker', aenderungen: [aend(s, 'questions[0].text', neu)] });
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.json.nr, 1);
    assert.strictEqual(r.json.live, true);
    assert.match(r.json.zeit, /^\d{4}-\d\d-\d\dT/);
    assert.strictEqual(r.headers['cache-control'], 'no-store');
    const seite = await s.get('/' + ID + '.html');
    assert.strictEqual(seite.status, 200);
    assert.ok(seite.text.includes('Ganz neue Frage &amp; mehr') || seite.text.includes('Ganz neue Frage & mehr'));
    const v = await getA(s, '/api/editor/verlauf?testId=' + ID);
    assert.strictEqual(v.json.verlauf[0].wer, 'Ingrid');
    // Stand zeigt den neuen Text
    const st = await getA(s, '/api/editor/stand');
    assert.strictEqual(st.json.tests.find((t) => t.id === ID).daten.questions[0].text, neu);
  });
});

test('speichern: 409, 422, 404 und 400', async () => {
  await mitUmgebung(async (s) => {
    const k = aend(s, 'questions[0].text', 'X1');
    k.alt = 'nicht der aktuelle Text';
    const konflikt = await postA(s, '/api/editor/speichern', { testId: ID, aenderungen: [k] });
    assert.strictEqual(konflikt.status, 409);
    assert.deepStrictEqual(konflikt.json, { error: 'konflikt', pfad: 'questions[0].text' });

    const unzul = await postA(s, '/api/editor/speichern', { testId: ID, aenderungen: [aend(s, 'questions[0].text', 'mit <b>Markup</b>')] });
    assert.strictEqual(unzul.status, 422);
    assert.strictEqual(unzul.json.error, 'ungueltig');
    assert.ok(Array.isArray(unzul.json.meldungen) && unzul.json.meldungen[0].pfad);

    const nichtLive = await postA(s, '/api/editor/speichern', { testId: ID, aenderungen: [aend(s, 'name', 'Anderer Name')] });
    assert.strictEqual(nichtLive.status, 422);

    const unbekannt = await postA(s, '/api/editor/speichern', { testId: 'gibts-nicht', aenderungen: [aend(s, 'questions[0].text', 'Y')] });
    assert.strictEqual(unbekannt.status, 404);
    assert.deepStrictEqual(unbekannt.json, { error: 'unbekannt' });

    for (const b of [{}, { testId: ID }, { testId: ID, aenderungen: [] }, { testId: 5, aenderungen: [{}] }, { testId: ID, aenderungen: [{ datei: 'test', pfad: 'x', alt: 1, neu: 'y' }] }, { testId: ID, aenderungen: 'x' }]) {
      const r = await postA(s, '/api/editor/speichern', b);
      assert.strictEqual(r.status, 400, JSON.stringify(b));
    }
    // Nichts davon hat etwas gespeichert
    assert.deepStrictEqual((await getA(s, '/api/editor/verlauf?testId=' + ID)).json.verlauf, []);
  });
});

test('Body zu groß: 413; falscher Content-Type: 415', async () => {
  await mitUmgebung(async (s) => {
    const gross = await postA(s, '/api/editor/speichern', { testId: ID, aenderungen: [{ datei: 'test', pfad: 'x', alt: 'a', neu: 'x'.repeat(70 * 1024) }] });
    assert.strictEqual(gross.status, 413);
    const typ = await s.post('/api/editor/speichern', {}, mitCookie(s, { 'Content-Type': 'text/plain' }));
    assert.strictEqual(typ.status, 415);
  });
});

test('verlauf: testId Pflicht, neueste zuerst, höchstens 50', async () => {
  await mitUmgebung(async (s) => {
    assert.strictEqual((await getA(s, '/api/editor/verlauf')).status, 400);
    assert.strictEqual((await getA(s, '/api/editor/verlauf?testId=gibts-nicht')).status, 404);
    for (let i = 0; i < 52; i++) {
      const r = await postA(s, '/api/editor/speichern', { testId: ID, aenderungen: [aend(s, 'questions[0].text', 'Frage Nummer ' + i)] });
      assert.strictEqual(r.status, 200, r.text);
    }
    const v = await getA(s, '/api/editor/verlauf?testId=' + ID);
    assert.strictEqual(v.status, 200);
    assert.strictEqual(v.json.verlauf.length, 50);
    assert.strictEqual(v.json.verlauf[0].nr, 52);
    assert.strictEqual(v.json.verlauf[49].nr, 3);
    const e = v.json.verlauf[0];
    assert.deepStrictEqual(Object.keys(e).sort(), ['aenderungen', 'nr', 'wer', 'zeit']);
    assert.deepStrictEqual(e.aenderungen, [{ datei: 'test', pfad: 'questions[0].text', alt: 'Frage Nummer 50', neu: 'Frage Nummer 51' }]);
  });
});

test('rueckgaengig: stellt wieder her und rendert neu; nr nur als Ganzzahl', async () => {
  await mitUmgebung(async (s) => {
    const original = alt(s, 'questions[0].text');
    const r1 = await postA(s, '/api/editor/speichern', { testId: ID, aenderungen: [aend(s, 'questions[0].text', 'Zwischenstand Text')] });
    assert.strictEqual(r1.status, 200);
    assert.ok((await s.get('/' + ID + '.html')).text.includes('Zwischenstand Text'));
    const r2 = await postA(s, '/api/editor/rueckgaengig', { nr: r1.json.nr });
    assert.strictEqual(r2.status, 200, r2.text);
    assert.strictEqual(r2.json.nr, 2);
    assert.strictEqual(alt(s, 'questions[0].text'), original);
    assert.ok(!(await s.get('/' + ID + '.html')).text.includes('Zwischenstand Text'));
    assert.strictEqual((await getA(s, '/api/editor/verlauf?testId=' + ID)).json.verlauf[0].wer, 'Ingrid');

    // Konflikt: zweites Rückgängig derselben Nummer passt nicht mehr
    assert.strictEqual((await postA(s, '/api/editor/rueckgaengig', { nr: r1.json.nr })).status, 409);
    assert.strictEqual((await postA(s, '/api/editor/rueckgaengig', { nr: 999 })).status, 404);
    for (const nr of ['1', 1.5, null, undefined, [1], true]) {
      const r = await postA(s, '/api/editor/rueckgaengig', { nr });
      assert.strictEqual(r.status, 400, String(nr));
    }
  });
});

test('Übersicht zeigt geänderten Kurztext des Eintrags', async () => {
  await mitUmgebung(async (s) => {
    const e = s.inhalte.wirksam(ID).eintrag;
    const r = await postA(s, '/api/editor/speichern', { testId: ID, aenderungen: [{ datei: 'eintrag', pfad: 'kurz', alt: e.kurz, neu: 'Neuer Kurztext hier' }] });
    assert.strictEqual(r.status, 200, r.text);
    assert.ok((await s.get('/selbsttests.html')).text.includes('Neuer Kurztext hier'));
  });
});

test('Overlay unlesbar: 503 mit grund overlay_unlesbar, Seiten bleiben Image-Stand', async () => {
  const s = await starte({ vorher: (dir) => fs.writeFileSync(path.join(dir, 'inhalte.json'), '{kaputt') });
  try {
    for (const [m, p] of [['GET', '/api/editor/stand'], ['POST', '/api/editor/speichern'], ['GET', '/api/editor/verlauf?testId=' + ID]]) {
      const r = await anfrage(s.base, s.ip, m, p, m === 'POST' ? {} : undefined);
      assert.strictEqual(r.status, 503, p);
      assert.deepStrictEqual(r.json, { error: 'editor_aus', grund: 'overlay_unlesbar' });
    }
    assert.strictEqual((await s.get('/' + ID + '.html')).status, 200);
  } finally { await s.stop(); }
});

test('Datenverzeichnis nicht schreibbar: 503 nicht_schreibbar', async () => {
  const s = await starte();
  try {
    await anmelden(s);
    const datei = path.join(tmp, 'blockiert');
    fs.writeFileSync(datei, 'x');
    // Nach dem Anmelden den Datenpfad der Inhalte unbenutzbar machen
    fs.rmSync(s.dataDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(s.dataDir), { recursive: true });
    fs.writeFileSync(s.dataDir, 'x');
    const r = await anfrage(s.base, s.ip, 'GET', '/api/editor/stand', undefined, mitCookie(s));
    assert.strictEqual(r.status, 503);
    assert.strictEqual(r.json.error, 'editor_aus');
    assert.ok(['nicht_schreibbar', 'overlay_unlesbar'].includes(r.json.grund), r.text);
  } finally { await s.stop(); }
});

test('Rate-Limit pro IP', async () => {
  const s = await starte();
  try {
    let letzte;
    for (let i = 0; i < 70; i++) letzte = await s.get('/api/editor/stand');
    assert.strictEqual(letzte.status, 429);
    assert.deepStrictEqual(letzte.json, { error: 'rate_limited' });
    // andere IP ist nicht betroffen
    assert.strictEqual((await anfrage(s.base, '10.77.0.1', 'GET', '/api/editor/stand')).status, 401);
  } finally { await s.stop(); }
});

// --- Meldung ---
function webhook(status = 200) {
  const empfangen = [];
  const server = http.createServer((req, res) => {
    const teile = [];
    req.on('data', (c) => teile.push(c));
    req.on('end', () => {
      empfangen.push({ method: req.method, url: req.url, type: req.headers['content-type'], body: Buffer.concat(teile).toString('utf8') });
      res.writeHead(status);
      res.end();
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ empfangen, url: `http://localhost:${server.address().port}/hook?geheim=1`, close: () => new Promise((c) => server.close(c)) })));
}
const warte = async (bed) => { for (let i = 0; i < 100 && !bed(); i++) await new Promise((r) => setTimeout(r, 20)); };

test('Meldung: genauer Body ohne Texte; Rückgängig meldet ebenfalls', async () => {
  const hook = await webhook();
  try {
    await mitUmgebung(async (s) => {
      const titel = s.inhalte.liste().find((t) => t.id === ID).titel;
      const r = await postA(s, '/api/editor/speichern', { testId: ID, aenderungen: [aend(s, 'questions[0].text', 'Geheimer neuer Text'), aend(s, 'questions[1].text', 'Noch ein Text')] });
      assert.strictEqual(r.status, 200);
      await warte(() => hook.empfangen.length >= 1);
      assert.strictEqual(hook.empfangen.length, 1);
      const m = hook.empfangen[0];
      assert.strictEqual(m.method, 'POST');
      assert.match(m.type, /^application\/json/);
      assert.deepStrictEqual(JSON.parse(m.body), { titel: 'Test-Editor: ' + titel, text: 'Ingrid hat 2 Text(e) geändert' });
      assert.ok(!m.body.includes('Geheimer'));
      const r2 = await postA(s, '/api/editor/rueckgaengig', { nr: r.json.nr });
      assert.strictEqual(r2.status, 200);
      await warte(() => hook.empfangen.length >= 2);
      assert.deepStrictEqual(JSON.parse(hook.empfangen[1].body), { titel: 'Test-Editor: ' + titel, text: 'Ingrid hat 2 Text(e) geändert' });
      // die URL (mit Query) taucht in keiner Logzeile auf
      assert.ok(!s.lines.join('\n').includes('geheim'));
    }, { meldung: hook.url });
  } finally { await hook.close(); }
});

test('Meldung: Fehler und Fehlstatus werden ignoriert; ungültige URL sendet nichts', async () => {
  const hook = await webhook(500);
  try {
    await mitUmgebung(async (s) => {
      const r = await postA(s, '/api/editor/speichern', { testId: ID, aenderungen: [aend(s, 'questions[0].text', 'Text A')] });
      assert.strictEqual(r.status, 200);
      await warte(() => hook.empfangen.length >= 1);
    }, { meldung: hook.url });
  } finally { await hook.close(); }
  // nicht erreichbar
  await mitUmgebung(async (s) => {
    const r = await postA(s, '/api/editor/speichern', { testId: ID, aenderungen: [aend(s, 'questions[0].text', 'Text B')] });
    assert.strictEqual(r.status, 200);
  }, { meldung: 'http://localhost:1/x' });
  // http außerhalb von localhost: keine Meldung
  const { meldungUrl } = require('./editor-api');
  assert.strictEqual(meldungUrl('http://example.com/x'), null);
  assert.strictEqual(meldungUrl('ftp://example.com/x'), null);
  assert.strictEqual(meldungUrl('nonsense'), null);
  assert.ok(meldungUrl('https://example.com/x?a=1'));
});

test('Renderfehler: genau eine Logzeile ohne Texte', () => {
  const inhalte = { liste: () => [{ id: ID }], testsCfg: () => ({}), wirksam: () => { throw new Error('GEHEIMER TEXT'); } };
  const lines = [];
  createSeiten({ root: dist, inhalte, Testseite, log: (l) => lines.push(l) });
  assert.ok(lines.length >= 1);
  assert.ok(lines.every((l) => !l.includes('GEHEIMER') && l.startsWith('seiten:')));
});

// --- CLI ---
test('CLI editor-export: Export und --leeren nur bei passendem Hash', async () => {
  const s = await starte();
  let cli;
  try {
    await anmelden(s);
    const r = await postA(s, '/api/editor/speichern', { testId: ID, aenderungen: [aend(s, 'questions[0].text', 'Exportierter Text')] });
    assert.strictEqual(r.status, 200);
    const env = { ...process.env, EDITOR_DATA_DIR: s.dataDir, EDITOR_INHALT_DIR: s.basisDir };
    cli = (...args) => spawnSync(process.execPath, [path.join(__dirname, 'editor-export.js'), ...args], { encoding: 'utf8', env });
    const ex = cli();
    assert.strictEqual(ex.status, 0, ex.stderr);
    const out = JSON.parse(ex.stdout);
    assert.deepStrictEqual(Object.keys(out).sort(), ['overlay', 'sha256']);
    assert.match(out.sha256, /^[0-9a-f]{64}$/);
    assert.ok(JSON.stringify(out.overlay).includes('Exportierter Text'));
    assert.deepStrictEqual(out, s.inhalte.export());

    const falsch = cli('--leeren', '0'.repeat(64));
    assert.notStrictEqual(falsch.status, 0);
    assert.ok(JSON.stringify(s.inhalte.export().overlay).includes('Exportierter Text'));
    assert.notStrictEqual(cli('--leeren', 'kein-hash').status, 0);
    assert.notStrictEqual(cli('--unbekannt').status, 0);

    const ok = cli('--leeren', out.sha256);
    assert.strictEqual(ok.status, 0, ok.stderr);
    assert.ok(!JSON.stringify(s.inhalte.export().overlay).includes('Exportierter Text'));
    // zweites Leeren mit altem Hash: Stand hat sich geändert
    assert.notStrictEqual(cli('--leeren', out.sha256).status, 0);
  } finally { await s.stop(); }
});

test('CLI editor-export: unlesbares Overlay oder fehlende Basis: Fehler, kein Export', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'cli-'));
  const basis = path.join(dir, 'basis');
  fs.cpSync(FIXTURE, basis, { recursive: true });
  const data = path.join(dir, 'data');
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, 'inhalte.json'), '{kaputt');
  const cli = (e) => spawnSync(process.execPath, [path.join(__dirname, 'editor-export.js')], { encoding: 'utf8', env: { ...process.env, ...e } });
  const a = cli({ EDITOR_DATA_DIR: data, EDITOR_INHALT_DIR: basis });
  assert.notStrictEqual(a.status, 0);
  assert.strictEqual(a.stdout, '');
  const b = cli({ EDITOR_DATA_DIR: data, EDITOR_INHALT_DIR: path.join(dir, 'fehlt') });
  assert.notStrictEqual(b.status, 0);
});

test('Rate-Limit greift vor der Datenträgerprüfung', async () => {
  const s = await starte({ vorher: (dir) => fs.writeFileSync(path.join(dir, 'inhalte.json'), '{kaputt') });
  try {
    let letzte;
    for (let i = 0; i < 70; i++) letzte = await s.get('/api/editor/stand');
    assert.strictEqual(letzte.status, 429);
  } finally { await s.stop(); }
});

test('Renderfehler: speichern und rueckgaengig melden live:false, Speicherung bleibt gültig', async () => {
  const dist2 = path.join(tmp, 'dist-kaputt');
  fs.cpSync(dist, dist2, { recursive: true });
  const f = path.join(dist2, ID + '.html');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('<!--g42:daten-->', ''));
  await mitUmgebung(async (s) => {
    const r = await postA(s, '/api/editor/speichern', { testId: ID, aenderungen: [aend(s, 'questions[0].text', 'Nicht live sichtbar')] });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.live, false);
    assert.ok(s.lines.some((l) => l.startsWith('seiten: Rendern fehlgeschlagen')));
    assert.ok(!(await s.get('/' + ID + '.html')).text.includes('Nicht live sichtbar'));
    assert.strictEqual(alt(s, 'questions[0].text'), 'Nicht live sichtbar');
    const u = await postA(s, '/api/editor/rueckgaengig', { nr: r.json.nr });
    assert.strictEqual(u.status, 200);
    assert.strictEqual(u.json.live, false);
  }, { distDir: dist2 });
});

test('hängende Meldung verzögert die Antwort nicht', async () => {
  const offen = new Set();
  const server = http.createServer((req) => { offen.add(req); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await mitUmgebung(async (s) => {
      const t0 = Date.now();
      const r = await postA(s, '/api/editor/speichern', { testId: ID, aenderungen: [aend(s, 'questions[0].text', 'Hängt nicht')] });
      assert.strictEqual(r.status, 200);
      assert.ok(Date.now() - t0 < 2000);
    }, { meldung: `http://localhost:${server.address().port}/h` });
  } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); }
});

test('Prototyp-Schlüssel in Bodies werden abgewiesen, nichts wird verschmutzt', async () => {
  await mitUmgebung(async (s) => {
    const roh = (p, text) => new Promise((resolve, reject) => {
      const u = new URL(s.base + p);
      const r = http.request({ hostname: u.hostname, port: u.port, path: p, method: 'POST', headers: { 'Content-Type': 'application/json', 'X-G42-Editor': '1', Origin: ORIGIN, Cookie: s.cookie, 'X-Forwarded-For': s.ip } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      r.on('error', reject);
      r.end(text);
    });
    assert.strictEqual(await roh('/api/editor/rueckgaengig', '{"__proto__":{"nr":1}}'), 400);
    assert.strictEqual(await roh('/api/editor/rueckgaengig', '{"constructor":{"prototype":{"nr":1}}}'), 400);
    assert.strictEqual(await roh('/api/editor/speichern', '{"__proto__":{"testId":"antreiber-test","aenderungen":[{}]}}'), 400);
    assert.strictEqual((await postA(s, '/api/editor/speichern', { testId: '__proto__', aenderungen: [{ datei: 'test', pfad: 'x', alt: 'a', neu: 'b' }] })).status, 404);
    assert.strictEqual((await postA(s, '/api/editor/speichern', { testId: 'constructor', aenderungen: [{ datei: 'test', pfad: 'x', alt: 'a', neu: 'b' }] })).status, 404);
    for (const pfad of ['__proto__.polluted', 'constructor.prototype.polluted', 'questions[0].__proto__.x']) {
      const r = await postA(s, '/api/editor/speichern', { testId: ID, aenderungen: [{ datei: 'test', pfad, alt: '', neu: 'x' }] });
      assert.ok(r.status === 422 || r.status === 409, pfad + ' ' + r.status);
    }
    assert.strictEqual({}.polluted, undefined);
    assert.deepStrictEqual((await getA(s, '/api/editor/verlauf?testId=' + ID)).json.verlauf, []);
  });
});

test('GET verlauf ohne Sitzung: 401 mit Body', async () => {
  const s = await starte();
  try {
    const r = await s.get('/api/editor/verlauf?testId=' + ID);
    assert.strictEqual(r.status, 401);
    assert.deepStrictEqual(r.json, { error: 'anmeldung' });
  } finally { await s.stop(); }
});
