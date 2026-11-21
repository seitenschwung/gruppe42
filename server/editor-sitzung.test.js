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
const { neuerAuthenticator } = require('./passkey-testhilfe');

const ORIGIN = 'https://editor.gruppe42.test';
const RP = 'editor.gruppe42.test';
const ENV = { EDITOR_ORIGIN: ORIGIN, EDITOR_RP_ID: RP };
const COOKIE_RE = /^g42_sitzung=([A-Za-z0-9_-]{43}); Path=\/api\/editor; HttpOnly; Secure; SameSite=Strict$/;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sitzung-'));
const root = tmp();

// Writes an invitation directly (as the CLI does) and returns the code.
function einladen(dir, name, { ablauf = Date.now() + 7 * 864e5, benutzt = false } = {}) {
  const code = crypto.randomBytes(32).toString('base64url');
  const p = path.join(dir, 'einladungen.json');
  const liste = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
  liste.push({ hash: sha(code), name, userId: crypto.randomBytes(16).toString('base64url'), erstellt: new Date().toISOString(), ablauf: new Date(ablauf).toISOString(), benutzt });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(liste, null, 2) + '\n');
  return code;
}

let ipZaehler = 0;
// One test "client": its own IP (X-Forwarded-For) so the rate limit of one test does not hit others.
function klient(base) {
  const ip = `10.0.0.${++ipZaehler}`;
  return function post(pfad, body, extra = {}) {
    const daten = body === undefined ? '' : JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json', 'X-G42-Editor': '1', Origin: ORIGIN, 'X-Forwarded-For': ip, ...extra };
    for (const k of Object.keys(headers)) if (headers[k] === null) delete headers[k];
    return new Promise((resolve, reject) => {
      const u = new URL(base + pfad);
      const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: extra.method || 'POST', headers }, (res) => {
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
  };
}

async function starte({ env = ENV, dataDir = tmp(), jetzt } = {}) {
  const lines = [];
  const sitzung = createSitzung({ env, dataDir, jetzt });
  const server = createServer({ root, version: 't', log: (l) => lines.push(l), api: { routes: sitzung.routes } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { sitzung, server, base, dataDir, lines, post: klient(base), stop: () => new Promise((r) => server.close(r)) };
}

const cookieAus = (res) => {
  const sc = res.headers['set-cookie'];
  assert.ok(sc && sc.length === 1, 'genau ein Set-Cookie');
  const m = COOKIE_RE.exec(sc[0]);
  assert.ok(m, 'Cookie exakt: ' + sc[0]);
  return m[1];
};
const req = (wert) => ({ headers: { cookie: wert === undefined ? undefined : `andere=1; g42_sitzung=${wert}` } });
const ch = (res) => Buffer.from(res.json.optionen.challenge, 'base64url');

async function registriere(s, name = 'Ingrid') {
  const code = einladen(s.dataDir, name);
  const a = neuerAuthenticator();
  const start = await s.post('/api/editor/registrieren/start', { einladung: code });
  assert.strictEqual(start.status, 200);
  const antwort = a.registriere({ challenge: ch(start), origin: ORIGIN, rpId: RP });
  const ende = await s.post('/api/editor/registrieren/ende', { einladung: code, antwort });
  assert.strictEqual(ende.status, 200, ende.text);
  return { a, code, ende, cookie: cookieAus(ende), antwort };
}

async function melde(s, a, o = {}) {
  const start = await s.post('/api/editor/anmelden/start', {});
  assert.strictEqual(start.status, 200);
  const antwort = a.melde({ challenge: ch(start), origin: ORIGIN, rpId: RP, ...o });
  return { antwort, res: await s.post('/api/editor/anmelden/ende', { antwort }) };
}

const ROUTEN = ['/api/editor/registrieren/start', '/api/editor/registrieren/ende', '/api/editor/anmelden/start', '/api/editor/anmelden/ende', '/api/editor/abmelden'];

test('ohne Env, mit ungültiger Env oder ohne schreibbares Datenverzeichnis: 503 auf allen Routen', async () => {
  const datei = path.join(tmp(), 'datei');
  fs.writeFileSync(datei, 'x');
  const faelle = [
    { env: {} },
    { env: { EDITOR_ORIGIN: ORIGIN } },
    { env: { EDITOR_RP_ID: RP } },
    { env: { EDITOR_ORIGIN: ORIGIN + '/pfad', EDITOR_RP_ID: RP } },
    { env: { EDITOR_ORIGIN: 'ftp://editor.gruppe42.test', EDITOR_RP_ID: RP } },
    { env: { EDITOR_ORIGIN: 'http://editor.gruppe42.test', EDITOR_RP_ID: RP } },
    { env: { EDITOR_ORIGIN: ORIGIN, EDITOR_RP_ID: 'anders.test' } },
    { env: { EDITOR_ORIGIN: ORIGIN, EDITOR_RP_ID: 'test' } },
    { env: { EDITOR_ORIGIN: ORIGIN, EDITOR_RP_ID: 'tor.gruppe42.test' } },
    { env: ENV, dataDir: path.join(datei, 'unter') },
  ];
  for (const f of faelle) {
    const s = await starte(f);
    for (const r of ROUTEN) {
      const res = await s.post(r, {});
      assert.strictEqual(res.status, 503, `${JSON.stringify(f.env)} ${r}`);
      assert.deepStrictEqual(res.json, { error: 'editor_aus' });
      assert.strictEqual(res.headers['cache-control'], 'no-store');
    }
    assert.strictEqual(s.sitzung.pruefe(req('x'.repeat(43))), null);
    await s.stop();
  }
});

test('gültige Env-Varianten: Registrierungs-Suffix und localhost', async () => {
  for (const env of [{ EDITOR_ORIGIN: ORIGIN, EDITOR_RP_ID: 'gruppe42.test' }, { EDITOR_ORIGIN: 'http://localhost:8080', EDITOR_RP_ID: 'localhost' }]) {
    const s = await starte({ env });
    const res = await s.post('/api/editor/anmelden/start', {}, { Origin: env.EDITOR_ORIGIN });
    assert.strictEqual(res.status, 200, JSON.stringify(env));
    assert.strictEqual(res.json.optionen.rpId, env.EDITOR_RP_ID);
    await s.stop();
  }
});

test('Header oder Origin fehlen/falsch: 403 herkunft; Antwort-Header', async () => {
  const s = await starte();
  for (const r of ROUTEN) {
    for (const extra of [{ 'X-G42-Editor': null }, { 'X-G42-Editor': '0' }, { Origin: null }, { Origin: 'https://boese.test' }, { Origin: ORIGIN + '/' }]) {
      const res = await s.post(r, {}, extra);
      assert.strictEqual(res.status, 403, `${r} ${JSON.stringify(extra)}`);
      assert.deepStrictEqual(res.json, { error: 'herkunft' });
      assert.strictEqual(res.headers['cache-control'], 'no-store');
      assert.strictEqual(res.headers['referrer-policy'], 'no-referrer');
      assert.strictEqual(res.headers['set-cookie'], undefined);
    }
  }
  const get = await s.post('/api/editor/anmelden/start', undefined, { method: 'GET' });
  assert.strictEqual(get.status, 405);
  await s.stop();
});

test('Registrierung mit gültiger Einladung: Optionen, Cookie exakt, Passkey gespeichert, Einladung verbraucht', async () => {
  const s = await starte();
  const code = einladen(s.dataDir, 'Ingrid Nirnberger');
  const a = neuerAuthenticator();
  const start = await s.post('/api/editor/registrieren/start', { einladung: code });
  assert.strictEqual(start.status, 200);
  assert.strictEqual(start.headers['cache-control'], 'no-store');
  assert.strictEqual(start.headers['referrer-policy'], 'no-referrer');
  const o = start.json.optionen;
  assert.strictEqual(o.rp.id, RP);
  assert.strictEqual(o.user.name, 'Ingrid Nirnberger');
  assert.strictEqual(o.user.displayName, 'Ingrid Nirnberger');
  assert.strictEqual(Buffer.from(o.user.id, 'base64url').length, 16);
  assert.strictEqual(Buffer.from(o.challenge, 'base64url').length, 32);
  assert.deepStrictEqual(o.excludeCredentials, []);
  assert.strictEqual(o.authenticatorSelection.residentKey, 'required');

  const antwort = a.registriere({ challenge: ch(start), origin: ORIGIN, rpId: RP });
  const ende = await s.post('/api/editor/registrieren/ende', { einladung: code, antwort });
  assert.strictEqual(ende.status, 200);
  assert.deepStrictEqual(ende.json, { wer: 'Ingrid Nirnberger' });
  const cookie = cookieAus(ende);
  assert.deepStrictEqual(s.sitzung.pruefe(req(cookie)), { wer: 'Ingrid Nirnberger' });

  const pks = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'passkeys.json'), 'utf8'));
  assert.strictEqual(pks.length, 1);
  assert.deepStrictEqual(Object.keys(pks[0]).sort(), ['alg', 'erstellt', 'id', 'jwk', 'name', 'signCount', 'userId'].sort());
  assert.strictEqual(pks[0].id, a.id);
  assert.strictEqual(pks[0].name, 'Ingrid Nirnberger');
  assert.strictEqual(pks[0].userId, o.user.id);
  assert.strictEqual(pks[0].signCount, 0);
  const inv = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'einladungen.json'), 'utf8'));
  assert.strictEqual(inv[0].benutzt, true);
  assert.ok(!JSON.stringify(inv).includes(code), 'Code nie im Klartext gespeichert');
  assert.ok(fs.readFileSync(path.join(s.dataDir, 'passkeys.json'), 'utf8').endsWith('}\n]\n'));
  assert.deepStrictEqual(fs.readdirSync(s.dataDir).sort(), ['einladungen.json', 'passkeys.json'], 'keine Temp-Dateien übrig');

  // Einladung verbraucht: weder start noch ende funktionieren erneut.
  const nochmal = await s.post('/api/editor/registrieren/start', { einladung: code });
  assert.strictEqual(nochmal.status, 400);
  assert.deepStrictEqual(nochmal.json, { error: 'einladung' });
  const b = neuerAuthenticator();
  const ende2 = await s.post('/api/editor/registrieren/ende', { einladung: code, antwort: b.registriere({ challenge: ch(start), origin: ORIGIN, rpId: RP }) });
  assert.strictEqual(ende2.status, 400);
  assert.deepStrictEqual(ende2.json, { error: 'einladung' });

  // Zweite Einladung: excludeCredentials enthält den vorhandenen Passkey.
  const code2 = einladen(s.dataDir, 'Zweite');
  const start2 = await s.post('/api/editor/registrieren/start', { einladung: code2 });
  assert.deepStrictEqual(start2.json.optionen.excludeCredentials, [{ type: 'public-key', id: a.id }]);
  await s.stop();
});

