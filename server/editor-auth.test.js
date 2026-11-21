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

function call(route, url, headers = {}, body) {
  const res = { status: null, headers: null, body: null };
  const send = (r, s, h, b) => { res.status = s; res.headers = h; res.body = b; };
  const req = new (require('node:stream').Readable)({ read() {} });
  Object.assign(req, { url, method: route.method, headers, socket: { remoteAddress: '1.2.3.4' } });
  if (body !== undefined) { req.headers['content-type'] = 'application/json'; req.push(typeof body === 'string' ? body : JSON.stringify(body)); }
  req.push(null);
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
    assert.match([].concat(r.headers['Set-Cookie']).join('|'), /g42_state=; Path=\/api\/editor; Max-Age=0/, name);
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
  assert.strictEqual(r.headers.Location, '/editor/#angemeldet');
  assert.ok(!r.headers.Location.includes('gho_a'), 'Token nicht im Location');
  const sc = [].concat(r.headers['Set-Cookie']);
  assert.ok(sc.includes(`g42_token=${encodeURIComponent('gho_a b+c')}.28800; Path=/api/editor/token; Max-Age=60; HttpOnly; Secure; SameSite=Lax`), sc.join('|'));
  assert.ok(sc.some((c) => /^g42_state=; Path=\/api\/editor; Max-Age=0/.test(c)), sc.join('|'));
  assert.strictEqual(r.headers['Cache-Control'], 'no-store');
  assert.strictEqual(r.headers['Referrer-Policy'], 'no-referrer');
});

test('callback_ohne_ablauf', async () => {
  const { routes } = setup(ENV, { ok: true, json: async () => ({ access_token: 'tok' }) });
  const r = await call(routes['/api/editor/callback'], `/api/editor/callback?code=c&state=${NONCE}`, cookie());
  assert.strictEqual(r.headers.Location, '/editor/#angemeldet');
  assert.ok([].concat(r.headers['Set-Cookie']).includes('g42_token=tok.; Path=/api/editor/token; Max-Age=60; HttpOnly; Secure; SameSite=Lax'));
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
    assert.match([].concat(r.headers['Set-Cookie']).join('|'), /g42_state=; Path=\/api\/editor; Max-Age=0/);
    assert.ok(![].concat(r.headers['Set-Cookie']).some((c) => c.startsWith('g42_token=')), 'kein Token-Cookie bei Fehler');
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
  const names = ['login', 'callback', 'token', 'abmelden'];
  for (let i = 0; i < 20; i++) {
    const r = await call(routes['/api/editor/' + names[i % 4]], '/api/editor/x', HDR);
    assert.notStrictEqual(r.status, 429);
  }
  for (const n of names) assert.strictEqual((await call(routes['/api/editor/' + n], '/api/editor/x', HDR)).status, 429, n);
});

const HDR = { host: 'gruppe42.seitenschwung.com', 'x-g42-editor': '1', origin: 'https://gruppe42.seitenschwung.com' };
const TOKEN_COOKIE = { cookie: `g42_token=${encodeURIComponent('gho_a b+c.d')}.28800` };
const CLEAR = 'g42_token=; Path=/api/editor/token; Max-Age=0; HttpOnly; Secure; SameSite=Lax';

test('token_ok_und_einmalig', async () => {
  const { routes } = setup();
  assert.strictEqual(routes['/api/editor/token'].method, 'POST');
  const r = await call(routes['/api/editor/token'], '/api/editor/token', { ...HDR, ...TOKEN_COOKIE });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(JSON.parse(r.body), { token: 'gho_a b+c.d', ablauf: 28800 });
  assert.strictEqual(r.headers['Cache-Control'], 'no-store');
  assert.strictEqual(r.headers['Referrer-Policy'], 'no-referrer');
  assert.strictEqual(r.headers['Set-Cookie'], CLEAR);
  const again = await call(routes['/api/editor/token'], '/api/editor/token', HDR);
  assert.strictEqual(again.status, 401);
  assert.deepStrictEqual(JSON.parse(again.body), { error: 'kein_token' });
});

