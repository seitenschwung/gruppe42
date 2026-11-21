'use strict';
// Editor login: one-time invitation -> passkey registration; passkey login; in-memory session behind an
// HttpOnly cookie. Files under the data dir: einladungen.json [{hash, name, userId, erstellt, ablauf,
// benutzt}] (code only as SHA-256) and passkeys.json [{id, name, jwk, alg, signCount, userId, erstellt}].
// Never logged or returned: session ids, invitation codes, challenges, passkey data.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const passkey = require('./passkey');

const RATE_LIMIT = 30; // requests per IP per minute, all routes together
const MAX_BODY = 16384;
const CHALLENGE_TTL = 5 * 60e3;
const MAX_CHALLENGES = 1000;
const LEERLAUF = 2 * 3600e3;
const ABSOLUT = 12 * 3600e3;
const RP_NAME = 'Gruppe 42 Editor';
const COOKIE = 'g42_sitzung';
const COOKIE_ATTR = 'Path=/api/editor; HttpOnly; Secure; SameSite=Strict';
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const EINLADUNGEN = 'einladungen.json';
const PASSKEYS = 'passkeys.json';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// EDITOR_ORIGIN must be a bare origin (https, or http only for localhost); EDITOR_RP_ID its hostname or a
// registrable suffix of it. Returns {origin, rpId} or null (= editor off).
function konfiguration(env) {
  const origin = env.EDITOR_ORIGIN;
  const rpId = env.EDITOR_RP_ID;
  if (typeof origin !== 'string' || typeof rpId !== 'string' || !origin || !rpId) return null;
  let u;
  try { u = new URL(origin); } catch { return null; }
  if (u.origin !== origin) return null;
  const host = u.hostname;
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && host === 'localhost')) return null;
  if (rpId !== host && !(rpId.includes('.') && host.endsWith('.' + rpId))) return null;
  return { origin, rpId };
}

function schreibeAtomar(pfad, wert) {
  const tmp = pfad + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
  try {
    fs.writeFileSync(tmp, JSON.stringify(wert, null, 2) + '\n');
    fs.renameSync(tmp, pfad);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* nichts da */ }
    throw e;
  }
}