test('Einladung: unbekannt, abgelaufen, benutzt, falscher Typ -> 400 ohne Details', async () => {
  const s = await starte();
  const abgelaufen = einladen(s.dataDir, 'Alt', { ablauf: Date.now() - 1000 });
  const benutzt = einladen(s.dataDir, 'Weg', { benutzt: true });
  const a = neuerAuthenticator();
  const antwort = a.registriere({ challenge: crypto.randomBytes(32), origin: ORIGIN, rpId: RP });
  for (const einladung of [abgelaufen, benutzt, crypto.randomBytes(32).toString('base64url'), '', 42, undefined, 'x'.repeat(5000)]) {
    for (const r of ['/api/editor/registrieren/start', '/api/editor/registrieren/ende']) {
      const res = await s.post(r, { einladung, antwort });
      assert.ok(res.status === 400 || res.status === 413, `${r} ${String(einladung).slice(0, 10)}`);
      if (res.status === 400) assert.deepStrictEqual(res.json, { error: 'einladung' });
      assert.strictEqual(res.headers['set-cookie'], undefined);
    }
  }
  assert.ok(!fs.existsSync(path.join(s.dataDir, 'passkeys.json')));
  await s.stop();
});

test('Registrierung: Challenge fremder Einladung, aus anmelden/start oder doppelt -> abgelehnt', async () => {
  const s = await starte();
  const code = einladen(s.dataDir, 'A');
  const andere = einladen(s.dataDir, 'B');
  const a = neuerAuthenticator();
  // Challenge aus anmelden/start
  const anm = await s.post('/api/editor/anmelden/start', {});
  let res = await s.post('/api/editor/registrieren/ende', { einladung: code, antwort: a.registriere({ challenge: ch(anm), origin: ORIGIN, rpId: RP }) });
  assert.strictEqual(res.status, 400);
  assert.deepStrictEqual(res.json, { error: 'registrierung' });
  // Challenge für Einladung B, eingelöst mit Einladung A
  const startB = await s.post('/api/editor/registrieren/start', { einladung: andere });
  res = await s.post('/api/editor/registrieren/ende', { einladung: code, antwort: a.registriere({ challenge: ch(startB), origin: ORIGIN, rpId: RP }) });
  assert.strictEqual(res.status, 400);
  // ... und die Challenge ist danach verbraucht, auch für B.
  res = await s.post('/api/editor/registrieren/ende', { einladung: andere, antwort: a.registriere({ challenge: ch(startB), origin: ORIGIN, rpId: RP }) });
  assert.strictEqual(res.status, 400);
  assert.deepStrictEqual(res.json, { error: 'registrierung' });
  // Falscher Origin in clientData -> abgelehnt, Challenge verbraucht
  const start = await s.post('/api/editor/registrieren/start', { einladung: code });
  res = await s.post('/api/editor/registrieren/ende', { einladung: code, antwort: a.registriere({ challenge: ch(start), origin: 'https://boese.test', rpId: RP }) });
  assert.strictEqual(res.status, 400);
  res = await s.post('/api/editor/registrieren/ende', { einladung: code, antwort: a.registriere({ challenge: ch(start), origin: ORIGIN, rpId: RP }) });
  assert.strictEqual(res.status, 400);
  assert.deepStrictEqual(res.json, { error: 'registrierung' });
  // Einladung A ist noch gültig (nichts verbraucht)
  const inv = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'einladungen.json'), 'utf8'));
  assert.ok(inv.every((e) => e.benutzt === false));
  await s.stop();
});

