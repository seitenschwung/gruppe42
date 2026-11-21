'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { createEditorAuth } = require('./editor-auth');

const ENV = { EDITOR_GITHUB_CLIENT_ID: 'cid', EDITOR_GITHUB_CLIENT_SECRET: 'csecret' };
const NONCE_BYTES = Buffer.alloc(16, 0xab);
const NONCE = NONCE_BYTES.toString('hex');
const sign = (n, secret = 'csecret') =>
  crypto.createHmac('sha256', crypto.createHash('sha256').update('g42-state:' + secret).digest()).update(n).digest('hex');

function setup(env = ENV, ghResponse) {
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (ghResponse instanceof Error) throw ghResponse;
    return ghResponse || { ok: true, json: async () => ({ access_token: 'gho_a b+c', expires_in: 28800 }) };
  };
  const api = createEditorAuth({ env, fetch, now: () => 1000, random: () => NONCE_BYTES });
  return { calls, routes: api.routes };
}

function call(route, url, headers = {}) {
  const res = { status: null, headers: null, body: null };
  const send = (r, s, h, b) => { res.status = s; res.headers = h; res.body = b; };
  const req = { url, method: 'GET', headers, socket: { remoteAddress: '1.2.3.4' } };
  return Promise.resolve(route.handler(req, res, send)).then(() => res);
}
const cookie = (n = NONCE, mac = sign(NONCE)) => ({ cookie: `g42_state=${n}.${mac}` });

test('ohne_env_503', async () => {
  for (const env of [{}, { EDITOR_GITHUB_CLIENT_ID: 'x' }, { EDITOR_GITHUB_CLIENT_SECRET: 'y' }]) {
    const { routes } = setup(env);
    const r = await call(routes['/api/editor/login'], '/api/editor/login');
    assert.strictEqual(r.status, 503);
    assert.deepStrictEqual(JSON.parse(r.body), { error: 'editor_disabled' });
    const c = await call(routes['/api/editor/callback'], '/api/editor/callback?code=a&state=b');
    assert.strictEqual(c.status, 503);
  }
});

test('login_redirect_und_cookie', async () => {
  const { routes } = setup();
  assert.strictEqual(routes['/api/editor/login'].method, 'GET');
  const r = await call(routes['/api/editor/login'], '/api/editor/login');
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.Location, `https://github.com/login/oauth/authorize?client_id=cid&state=${NONCE}`);
  assert.strictEqual(r.headers['Set-Cookie'], `g42_state=${NONCE}.${sign(NONCE)}; Path=/api/editor; Max-Age=600; HttpOnly; Secure; SameSite=Lax`);
  assert.strictEqual(r.headers['Cache-Control'], 'no-store');
  assert.strictEqual(r.headers['Referrer-Policy'], 'no-referrer');
  assert.ok(!r.headers.Location.includes('redirect_uri'));
});

test('callback_falscher_state', async () => {
  const cases = [
    ['kein Cookie', {}, NONCE],
    ['Cookie ohne Punkt', { cookie: 'g42_state=abc' }, 'abc'],
    ['falsche Signatur', cookie(NONCE, 'f'.repeat(64)), NONCE],
    ['kurze Signatur', cookie(NONCE, 'ff'), NONCE],
    ['anderer State', cookie(), 'c'.repeat(32)],
    ['fremdes Secret', cookie(NONCE, sign(NONCE, 'other')), NONCE],
  ];
  for (const [name, headers, state] of cases) {
    const { routes, calls } = setup();
    const r = await call(routes['/api/editor/callback'], `/api/editor/callback?code=c&state=${state}`, headers);
    assert.strictEqual(r.status, 302, name);
    assert.strictEqual(r.headers.Location, '/editor/#fehler=state', name);
    assert.strictEqual(calls.length, 0, name);
    assert.match(r.headers['Set-Cookie'], /Max-Age=0/, name);
  }
});

test('callback_ok', async () => {
  const { routes, calls } = setup();
  const r = await call(routes['/api/editor/callback'], `/api/editor/callback?code=thecode&state=${NONCE}`,
    { cookie: `other=1; g42_state=${NONCE}.${sign(NONCE)}; x=y` });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://github.com/login/oauth/access_token');
  assert.strictEqual(calls[0].opts.method, 'POST');
  assert.strictEqual(calls[0].opts.headers.Accept, 'application/json');
  assert.deepStrictEqual(JSON.parse(calls[0].opts.body), { client_id: 'cid', client_secret: 'csecret', code: 'thecode' });
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.Location, `/editor/#token=${encodeURIComponent('gho_a b+c')}&ablauf=28800`);
  assert.match(r.headers['Set-Cookie'], /^g42_state=; Path=\/api\/editor; Max-Age=0/);
  assert.strictEqual(r.headers['Cache-Control'], 'no-store');
  assert.strictEqual(r.headers['Referrer-Policy'], 'no-referrer');
});

test('callback_ohne_ablauf', async () => {
  const { routes } = setup(ENV, { ok: true, json: async () => ({ access_token: 'tok' }) });
  const r = await call(routes['/api/editor/callback'], `/api/editor/callback?code=c&state=${NONCE}`, cookie());
  assert.strictEqual(r.headers.Location, '/editor/#token=tok');
});

test('github_fehler', async () => {
  for (const gh of [
    { ok: true, json: async () => ({ error: 'bad_verification_code' }) },
    { ok: false, json: async () => { throw new Error('x'); } },
    new Error('network'),
  ]) {
    const { routes } = setup(ENV, gh);
    const r = await call(routes['/api/editor/callback'], `/api/editor/callback?code=c&state=${NONCE}`, cookie());
    assert.strictEqual(r.headers.Location, '/editor/#fehler=login');
    assert.match(r.headers['Set-Cookie'], /Max-Age=0/);
  }
});

test('callback_ohne_code', async () => {
  const { routes, calls } = setup();
  const r = await call(routes['/api/editor/callback'], `/api/editor/callback?state=${NONCE}`, cookie());
  assert.strictEqual(r.headers.Location, '/editor/#fehler=login');
  assert.strictEqual(calls.length, 0);
});

test('rate_limit', async () => {
  const { routes } = setup();
  for (let i = 0; i < 20; i++) {
    const r = await call(i % 2 ? routes['/api/editor/login'] : routes['/api/editor/callback'], '/api/editor/login');
    assert.notStrictEqual(r.status, 429);
  }
  const r = await call(routes['/api/editor/login'], '/api/editor/login');
  assert.strictEqual(r.status, 429);
});