test('token_ohne_ablauf_und_ohne_origin', async () => {
  const { routes } = setup();
  const { origin, ...h } = HDR;
  const r = await call(routes['/api/editor/token'], '/api/editor/token', { ...h, cookie: 'g42_token=tok.' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(JSON.parse(r.body), { token: 'tok', ablauf: null });
});

test('token_kaputtes_cookie_401', async () => {
  const { routes } = setup();
  for (const c of ['g42_token=', 'g42_token=abc', 'g42_token=.5', 'g42_token=tok.x', 'g42_token=%E0%A4%A.1']) {
    const r = await call(routes['/api/editor/token'], '/api/editor/token', { ...HDR, cookie: c });
    assert.strictEqual(r.status, 401, c);
  }
});

test('token_herkunft_403', async () => {
  const bad = [
    ['ohne Header', { host: HDR.host, origin: HDR.origin, ...TOKEN_COOKIE }],
    ['Header 0', { ...HDR, 'x-g42-editor': '0', ...TOKEN_COOKIE }],
    ['fremder Origin', { ...HDR, origin: 'https://evil.example', ...TOKEN_COOKIE }],
    ['http Origin', { ...HDR, origin: 'http://gruppe42.seitenschwung.com', ...TOKEN_COOKIE }],
    ['Origin null', { ...HDR, origin: 'null', ...TOKEN_COOKIE }],
    ['Origin mit Pfad', { ...HDR, origin: 'https://gruppe42.seitenschwung.com/x', ...TOKEN_COOKIE }],
  ];
  for (const [name, h] of bad) {
    const { routes, calls } = setup();
    for (const n of ['token', 'abmelden']) {
      const r = await call(routes['/api/editor/' + n], '/api/editor/' + n, h, n === 'abmelden' ? { token: 't' } : undefined);
      assert.strictEqual(r.status, 403, name + n);
      assert.deepStrictEqual(JSON.parse(r.body), { error: 'herkunft' }, name);
    }
    assert.strictEqual(calls.length, 0, name);
  }
  // http nur fuer localhost
  const { routes } = setup();
  const ok = await call(routes['/api/editor/token'], '/api/editor/token', { host: 'localhost:8080', 'x-g42-editor': '1', origin: 'http://localhost:8080', ...TOKEN_COOKIE });
  assert.strictEqual(ok.status, 200);
});

test('token_und_abmelden_ohne_env_503', async () => {
  const { routes } = setup({});
  for (const n of ['token', 'abmelden']) assert.strictEqual((await call(routes['/api/editor/' + n], '/x', HDR, { token: 't' })).status, 503);
});

test('abmelden_widerruft_bei_github', async () => {
  const { routes, calls } = setup(ENV, { ok: true, status: 204, json: async () => ({}) });
  assert.strictEqual(routes['/api/editor/abmelden'].method, 'POST');
  const r = await call(routes['/api/editor/abmelden'], '/api/editor/abmelden', HDR, { token: 'gho_tok' });
  assert.strictEqual(r.status, 204);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://api.github.com/applications/cid/token');
  const o = calls[0].opts;
  assert.strictEqual(o.method, 'DELETE');
  assert.strictEqual(o.headers.Authorization, 'Basic ' + Buffer.from('cid:csecret').toString('base64'));
  assert.strictEqual(o.headers.Accept, 'application/vnd.github+json');
  assert.strictEqual(o.headers['X-GitHub-Api-Version'], '2022-11-28');
  assert.deepStrictEqual(JSON.parse(o.body), { access_token: 'gho_tok' });
  assert.ok(o.signal);
});

test('abmelden_204_auch_bei_fehlern', async () => {
  for (const gh of [{ ok: false, status: 404 }, new Error('network')]) {
    const { routes } = setup(ENV, gh);
    const r = await call(routes['/api/editor/abmelden'], '/api/editor/abmelden', HDR, { token: 't' });
    assert.strictEqual(r.status, 204);
  }
  // kaputter oder fehlender Body: kein GitHub-Aufruf, trotzdem 204
  for (const b of ['nope', {}, { token: 5 }, { token: '' }]) {
    const { routes, calls } = setup();
    const r = await call(routes['/api/editor/abmelden'], '/api/editor/abmelden', HDR, b);
    assert.strictEqual(r.status, 204);
    assert.strictEqual(calls.length, 0);
  }
});