test('Anmeldung: Cookie, signCount gespeichert und steigend, Challenge einmalig, unbekannter Passkey', async () => {
  const s = await starte();
  const { a } = await registriere(s, 'Ingrid');
  const r1 = await melde(s, a);
  assert.strictEqual(r1.res.status, 200);
  assert.deepStrictEqual(r1.res.json, { wer: 'Ingrid' });
  const c1 = cookieAus(r1.res);
  assert.deepStrictEqual(s.sitzung.pruefe(req(c1)), { wer: 'Ingrid' });
  const pk = () => JSON.parse(fs.readFileSync(path.join(s.dataDir, 'passkeys.json'), 'utf8'))[0];
  assert.strictEqual(pk().signCount, 1);

  // Dieselbe Antwort noch einmal (Challenge verbraucht) -> 401
  const replay = await s.post('/api/editor/anmelden/ende', { antwort: r1.antwort });
  assert.strictEqual(replay.status, 401);
  assert.deepStrictEqual(replay.json, { error: 'anmeldung' });
  assert.strictEqual(replay.headers['set-cookie'], undefined);

  const r2 = await melde(s, a);
  assert.strictEqual(r2.res.status, 200);
  assert.strictEqual(pk().signCount, 2);
  assert.notStrictEqual(cookieAus(r2.res), c1);
  // signCount nicht gestiegen -> 401
  const r3 = await melde(s, a, { signCount: 2 });
  assert.strictEqual(r3.res.status, 401);
  assert.strictEqual(pk().signCount, 2);

  // Unbekannter Passkey
  const fremd = neuerAuthenticator();
  const r4 = await melde(s, fremd);
  assert.strictEqual(r4.res.status, 401);
  assert.deepStrictEqual(r4.res.json, { error: 'anmeldung' });
  // Falscher Origin in clientData
  const r5 = await melde(s, a, { origin: 'https://boese.test' });
  assert.strictEqual(r5.res.status, 401);
  // Registrierungs-Challenge für die Anmeldung
  const code = einladen(s.dataDir, 'X');
  const reg = await s.post('/api/editor/registrieren/start', { einladung: code });
  const r6 = await s.post('/api/editor/anmelden/ende', { antwort: a.melde({ challenge: ch(reg), origin: ORIGIN, rpId: RP }) });
  assert.strictEqual(r6.status, 401);
  // Kaputte Antworten
  for (const antwort of [undefined, null, 'x', {}, { id: a.id }, { id: a.id, response: { clientDataJSON: '!!' } }]) {
    const r = await s.post('/api/editor/anmelden/ende', { antwort });
    assert.strictEqual(r.status, 401, JSON.stringify(antwort));
  }
  const kaputt = await s.post('/api/editor/anmelden/ende', undefined, { 'Content-Type': 'application/json' });
  assert.ok([400, 401].includes(kaputt.status));
  await s.stop();
});