// Missing file = empty list; unreadable/invalid file throws (and is never overwritten).
function leseListe(pfad) {
  let text;
  try { text = fs.readFileSync(pfad, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const wert = JSON.parse(text);
  if (!Array.isArray(wert)) throw new Error(path.basename(pfad) + ': keine Liste');
  return wert;
}

function datenSpeicher(dataDir) {
  const p = (name) => path.join(dataDir, name);
  return {
    einladungen: () => leseListe(p(EINLADUNGEN)),
    passkeys: () => leseListe(p(PASSKEYS)),
    schreibeEinladungen: (l) => { fs.mkdirSync(dataDir, { recursive: true }); schreibeAtomar(p(EINLADUNGEN), l); },
    schreibePasskeys: (l) => { fs.mkdirSync(dataDir, { recursive: true }); schreibeAtomar(p(PASSKEYS), l); },
  };
}

function leseCookie(header, name) {
  if (typeof header !== 'string') return undefined;
  for (const teil of header.split(';')) {
    const i = teil.indexOf('=');
    if (i > 0 && teil.slice(0, i).trim() === name) return teil.slice(i + 1).trim();
  }
  return undefined;
}

function leseJson(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return reject(Object.assign(new Error('type'), { status: 415 }));
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { if (size - c.length <= MAX_BODY) reject(Object.assign(new Error('size'), { status: 413 })); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (size > MAX_BODY) return;
      if (size === 0) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      } catch { reject(Object.assign(new Error('json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

// Challenge string from the (not yet verified) clientDataJSON, only to look it up; verification follows.
function challengeAus(antwort) {
  const cdj = antwort && typeof antwort === 'object' && antwort.response && antwort.response.clientDataJSON;
  if (typeof cdj !== 'string' || cdj.length > 4096) return null;
  try {
    const cd = JSON.parse(Buffer.from(cdj, 'base64url').toString('utf8'));
    return cd && typeof cd.challenge === 'string' && cd.challenge.length <= 128 ? cd.challenge : null;
  } catch { return null; }
}

function createSitzung({ env = process.env, dataDir, jetzt = () => Date.now(), random = crypto.randomBytes } = {}) {
  const dir = dataDir || env.EDITOR_DATA_DIR || '/data/editor';
  const cfg = konfiguration(env);
  const daten = datenSpeicher(dir);
  const now = () => +jetzt();
  const challenges = new Map(); // challenge (base64url) -> {zweck, einladungHash?, userId?, ablauf}
  const sitzungen = new Map(); // sha256(session id) -> {wer, passkeyId, erstellt, zuletzt}
  const hits = new Map(); // ip -> [timestamps]

  let schreibbar = false;
  function verfuegbar() {
    if (!cfg) return false;
    if (schreibbar) return true;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, '.probe-' + process.pid + '-' + crypto.randomBytes(4).toString('hex'));
      fs.writeFileSync(probe, 'x');
      fs.unlinkSync(probe);
      schreibbar = true;
    } catch { schreibbar = false; }
    return schreibbar;
  }

  function limited(ip) {
    const t = now();
    const list = (hits.get(ip) || []).filter((x) => t - x < 60_000);
    list.push(t);
    hits.set(ip, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (t - v[v.length - 1] > 60_000) hits.delete(k);
    return list.length > RATE_LIMIT;
  }

  function neueChallenge(eintrag) {
    const t = now();
    for (const [k, v] of challenges) if (v.ablauf <= t) challenges.delete(k);
    while (challenges.size >= MAX_CHALLENGES) challenges.delete(challenges.keys().next().value);
    const c = Buffer.from(random(32)).toString('base64url');
    challenges.set(c, { ...eintrag, ablauf: t + CHALLENGE_TTL });
    return c;
  }

  // Single use: removed before anything is verified.
  function nimmChallenge(antwort, zweck) {
    const c = challengeAus(antwort);
    if (c === null) return null;
    const e = challenges.get(c);
    challenges.delete(c);
    if (!e || e.zweck !== zweck || e.ablauf <= now()) return null;
    return { challenge: c, ...e };
  }

  function gueltigeEinladung(code) {
    if (typeof code !== 'string' || code.length < 20 || code.length > 128) return null;
    const hash = sha256(code);
    const liste = daten.einladungen();
    const e = liste.find((x) => x && x.hash === hash);
    if (!e || e.benutzt !== false || !(Date.parse(e.ablauf) > now())) return null;
    return { liste, e, hash };
  }

  function neueSitzung(wer, passkeyId) {
    const t = now();
    for (const [k, v] of sitzungen) if (t - v.zuletzt >= LEERLAUF || t - v.erstellt >= ABSOLUT) sitzungen.delete(k);
    const id = Buffer.from(random(32)).toString('base64url');
    sitzungen.set(sha256(id), { wer, passkeyId, erstellt: t, zuletzt: t });
    return `${COOKIE}=${id}; ${COOKIE_ATTR}`;
  }

  function pruefe(req) {
    if (!cfg) return null;
    const id = leseCookie(req && req.headers && req.headers.cookie, COOKIE);
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
    const key = sha256(id);
    const s = sitzungen.get(key);
    if (!s) return null;
    const t = now();
    if (t - s.zuletzt >= LEERLAUF || t - s.erstellt >= ABSOLUT) { sitzungen.delete(key); return null; }
    // A passkey removed with the CLI ends its sessions.
    let pks;
    try { pks = daten.passkeys(); } catch { return null; }
    if (!pks.some((p) => p && p.id === s.passkeyId)) { sitzungen.delete(key); return null; }
    s.zuletzt = t;
    return { wer: s.wer };
  }

  // Common checks, body parsing and error mapping; fn(body, reply) does the work.
  function route(fn) {
    return async (req, res, send) => {
      const reply = (status, obj, cookie) => send(res, status, cookie ? { ...JSON_HEADERS, 'Set-Cookie': cookie } : JSON_HEADERS, JSON.stringify(obj) + '\n');
      if (!verfuegbar()) return reply(503, { error: 'editor_aus' });
      // Behind the reverse proxy the last X-Forwarded-For entry is the one the proxy added.
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '-').split(',').pop().trim();
      if (limited(ip)) return reply(429, { error: 'rate_limited' });
      if (req.headers['x-g42-editor'] !== '1' || req.headers.origin !== cfg.origin) return reply(403, { error: 'herkunft' });
      let body;
      try { body = await leseJson(req); } catch (e) { return reply(e.status || 400, { error: 'bad_request' }); }
      try { return fn(body, reply, req); } catch { return reply(500, { error: 'intern' }); }
    };
  }

  const registrierenStart = route((body, reply) => {
    const g = gueltigeEinladung(body.einladung);
    if (!g) return reply(400, { error: 'einladung' });
    const userId = typeof g.e.userId === 'string' && g.e.userId ? g.e.userId : Buffer.from(random(16)).toString('base64url');
    const challenge = neueChallenge({ zweck: 'registrieren', einladungHash: g.hash, userId });
    const optionen = passkey.registrierungOptionen({
      rpId: cfg.rpId, rpName: RP_NAME, userId: Buffer.from(userId, 'base64url'), userName: g.e.name, challenge,
      excludeCredentials: daten.passkeys().map((p) => p.id),
    });
    return reply(200, { optionen });
  });

  // Everything after the body is read runs synchronously: no other request can use the invitation in between.
  const registrierenEnde = route((body, reply) => {
    const g = gueltigeEinladung(body.einladung);
    if (!g) return reply(400, { error: 'einladung' });
    const c = nimmChallenge(body.antwort, 'registrieren');
    if (!c || c.einladungHash !== g.hash) return reply(400, { error: 'registrierung' });
    let neu;
    try {
      neu = passkey.pruefeRegistrierung({ antwort: body.antwort, challenge: c.challenge, origin: cfg.origin, rpId: cfg.rpId });
    } catch (e) {
      if (e.art === 'passkey') return reply(400, { error: 'registrierung' });
      throw e;
    }
    const pks = daten.passkeys();
    if (pks.some((p) => p && p.id === neu.id)) return reply(400, { error: 'registrierung' });
    // Invitation first: a crash between the two writes burns it rather than leaving it reusable.
    g.e.benutzt = true;
    daten.schreibeEinladungen(g.liste);
    pks.push({ id: neu.id, name: g.e.name, jwk: neu.jwk, alg: neu.alg, signCount: neu.signCount, userId: c.userId, erstellt: new Date(now()).toISOString() });
    daten.schreibePasskeys(pks);
    return reply(200, { wer: g.e.name }, neueSitzung(g.e.name, neu.id));
  });

  const anmeldenStart = route((body, reply) => {
    const challenge = neueChallenge({ zweck: 'anmelden' });
    return reply(200, { optionen: passkey.anmeldungOptionen({ rpId: cfg.rpId, challenge }) });
  });

  const anmeldenEnde = route((body, reply) => {
    const antwort = body.antwort;
    const c = nimmChallenge(antwort, 'anmelden');
    if (!c) return reply(401, { error: 'anmeldung' });
    const pks = daten.passkeys();
    const pk = pks.find((p) => p && typeof antwort.id === 'string' && p.id === antwort.id);
    if (!pk) return reply(401, { error: 'anmeldung' });
    let r;
    try {
      r = passkey.pruefeAnmeldung({ antwort, challenge: c.challenge, origin: cfg.origin, rpId: cfg.rpId, passkey: pk });
    } catch (e) {
      if (e.art === 'passkey') return reply(401, { error: 'anmeldung' });
      throw e;
    }
    pk.signCount = r.signCount;
    daten.schreibePasskeys(pks);
    return reply(200, { wer: pk.name }, neueSitzung(pk.name, pk.id));
  });

  const abmelden = route((body, reply, req) => {
    const id = leseCookie(req.headers.cookie, COOKIE);
    if (typeof id === 'string' && id) sitzungen.delete(sha256(id));
    return reply(200, { ok: true }, `${COOKIE}=; Path=/api/editor; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
  });

  return {
    pruefe,
    routes: {
      '/api/editor/registrieren/start': { method: 'POST', handler: registrierenStart },
      '/api/editor/registrieren/ende': { method: 'POST', handler: registrierenEnde },
      '/api/editor/anmelden/start': { method: 'POST', handler: anmeldenStart },
      '/api/editor/anmelden/ende': { method: 'POST', handler: anmeldenEnde },
      '/api/editor/abmelden': { method: 'POST', handler: abmelden },
    },
  };
}

module.exports = { createSitzung, konfiguration, datenSpeicher, sha256 };
