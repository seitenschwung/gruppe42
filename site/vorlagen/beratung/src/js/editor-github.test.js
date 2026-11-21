'use strict';
const test = require('node:test');
const assert = require('node:assert');
const G = require('./editor-github.js');

const API = 'https://api.github.com';
const REPO = 'seitenschwung/gruppe42';
const R = API + '/repos/' + REPO;

// Mock-fetch: routen = { 'METHODE url': antwort | (opt) => antwort }, Antwort = {status?, body}
function mock(routen) {
  const aufrufe = [];
  const fetch = async (url, opt) => {
    const body = opt.body ? JSON.parse(opt.body) : undefined;
    aufrufe.push({ m: opt.method, url, body, headers: opt.headers });
    const r = routen[opt.method + ' ' + url];
    if (!r) return { ok: false, status: 404, json: async () => ({}) };
    const a = typeof r === 'function' ? r(body) : r;
    const status = a.status || 200;
    return { ok: status >= 200 && status < 300, status, json: async () => a.body };
  };
  return { aufrufe, fetch };
}
const ctxMit = (m, extra) => Object.assign({ token: 'tok', fetch: m.fetch, repo: REPO, basis: 'main',
  jetzt: () => new Date(2026, 10, 21, 9, 5) }, extra);
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

const schreibRoutenBasis = (ref) => ({
  ['GET ' + R + '/git/ref/heads/' + ref]: { body: { object: { sha: 'kopf1' } } },
  ['GET ' + R + '/git/commits/kopf1']: { body: { tree: { sha: 'baum1' } } },
  ['POST ' + R + '/git/blobs']: (b) => ({ body: { sha: 'blob-' + b.content.length } }),
  ['POST ' + R + '/git/trees']: { body: { sha: 'baum2' } },
  ['POST ' + R + '/git/commits']: { body: { sha: 'commit2' } },
});
const dateien = [{ pfad: 'site/a.json', text: '{"x":"Führung"}\n' }, { pfad: 'site/b.json', text: '{}\n' }];

test('ohne_schreibrecht', async () => {
  const m = mock({
    ['GET ' + API + '/user']: { body: { login: 'ingrid' } },
    ['GET ' + R]: { body: { permissions: { push: false, pull: true } } },
  });
  assert.deepStrictEqual(await G.zugriff(ctxMit(m)), { login: 'ingrid', darfSchreiben: false });
  assert.strictEqual(m.aufrufe[0].headers.Authorization, 'Bearer tok');
  assert.strictEqual(m.aufrufe[0].headers.Accept, 'application/vnd.github+json');
  assert.strictEqual(m.aufrufe[0].headers['X-GitHub-Api-Version'], '2022-11-28');
  const m2 = mock({
    ['GET ' + API + '/user']: { body: { login: 'x' } },
    ['GET ' + R]: { body: { permissions: { push: true } } },
  });
  assert.strictEqual((await G.zugriff(ctxMit(m2))).darfSchreiben, true);
});

test('umlaute_dekodieren', async () => {
  const m = mock({
    ['GET ' + R + '/contents/site/kunden/gruppe42/tests/a.json?ref=main']:
      { body: { content: b64('{"n":"Führungsstil – „Größe“"}').replace(/(.{20})/g, '$1\n'), sha: 's1' } },
  });
  const r = await G.ladeDatei(ctxMit(m), 'site/kunden/gruppe42/tests/a.json', 'main');
  assert.strictEqual(r.text, '{"n":"Führungsstil – „Größe“"}');
  assert.strictEqual(r.sha, 's1');
});

test('offener_pr_wird_weiterverwendet: kein neuer Ref, kein neuer PR', async () => {
  const routen = schreibRoutenBasis('inhalt/antreiber-2026-11-20-1000');
  routen['PATCH ' + R + '/git/refs/heads/inhalt/antreiber-2026-11-20-1000'] = { body: {} };
  const m = mock(routen);
  const pr = { nummer: 7, branch: 'inhalt/antreiber-2026-11-20-1000', url: 'https://github.com/x/pull/7' };
  const r = await G.sende(ctxMit(m), { testId: 'antreiber', dateien, titel: 'Inhalt: T (1 Änderung)', text: 'x', pr });
  assert.deepStrictEqual(r, { nummer: 7, url: pr.url, branch: pr.branch });
  assert.ok(!m.aufrufe.some((a) => a.m === 'POST' && a.url === R + '/git/refs'));
  assert.ok(!m.aufrufe.some((a) => a.url === R + '/pulls'));
  const patch = m.aufrufe.find((a) => a.m === 'PATCH');
  assert.deepStrictEqual(patch.body, { sha: 'commit2', force: false });
  const commit = m.aufrufe.find((a) => a.url === R + '/git/commits' && a.m === 'POST');
  assert.deepStrictEqual(commit.body.parents, ['kopf1']);
});