test('pruefe: fehlendes, manipuliertes, unbekanntes Cookie -> null; entfernter Passkey -> null', async () => {
  const s = await starte();
  const { cookie } = await registriere(s, 'Ingrid');
  assert.deepStrictEqual(s.sitzung.pruefe(req(cookie)), { wer: 'Ingrid' });
  const kippe = (cookie[0] === 'A' ? 'B' : 'A') + cookie.slice(1);
  for (const w of [undefined, '', kippe, cookie + 'x', cookie.slice(1), crypto.randomBytes(32).toString('base64url'), cookie.replace(/./, '+')]) {
    assert.strictEqual(s.sitzung.pruefe(req(w)), null, String(w));
  }
  assert.strictEqual(s.sitzung.pruefe({ headers: {} }), null);
  // Passkey per CLI entfernt -> Sitzung ungültig
  fs.writeFileSync(path.join(s.dataDir, 'passkeys.json'), '[]\n');
  assert.strictEqual(s.sitzung.pruefe(req(cookie)), null);
  await s.stop();
});

test('Leerlauf 2 h und absolut 12 h mit injizierter Uhr', async () => {
  let t = Date.UTC(2026, 10, 22, 8, 0, 0);
  const s = await starte({ jetzt: () => t });
  const { cookie, a } = await registriere(s, 'Ingrid');
  t += 2 * 3600e3 - 1000;
  assert.ok(s.sitzung.pruefe(req(cookie)), 'knapp unter 2 h Leerlauf noch gültig');
  t += 2 * 3600e3 + 1000;
  assert.strictEqual(s.sitzung.pruefe(req(cookie)), null, 'Leerlauf überschritten');
  assert.strictEqual(s.sitzung.pruefe(req(cookie)), null, 'bleibt gelöscht');

  const { res } = await melde(s, a);
  const c2 = cookieAus(res);
  const anfang = t;
  while (t + 3600e3 < anfang + 12 * 3600e3) {
    t += 3600e3;
    assert.ok(s.sitzung.pruefe(req(c2)), 'aktiv genutzt, unter 12 h');
  }
  t = anfang + 12 * 3600e3 + 1;
  assert.strictEqual(s.sitzung.pruefe(req(c2)), null, 'absolut abgelaufen trotz Nutzung');
  await s.stop();
});

