'use strict';
// GitHub App login for /editor: OAuth code exchange only. The access token reaches the editor page via a
// short-lived HttpOnly cookie that the page redeems once with POST /api/editor/token (never in a URL).
// Logout revokes the token at GitHub. The token is neither stored nor logged here.
const crypto = require('node:crypto');

const RATE_LIMIT = 20; // requests per IP per minute, all four routes together
const COOKIE = 'g42_state';
const cookieAttrs = (maxAge) => `Path=/api/editor; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
const TOKEN_COOKIE = 'g42_token';
const tokenAttrs = (maxAge) => `Path=/api/editor/token; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
const MAX_BODY = 2048;
const NO_CACHE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', ...NO_CACHE };

function equalSafe(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function readCookie(header, name) {
  if (typeof header !== 'string') return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size <= MAX_BODY) chunks.push(c); });
    req.on('end', () => {
      if (size > MAX_BODY) return reject(new Error('size'));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// CSRF defence for the POST routes: custom header (forces a CORS preflight) plus Origin check.
// "Own origin" comes from the Host header (the proxy passes it through): https always, http only for localhost.
function sameOrigin(req) {
  if (req.headers['x-g42-editor'] !== '1') return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  const host = req.headers.host;
  if (typeof host !== 'string' || !host) return false;
  if (origin === 'https://' + host) return true;
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) && origin === 'http://' + host;
}

function createEditorAuth({ env, fetch: doFetch, now = Date.now, random = crypto.randomBytes }) {
  const hits = new Map(); // ip -> [timestamps]
  const limited = (ip) => {
    const t = now();
    const list = (hits.get(ip) || []).filter((x) => t - x < 60_000);
    list.push(t);
    hits.set(ip, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (t - v[v.length - 1] > 60_000) hits.delete(k);
    return list.length > RATE_LIMIT;
  };
  const mac = (secret, nonce) => crypto
    .createHmac('sha256', crypto.createHash('sha256').update('g42-state:' + secret).digest())
    .update(nonce).digest('hex');

  // Common checks; returns true when the request was already answered.
  function guard(req, res, send) {
    const reply = (status, obj) => { send(res, status, JSON_HEADERS, JSON.stringify(obj) + '\n'); return true; };
    if (!env.EDITOR_GITHUB_CLIENT_ID || !env.EDITOR_GITHUB_CLIENT_SECRET) return reply(503, { error: 'editor_disabled' });
    // Behind the reverse proxy the last X-Forwarded-For entry is the one the proxy added.
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '-').split(',').pop().trim();
    if (limited(ip)) return reply(429, { error: 'rate_limited' });
    return false;
  }

  // Like guard, plus the same-origin check for POST routes.
  function guardPost(req, res, send) {
    if (guard(req, res, send)) return true;
    if (sameOrigin(req)) return false;
    send(res, 403, JSON_HEADERS, '{"error":"herkunft"}\n');
    return true;
  }

  async function login(req, res, send) {
    if (guard(req, res, send)) return;
    const nonce = random(16).toString('hex');
    const secret = env.EDITOR_GITHUB_CLIENT_SECRET;
    // No redirect_uri: GitHub uses the callback URL registered in the app (the Host header is not trusted).
    const location = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(env.EDITOR_GITHUB_CLIENT_ID)}&state=${nonce}`;
    send(res, 302, { ...NO_CACHE, Location: location, 'Set-Cookie': `${COOKIE}=${nonce}.${mac(secret, nonce)}; ${cookieAttrs(600)}` }, undefined);
  }

  async function callback(req, res, send) {
    if (guard(req, res, send)) return;
    const done = (loc, extra = []) => send(res, 302, { ...NO_CACHE, Location: loc, 'Set-Cookie': [`${COOKIE}=; ${cookieAttrs(0)}`, ...extra] }, undefined);
    const secret = env.EDITOR_GITHUB_CLIENT_SECRET;
    let params;
    try { params = new URL(req.url, 'http://localhost').searchParams; } catch { return done('/editor/#fehler=state'); }
    const state = params.get('state') || '';
    const raw = readCookie(req.headers.cookie, COOKIE) || '';
    const dot = raw.indexOf('.');
    const nonce = dot > 0 ? raw.slice(0, dot) : '';
    const sig = dot > 0 ? raw.slice(dot + 1) : '';
    if (!nonce || !equalSafe(sig, mac(secret, nonce)) || !equalSafe(state, nonce)) return done('/editor/#fehler=state');

    const code = params.get('code');
    if (!code) return done('/editor/#fehler=login');
    let data = {};
    try {
      const r = await doFetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: env.EDITOR_GITHUB_CLIENT_ID, client_secret: secret, code }),
        signal: AbortSignal.timeout(10_000),
      });
      data = (await r.json()) || {};
    } catch { return done('/editor/#fehler=login'); }
    if (typeof data.access_token !== 'string' || !data.access_token) return done('/editor/#fehler=login');
    const ablauf = Number.isFinite(data.expires_in) ? Math.trunc(data.expires_in) : '';
    return done('/editor/#angemeldet', [`${TOKEN_COOKIE}=${encodeURIComponent(data.access_token)}.${ablauf}; ${tokenAttrs(60)}`]);
  }

  // Redeems the one-shot token cookie set by the callback.
  async function token(req, res, send) {
    if (guardPost(req, res, send)) return;
    const raw = readCookie(req.headers.cookie, TOKEN_COOKIE) || '';
    const dot = raw.lastIndexOf('.');
    let tok = '';
    try { tok = dot > 0 ? decodeURIComponent(raw.slice(0, dot)) : ''; } catch { tok = ''; }
    const ablauf = dot > 0 ? raw.slice(dot + 1) : '';
    if (!tok || !/^\d{0,9}$/.test(ablauf)) return send(res, 401, JSON_HEADERS, '{"error":"kein_token"}\n');
    send(res, 200, { ...JSON_HEADERS, 'Set-Cookie': `${TOKEN_COOKIE}=; ${tokenAttrs(0)}` },
      JSON.stringify({ token: tok, ablauf: ablauf === '' ? null : Number(ablauf) }) + '\n');
  }

  // Revokes the token at GitHub; always 204 afterwards (the browser forgets the token either way).
  async function abmelden(req, res, send) {
    if (guardPost(req, res, send)) return;
    const done = () => send(res, 204, NO_CACHE, undefined);
    let tok;
    try { tok = (await readJson(req)).token; } catch { return done(); }
    if (typeof tok !== 'string' || !tok) return done();
    try {
      const basic = Buffer.from(`${env.EDITOR_GITHUB_CLIENT_ID}:${env.EDITOR_GITHUB_CLIENT_SECRET}`).toString('base64');
      await doFetch(`https://api.github.com/applications/${encodeURIComponent(env.EDITOR_GITHUB_CLIENT_ID)}/token`, {
        method: 'DELETE',
        headers: { Authorization: `Basic ${basic}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: tok }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch { /* revocation is best effort */ }
    done();
  }

  return {
    routes: {
      '/api/editor/login': { method: 'GET', handler: login },
      '/api/editor/callback': { method: 'GET', handler: callback },
      '/api/editor/token': { method: 'POST', handler: token },
      '/api/editor/abmelden': { method: 'POST', handler: abmelden },
    },
  };
}

module.exports = { createEditorAuth };