test('neuer_pr: Reihenfolge ref, blobs, tree, commit, ref anlegen, pulls', async () => {
  const routen = schreibRoutenBasis('main');
  routen['POST ' + R + '/git/refs'] = { body: {} };
  routen['POST ' + R + '/pulls'] = { body: { number: 12, html_url: 'https://github.com/x/pull/12' } };
  const m = mock(routen);
  const r = await G.sende(ctxMit(m), { testId: 'antreiber', dateien, titel: 'Inhalt: T (2 Änderungen)', text: 'Beschreibung' });
  assert.deepStrictEqual(r, { nummer: 12, url: 'https://github.com/x/pull/12', branch: 'inhalt/antreiber-2026-11-21-0905' });
  assert.deepStrictEqual(m.aufrufe.map((a) => a.m + ' ' + a.url.replace(R, '')), [
    'GET /git/ref/heads/main', 'GET /git/commits/kopf1', 'POST /git/blobs', 'POST /git/blobs',
    'POST /git/trees', 'POST /git/commits', 'POST /git/refs', 'POST /pulls',
  ]);
  const blob = m.aufrufe.find((a) => a.url.endsWith('/git/blobs'));
  assert.strictEqual(blob.body.encoding, 'base64');
  assert.strictEqual(Buffer.from(blob.body.content, 'base64').toString('utf8'), dateien[0].text);
  const baum = m.aufrufe.find((a) => a.url.endsWith('/git/trees'));
  assert.strictEqual(baum.body.base_tree, 'baum1');
  assert.deepStrictEqual(baum.body.tree.map((t) => t.path), ['site/a.json', 'site/b.json']);
  const commit = m.aufrufe.find((a) => a.url.endsWith('/git/commits') && a.m === 'POST');
  assert.strictEqual(commit.body.message, 'Inhalt: T (2 Änderungen)');
  assert.deepStrictEqual(commit.body.tree, 'baum2');
  assert.deepStrictEqual(m.aufrufe.find((a) => a.url.endsWith('/git/refs')).body,
    { ref: 'refs/heads/inhalt/antreiber-2026-11-21-0905', sha: 'commit2' });
  assert.deepStrictEqual(m.aufrufe.find((a) => a.url.endsWith('/pulls')).body,
    { title: 'Inhalt: T (2 Änderungen)', head: 'inhalt/antreiber-2026-11-21-0905', base: 'main', body: 'Beschreibung' });
});

test('abgelaufen_401', async () => {
  const m = mock({ ['GET ' + API + '/user']: { status: 401, body: {} } });
  await assert.rejects(G.zugriff(ctxMit(m)), (e) => e instanceof Error && e.art === 'abgelaufen');
  const m2 = mock({ ['GET ' + R + '/pulls?state=open&per_page=100']: { status: 401, body: {} } });
  await assert.rejects(G.offenerPr(ctxMit(m2), 'antreiber'), { art: 'abgelaufen' });
});

test('konflikt_422 und andere Fehler', async () => {
  const routen = schreibRoutenBasis('main');
  routen['POST ' + R + '/git/refs'] = { status: 422, body: { message: 'Reference already exists' } };
  await assert.rejects(G.sende(ctxMit(mock(routen)), { testId: 'a', dateien, titel: 't', text: 'x' }), { art: 'konflikt' });
  const r2 = schreibRoutenBasis('inhalt/a-1');
  r2['PATCH ' + R + '/git/refs/heads/inhalt/a-1'] = { status: 409, body: {} };
  await assert.rejects(
    G.sende(ctxMit(mock(r2)), { testId: 'a', dateien, titel: 't', text: 'x', pr: { nummer: 1, branch: 'inhalt/a-1', url: 'u' } }),
    { art: 'konflikt' });
  const r3 = schreibRoutenBasis('main');
  r3['POST ' + R + '/git/trees'] = { status: 500, body: {} };
  await assert.rejects(G.sende(ctxMit(mock(r3)), { testId: 'a', dateien, titel: 't', text: 'x' }), { art: 'fehler', status: 500 });
});

test('offener_pr: Präfix und Repo müssen passen, Forks werden ignoriert', async () => {
  const pr = (nr, ref, repo) => ({ number: nr, html_url: 'u' + nr, head: { ref, repo: { full_name: repo } } });
  const m = mock({
    ['GET ' + R + '/pulls?state=open&per_page=100']: { body: [
      pr(1, 'inhalt/antreiber-2026-01-01-0000', 'fork/gruppe42'),
      pr(2, 'inhalt/teamklima-2026-01-01-0000', REPO),
      pr(3, 'inhalt/antreiber-2026-02-02-0000', REPO),
    ] },
  });
  assert.deepStrictEqual(await G.offenerPr(ctxMit(m), 'antreiber'),
    { nummer: 3, branch: 'inhalt/antreiber-2026-02-02-0000', url: 'u3' });
  assert.strictEqual(await G.offenerPr(ctxMit(m), 'fuehrungsstil'), null);
});

test('status: offen, gemergt, geschlossen', async () => {
  const m = mock({
    ['GET ' + R + '/pulls/1']: { body: { state: 'open', merged: false } },
    ['GET ' + R + '/pulls/2']: { body: { state: 'closed', merged: true, merge_commit_sha: 'abc' } },
    ['GET ' + R + '/pulls/3']: { body: { state: 'closed', merged: false } },
  });
  const c = ctxMit(m);
  assert.deepStrictEqual(await G.status(c, 1), { zustand: 'offen', mergeSha: null });
  assert.deepStrictEqual(await G.status(c, 2), { zustand: 'gemergt', mergeSha: 'abc' });
  assert.deepStrictEqual(await G.status(c, 3), { zustand: 'geschlossen', mergeSha: null });
});