test('Challenge läuft nach 5 min ab', async () => {
  let t = Date.now();
  const s = await starte({ jetzt: () => t });
  const { a } = await registriere(s);
  const start = await s.post('/api/editor/anmelden/start', {});
  t += 5 * 60e3 + 1;
  const res = await s.post('/api/editor/anmelden/ende', { antwort: a.melde({ challenge: ch(start), origin: ORIGIN, rpId: RP }) });
  assert.strictEqual(res.status, 401);
  await s.stop();
});

test('abmelden löscht die Sitzung und das Cookie', async () => {
  const s = await starte();
  const { cookie } = await registriere(s);
  const res = await s.post('/api/editor/abmelden', {}, { Cookie: `g42_sitzung=${cookie}` });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.headers['set-cookie'], ['g42_sitzung=; Path=/api/editor; Max-Age=0; HttpOnly; Secure; SameSite=Strict']);
  assert.strictEqual(s.sitzung.pruefe(req(cookie)), null);
  // ohne Cookie ebenfalls 200 (idempotent)
  assert.strictEqual((await s.post('/api/editor/abmelden')).status, 200);
  await s.stop();
});

test('Rate-Limit pro IP über alle Routen (letzter X-Forwarded-For-Eintrag)', async () => {
  const s = await starte();
  const stati = [];
  for (let i = 0; i < 31; i++) stati.push((await s.post(ROUTEN[i % ROUTEN.length], {}, { 'X-Forwarded-For': '1.2.3.4, 9.9.9.9' })).status);
  assert.ok(stati.slice(0, 30).every((x) => x !== 429));
  assert.strictEqual(stati[30], 429);
  // Anderer Proxy-Eintrag = andere IP; gefälschter erster Eintrag zählt nicht.
  assert.notStrictEqual((await s.post('/api/editor/anmelden/start', {}, { 'X-Forwarded-For': '9.9.9.9, 8.8.8.8' })).status, 429);
  assert.strictEqual((await s.post('/api/editor/anmelden/start', {}, { 'X-Forwarded-For': '7.7.7.7, 9.9.9.9' })).status, 429);
  await s.stop();
});

