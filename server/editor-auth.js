'use strict';
// GitHub App login for /editor: OAuth code exchange only. The access token goes to the static editor page
// in the URL fragment (never sent to a server) and is neither stored nor logged here.
const crypto = require('node:crypto');

const RATE_LIMIT = 20; // requests per IP per minute, both routes together
const COOKIE = 'g42_state';
const cookieAttrs = (maxAge) => `Path=/api/editor; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
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
    const done = (loc) => send(res, 302, { ...NO_CACHE, Location: loc, 'Set-Cookie': `${COOKIE}=; ${cookieAttrs(0)}` }, undefined);
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
    let frag = `#token=${encodeURIComponent(data.access_token)}`;
    if (Number.isFinite(data.expires_in)) frag += `&ablauf=${Math.trunc(data.expires_in)}`;
    return done('/editor/' + frag);
  }

  return {
    routes: {
      '/api/editor/login': { method: 'GET', handler: login },
      '/api/editor/callback': { method: 'GET', handler: callback },
    },
  };
}

module.exports = { createEditorAuth };
