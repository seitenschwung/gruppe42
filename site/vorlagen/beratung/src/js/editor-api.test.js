'use strict';
const test = require('node:test');
const assert = require('node:assert');
const A = require('./editor-api.js');

// Mock-fetch: merkt sich Aufrufe und antwortet mit status/body (oder wirft für "netz").
function mock(status, body, opt = {}) {
  const aufrufe = [];
  const fn = async (url, init) => {
    aufrufe.push({ url, init });
    if (opt.wirft) throw new TypeError('Failed to fetch');
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => { if (opt.keinJson) throw new SyntaxError('kein JSON'); return body; },
    };
  };
  return { fn, aufrufe };
}

async function fehlerVon(p) {
  try { await p; } catch (e) { return e; }
  assert.fail('kein Fehler');
}

test('header_und_credentials: jede Anfrage mit X-G42-Editor und same-origin', async () => {
  const m = mock(200, { ok: true });
  const api = A.erstelle(m.fn);
  await api.stand();
  await api.speichern('antreiber-test', [{ datei: 'test', pfad: 'name', alt: 'a', neu: 'b' }]);
  await api.verlauf('antreiber test');
  await api.rueckgaengig(3);
  await api.anmeldenStart();
  await api.anmeldenEnde({ id: 'x' });
  await api.registrierenStart('code');
  await api.registrierenEnde('code', { id: 'x' });
  await api.abmelden();
  for (const a of m.aufrufe) {
    assert.strictEqual(a.init.headers['X-G42-Editor'], '1', a.url);
    assert.strictEqual(a.init.credentials, 'same-origin', a.url);
    assert.strictEqual(a.init.cache, 'no-store', a.url);
  }
  const [stand, speichern, verlauf, rueck, aStart, aEnde, rStart, rEnde, ab] = m.aufrufe;
  assert.strictEqual(stand.url, '/api/editor/stand');
  assert.strictEqual(stand.init.method, 'GET');
  assert.strictEqual(stand.init.body, undefined);
  assert.strictEqual(speichern.url, '/api/editor/speichern');
  assert.strictEqual(speichern.init.method, 'POST');
  assert.strictEqual(speichern.init.headers['Content-Type'], 'application/json');
  assert.deepStrictEqual(JSON.parse(speichern.init.body),
    { testId: 'antreiber-test', aenderungen: [{ datei: 'test', pfad: 'name', alt: 'a', neu: 'b' }] });
  assert.strictEqual(verlauf.url, '/api/editor/verlauf?testId=antreiber%20test');
  assert.deepStrictEqual(JSON.parse(rueck.init.body), { nr: 3 });
  assert.strictEqual(aStart.url, '/api/editor/anmelden/start');
  assert.deepStrictEqual(JSON.parse(aEnde.init.body), { antwort: { id: 'x' } });
  assert.deepStrictEqual(JSON.parse(rStart.init.body), { einladung: 'code' });
  assert.deepStrictEqual(JSON.parse(rEnde.init.body), { einladung: 'code', antwort: { id: 'x' } });
  assert.strictEqual(ab.url, '/api/editor/abmelden');
});

test('erfolg: Antwort-JSON wird zurückgegeben', async () => {
  const api = A.erstelle(mock(200, { nr: 4, zeit: 'z', live: true }).fn);
  assert.deepStrictEqual(await api.speichern('t', []), { nr: 4, zeit: 'z', live: true });
});

test('fehler_mapping: 401/403/404/409/422/429/503', async () => {
  const fall = async (status, body) => fehlerVon(A.erstelle(mock(status, body).fn).stand());
  assert.strictEqual((await fall(401, { error: 'anmeldung' })).art, 'anmeldung');
  assert.strictEqual((await fall(403, { error: 'herkunft' })).art, 'herkunft');
  assert.strictEqual((await fall(404, { error: 'unbekannt' })).art, 'unbekannt');
  const k = await fall(409, { error: 'konflikt', pfad: 'questions[2].text' });
  assert.strictEqual(k.art, 'konflikt');
  assert.strictEqual(k.pfad, 'questions[2].text');
  const u = await fall(422, { error: 'ungueltig', meldungen: [{ pfad: 'name', meldung: 'Darf nicht leer sein' }] });
  assert.strictEqual(u.art, 'ungueltig');
  assert.deepStrictEqual(u.meldungen, [{ pfad: 'name', meldung: 'Darf nicht leer sein' }]);
  assert.strictEqual((await fall(429, { error: 'rate_limited' })).art, 'zuviele');
  const aus = await fall(503, { error: 'editor_aus', grund: 'nicht_schreibbar' });
  assert.strictEqual(aus.art, 'aus');
  assert.strictEqual(aus.grund, 'nicht_schreibbar');
  // 503 ohne grund: leer (die Oberfläche zeigt dann eine neutrale Meldung)
  assert.strictEqual((await fall(503, { error: 'editor_aus' })).grund, '');
  // 400 der Einrichtung: art fehler, code aus der Antwort
  const e = await fall(400, { error: 'einladung' });
  assert.strictEqual(e.art, 'fehler');
  assert.strictEqual(e.code, 'einladung');
  assert.strictEqual(e.status, 400);
  const i = await fall(500, { error: 'intern' });
  assert.strictEqual(i.art, 'fehler');
  assert.strictEqual(i.status, 500);
});

test('fehler_mapping: unlesbare Antworten und Netzfehler', async () => {
  const netz = await fehlerVon(A.erstelle(mock(0, null, { wirft: true }).fn).stand());
  assert.strictEqual(netz.art, 'netz');
  const kaputt = await fehlerVon(A.erstelle(mock(502, null, { keinJson: true }).fn).stand());
  assert.strictEqual(kaputt.art, 'fehler');
  assert.strictEqual(kaputt.status, 502);
  // 200 ohne JSON ist ein Fehler, kein leeres Ergebnis
  assert.strictEqual((await fehlerVon(A.erstelle(mock(200, null, { keinJson: true }).fn).stand())).art, 'fehler');
  // 409 ohne pfad / 422 ohne Liste: Felder bleiben in sicherer Form
  const k = await fehlerVon(A.erstelle(mock(409, {}).fn).stand());
  assert.strictEqual(k.pfad, '');
  const u = await fehlerVon(A.erstelle(mock(422, { meldungen: 'x' }).fn).stand());
  assert.deepStrictEqual(u.meldungen, []);
  assert.ok(netz instanceof Error);
});

test('fetch_festgehalten: spätere Änderung an globalThis.fetch wirkt nicht', async () => {
  const m = mock(200, { ok: 1 });
  const api = A.erstelle(m.fn);
  const vorher = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('fremd'); };
  try { await api.stand(); } finally { globalThis.fetch = vorher; }
  assert.strictEqual(m.aufrufe.length, 1);
});