test('Logzeilen enthalten weder Einladungscode noch Cookie', async () => {
  const s = await starte();
  const { code, cookie } = await registriere(s);
  await s.post('/api/editor/registrieren/start?einladung=' + code, { einladung: code });
  await s.post('/api/editor/abmelden', {}, { Cookie: `g42_sitzung=${cookie}`, Referer: ORIGIN + '/editor/' });
  assert.ok(s.lines.length >= 4);
  for (const l of s.lines) {
    assert.ok(!l.includes(code), l);
    assert.ok(!l.includes(cookie), l);
  }
  await s.stop();
});

// --- CLI ---
function cli(args, env) {
  return spawnSync(process.execPath, [path.join(__dirname, 'editor-einladung.js'), ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
}

test('CLI: Einladung erstellen, auflisten, Passkey entfernen', async () => {
  const dataDir = tmp();
  const env = { ...ENV, EDITOR_DATA_DIR: dataDir };
  const r = cli(['Ingrid Nirnberger'], env);
  assert.strictEqual(r.status, 0, r.stderr);
  const m = /^https:\/\/editor\.gruppe42\.test\/editor\/#einladung=([A-Za-z0-9_-]{43})$/m.exec(r.stdout);
  assert.ok(m, r.stdout);
  const code = m[1];
  const inv = JSON.parse(fs.readFileSync(path.join(dataDir, 'einladungen.json'), 'utf8'));
  assert.strictEqual(inv.length, 1);
  assert.strictEqual(inv[0].hash, sha(code));
  assert.strictEqual(inv[0].name, 'Ingrid Nirnberger');
  assert.strictEqual(inv[0].benutzt, false);
  const tage = (Date.parse(inv[0].ablauf) - Date.now()) / 864e5;
  assert.ok(tage > 6.9 && tage <= 7, String(tage));
  assert.ok(!fs.readFileSync(path.join(dataDir, 'einladungen.json'), 'utf8').includes(code));

  // Die erstellte Einladung funktioniert mit dem Server.
  const s = await starte({ dataDir });
  const a = neuerAuthenticator();
  const start = await s.post('/api/editor/registrieren/start', { einladung: code });
  assert.strictEqual(start.status, 200);
  const ende = await s.post('/api/editor/registrieren/ende', { einladung: code, antwort: a.registriere({ challenge: ch(start), origin: ORIGIN, rpId: RP }) });
  assert.strictEqual(ende.status, 200);
  const cookie = cookieAus(ende);
  // Zweiter Passkey mit anderer Einladung
  assert.strictEqual(cli(['Zweite'], env).status, 0);
  const b = neuerAuthenticator();
  const code2 = /#einladung=(\S+)/.exec(cli(['Dritte'], env).stdout)[1];
  const st2 = await s.post('/api/editor/registrieren/start', { einladung: code2 });
  assert.strictEqual((await s.post('/api/editor/registrieren/ende', { einladung: code2, antwort: b.registriere({ challenge: ch(st2), origin: ORIGIN, rpId: RP }) })).status, 200);

  const liste = cli(['--liste'], env);
  assert.strictEqual(liste.status, 0, liste.stderr);
  assert.match(liste.stdout, /Ingrid Nirnberger/);
  assert.match(liste.stdout, /benutzt/);
  assert.ok(liste.stdout.includes(a.id.slice(0, 8)));
  assert.ok(!liste.stdout.includes(a.id), 'nur Präfix der Passkey-ID');
  assert.ok(!liste.stdout.includes(sha(code)), 'keine Hashes');
  assert.ok(!liste.stdout.includes(code));
  assert.ok(!/jwk|"x"|"y"/.test(liste.stdout));

  // Entfernen: leerer, unbekannter und (künstlich) mehrdeutiger Präfix -> Fehler
  assert.notStrictEqual(cli(['--entfernen'], env).status, 0);
  assert.notStrictEqual(cli(['--entfernen', 'zzzzzzzz'], env).status, 0);
  const pkPfad = path.join(dataDir, 'passkeys.json');
  const pks = JSON.parse(fs.readFileSync(pkPfad, 'utf8'));
  const gemeinsam = (() => { let i = 0; while (a.id[i] === b.id[i]) i++; return a.id.slice(0, i); })();
  if (gemeinsam.length > 0) assert.notStrictEqual(cli(['--entfernen', gemeinsam], env).status, 0);
  else {
    // Präfixe unterscheiden sich schon im ersten Zeichen: Mehrdeutigkeit mit präparierter Datei prüfen.
    const mehr = tmp();
    fs.writeFileSync(path.join(mehr, 'passkeys.json'), JSON.stringify([{ ...pks[0], id: 'abc1' }, { ...pks[1], id: 'abc2' }], null, 2) + '\n');
    const rm = cli(['--entfernen', 'abc'], { ...ENV, EDITOR_DATA_DIR: mehr });
    assert.notStrictEqual(rm.status, 0);
    assert.match(rm.stderr, /mehrdeutig/i);
  }
  const rm = cli(['--entfernen', a.id.slice(0, 8)], env);
  assert.strictEqual(rm.status, 0, rm.stderr);
  const rest = JSON.parse(fs.readFileSync(pkPfad, 'utf8'));
  assert.deepStrictEqual(rest.map((p) => p.id), [b.id]);
  assert.strictEqual(s.sitzung.pruefe(req(cookie)), null, 'Sitzung des entfernten Passkeys ungültig');
  assert.deepStrictEqual(fs.readdirSync(dataDir).sort(), ['einladungen.json', 'passkeys.json']);
  await s.stop();
});

test('CLI: Fehler ohne Name, ohne Env, mit kaputter Datei', () => {
  const dataDir = tmp();
  assert.notStrictEqual(cli([], { ...ENV, EDITOR_DATA_DIR: dataDir }).status, 0);
  assert.notStrictEqual(cli(['  '], { ...ENV, EDITOR_DATA_DIR: dataDir }).status, 0);
  assert.notStrictEqual(cli(['x'.repeat(200)], { ...ENV, EDITOR_DATA_DIR: dataDir }).status, 0);
  assert.notStrictEqual(cli(['Name'], { EDITOR_DATA_DIR: dataDir }).status, 0);
  assert.notStrictEqual(cli(['--unbekannt'], { ...ENV, EDITOR_DATA_DIR: dataDir }).status, 0);
  fs.writeFileSync(path.join(dataDir, 'einladungen.json'), '{kaputt');
  const r = cli(['Name'], { ...ENV, EDITOR_DATA_DIR: dataDir });
  assert.notStrictEqual(r.status, 0);
  assert.strictEqual(fs.readFileSync(path.join(dataDir, 'einladungen.json'), 'utf8'), '{kaputt', 'kaputte Datei nicht überschrieben');
});

// --- Fix-Runde 1: Sperre, Per-IP-Grenze, Dateirechte ---
test('zwei parallele registrieren/ende mit derselben Einladung: genau einmal 200', async () => {
  const s = await starte();
  const code = einladen(s.dataDir, 'Ingrid');
  const a = neuerAuthenticator();
  const b = neuerAuthenticator();
  const st1 = await s.post('/api/editor/registrieren/start', { einladung: code });
  const st2 = await s.post('/api/editor/registrieren/start', { einladung: code });
  const [r1, r2] = await Promise.all([
    s.post('/api/editor/registrieren/ende', { einladung: code, antwort: a.registriere({ challenge: ch(st1), origin: ORIGIN, rpId: RP }) }),
    s.post('/api/editor/registrieren/ende', { einladung: code, antwort: b.registriere({ challenge: ch(st2), origin: ORIGIN, rpId: RP }) }),
  ]);
  assert.deepStrictEqual([r1.status, r2.status].sort(), [200, 400]);
  assert.deepStrictEqual((r1.status === 400 ? r1 : r2).json, { error: 'einladung' });
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(s.dataDir, 'passkeys.json'), 'utf8')).length, 1);
  await s.stop();
});

test('Challenges pro IP begrenzt: älteste der eigenen IP verdrängt, andere IPs unberührt', async () => {
  const s = await starte();
  const { a } = await registriere(s);
  const andere = klient(s.base);
  const fremdStart = await andere('/api/editor/anmelden/start', {});
  const eigene = [];
  for (let i = 0; i < 6; i++) eigene.push(await s.post('/api/editor/anmelden/start', {}));
  const ende = (post, start) => post('/api/editor/anmelden/ende', { antwort: a.melde({ challenge: ch(start), origin: ORIGIN, rpId: RP }) });
  assert.strictEqual((await ende(s.post, eigene[0])).status, 401, 'älteste eigene verdrängt');
  assert.strictEqual((await ende(s.post, eigene[1])).status, 200, 'zweitälteste noch da');
  assert.strictEqual((await ende(s.post, eigene[5])).status, 200);
  assert.strictEqual((await ende(andere, fremdStart)).status, 200, 'Challenge der anderen IP bleibt');
  await s.stop();
});

test('Dateirechte: Dateien 0600, Verzeichnis 0700', async (t) => {
  const s = await starte({ dataDir: path.join(tmp(), 'neu', 'editor') });
  t.after(() => s.stop());
  // Erste Anfrage legt das Verzeichnis an (einladen() im Test würde es sonst mit 0755 anlegen).
  assert.strictEqual((await s.post('/api/editor/anmelden/start', {})).status, 200);
  assert.strictEqual(fs.statSync(s.dataDir).mode & 0o777, 0o700);
  await registriere(s);
  assert.strictEqual(fs.statSync(path.join(s.dataDir, 'passkeys.json')).mode & 0o777, 0o600);
  assert.strictEqual(fs.statSync(path.join(s.dataDir, 'einladungen.json')).mode & 0o777, 0o600, 'vom Server neu geschrieben');
  const dataDir = path.join(tmp(), 'cli', 'editor');
  assert.strictEqual(cli(['Name'], { ...ENV, EDITOR_DATA_DIR: dataDir }).status, 0);
  assert.strictEqual(fs.statSync(dataDir).mode & 0o777, 0o700);
  assert.strictEqual(fs.statSync(path.join(dataDir, 'einladungen.json')).mode & 0o777, 0o600);
});

test('Sperre: gehaltene Sperre -> CLI scheitert klar, Server 503; veraltete Sperre wird übernommen', async () => {
  const dataDir = tmp();
  const env = { ...ENV, EDITOR_DATA_DIR: dataDir };
  const sperre = path.join(dataDir, '.sperre');
  fs.writeFileSync(sperre, '1');
  const r = cli(['Name'], env);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /gesperrt/);
  assert.ok(!fs.existsSync(path.join(dataDir, 'einladungen.json')));
  assert.ok(fs.existsSync(sperre), 'fremde Sperre nicht entfernt');
  assert.notStrictEqual(cli(['--entfernen', 'abc'], env).status, 0);

  // Server: Anmeldung unter gehaltener Sperre -> 503 editor_aus
  fs.unlinkSync(sperre);
  const s = await starte({ dataDir });
  const { a } = await registriere(s);
  fs.writeFileSync(sperre, '1');
  const { res } = await melde(s, a);
  assert.strictEqual(res.status, 503);
  assert.deepStrictEqual(res.json, { error: 'editor_aus' });
  assert.strictEqual(res.headers['set-cookie'], undefined);

  // Veraltet (älter als 30 s): wird übernommen und danach freigegeben
  const alt = new Date(Date.now() - 60_000);
  fs.utimesSync(sperre, alt, alt);
  assert.strictEqual(cli(['Zweite'], env).status, 0);
  assert.ok(!fs.existsSync(sperre));
  assert.strictEqual((await melde(s, a)).res.status, 200);
  // Fehler im CLI innerhalb der Sperre (unbekannter Präfix) gibt die Sperre frei
  assert.notStrictEqual(cli(['--entfernen', 'zzzz'], env).status, 0);
  assert.ok(!fs.existsSync(sperre));
  await s.stop();
});

test('mitSperre: Fehler in fn gibt frei; gehaltene Sperre -> art gesperrt', () => {
  const { mitSperre } = require('./datei-sperre');
  const dir = tmp();
  assert.throws(() => mitSperre(dir, () => { throw new Error('x'); }), /x/);
  assert.ok(!fs.existsSync(path.join(dir, '.sperre')));
  assert.strictEqual(mitSperre(dir, () => 7), 7);
  const t0 = Date.now();
  assert.throws(() => mitSperre(dir, () => mitSperre(dir, () => 1, { warten: 100 })), (e) => e.art === 'gesperrt');
  assert.ok(Date.now() - t0 >= 100);
  assert.ok(!fs.existsSync(path.join(dir, '.sperre')));
});
