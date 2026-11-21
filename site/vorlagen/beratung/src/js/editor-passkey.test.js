'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('./editor-passkey.js');

const b = (...n) => new Uint8Array(n).buffer;
const bytes = (buf) => Array.from(new Uint8Array(buf));

test('base64url: Hin und zurück, ohne Padding, mit - und _', () => {
  for (let n = 0; n < 40; n++) {
    const roh = new Uint8Array(n).map((_, i) => (i * 37 + n * 11) & 0xff);
    const s = P.zuB64u(roh.buffer);
    assert.doesNotMatch(s, /[=+/]/);
    assert.strictEqual(s, Buffer.from(roh).toString('base64url'));
    assert.deepStrictEqual(bytes(P.vonB64u(s)), Array.from(roh));
  }
  assert.strictEqual(P.zuB64u(b(0xfb, 0xff, 0xbf)), '-_-_');
  // auch Views (Uint8Array mit Versatz) werden korrekt umgewandelt
  const gross = new Uint8Array([9, 1, 2, 3, 9]);
  assert.strictEqual(P.zuB64u(gross.subarray(1, 4)), Buffer.from([1, 2, 3]).toString('base64url'));
  assert.ok(P.vonB64u('AQID') instanceof ArrayBuffer);
  assert.throws(() => P.vonB64u('a+b/'), /base64url/);
  assert.throws(() => P.vonB64u('abc='), /base64url/);
  assert.throws(() => P.vonB64u(5), /base64url/);
});

test('erstellOptionen: challenge, user.id und excludeCredentials[].id werden ArrayBuffer', () => {
  const server = {
    rp: { id: 'localhost', name: 'Gruppe 42' },
    user: { id: 'AQID', name: 'Ingrid', displayName: 'Ingrid' },
    challenge: Buffer.alloc(32, 7).toString('base64url'),
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    timeout: 300000, attestation: 'none',
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    excludeCredentials: [{ type: 'public-key', id: 'BAUG' }],
  };
  const o = P.erstellOptionen(server);
  assert.deepStrictEqual(bytes(o.challenge), new Array(32).fill(7));
  assert.deepStrictEqual(bytes(o.user.id), [1, 2, 3]);
  assert.strictEqual(o.user.name, 'Ingrid');
  assert.deepStrictEqual(bytes(o.excludeCredentials[0].id), [4, 5, 6]);
  assert.strictEqual(o.excludeCredentials[0].type, 'public-key');
  assert.deepStrictEqual(o.authenticatorSelection, server.authenticatorSelection);
  assert.deepStrictEqual(o.pubKeyCredParams, server.pubKeyCredParams);
  assert.strictEqual(o.rp.id, 'localhost');
  assert.strictEqual(server.challenge.length > 0 && typeof server.challenge, 'string', 'Eingabe unverändert');
  assert.deepStrictEqual(P.erstellOptionen({ ...server, excludeCredentials: undefined }).excludeCredentials, []);
});

test('anmeldOptionen: challenge dekodiert, allowCredentials leer bleibt leer', () => {
  const o = P.anmeldOptionen({ rpId: 'localhost', challenge: 'AQID', timeout: 1, userVerification: 'required', allowCredentials: [] });
  assert.deepStrictEqual(bytes(o.challenge), [1, 2, 3]);
  assert.deepStrictEqual(o.allowCredentials, []);
  assert.strictEqual(o.rpId, 'localhost');
  assert.strictEqual(o.userVerification, 'required');
  const mit = P.anmeldOptionen({ rpId: 'x', challenge: 'AQID', allowCredentials: [{ type: 'public-key', id: 'BAUG' }] });
  assert.deepStrictEqual(bytes(mit.allowCredentials[0].id), [4, 5, 6]);
});

test('registrierungJson: kanonisches base64url, ohne toJSON', () => {
  const cred = {
    id: 'ignoriert', rawId: b(1, 2, 250), type: 'public-key',
    response: { clientDataJSON: b(123, 125), attestationObject: b(0xa0) },
    toJSON() { throw new Error('darf nicht benutzt werden'); },
  };
  assert.deepStrictEqual(P.registrierungJson(cred), {
    id: 'AQL6', rawId: 'AQL6', type: 'public-key',
    response: { clientDataJSON: 'e30', attestationObject: 'oA' },
  });
});

test('anmeldungJson: authenticatorData, signature, userHandle (oder null)', () => {
  const cred = {
    id: 'AQL6', rawId: b(1, 2, 250), type: 'public-key',
    response: { clientDataJSON: b(123, 125), authenticatorData: b(9), signature: b(0x30, 1), userHandle: b(7) },
  };
  assert.deepStrictEqual(P.anmeldungJson(cred), {
    id: 'AQL6', rawId: 'AQL6', type: 'public-key',
    response: { clientDataJSON: 'e30', authenticatorData: 'CQ', signature: 'MAE', userHandle: 'Bw' },
  });
  const ohne = P.anmeldungJson({ ...cred, response: { ...cred.response, userHandle: null } });
  assert.strictEqual(ohne.response.userHandle, null);
  const leer = P.anmeldungJson({ ...cred, response: { ...cred.response, userHandle: new ArrayBuffer(0) } });
  assert.strictEqual(leer.response.userHandle, null);
});

test('unterstuetzt: nur mit PublicKeyCredential und credentials.create/get', () => {
  const nav = { credentials: { create() {}, get() {} } };
  assert.strictEqual(P.unterstuetzt({ PublicKeyCredential: function () {}, navigator: nav }), true);
  assert.strictEqual(P.unterstuetzt({ navigator: nav }), false);
  assert.strictEqual(P.unterstuetzt({ PublicKeyCredential: function () {}, navigator: {} }), false);
  assert.strictEqual(P.unterstuetzt(undefined), false);
});

test('registriere/melde: ruft credentials auf, Abbruch wird art "abgebrochen"', async () => {
  let gesehen = null;
  const cred = { rawId: b(1), type: 'public-key', response: { clientDataJSON: b(2), attestationObject: b(3) } };
  const nav = { credentials: { create: async (o) => { gesehen = o; return cred; }, get: async () => { const e = new Error('x'); e.name = 'NotAllowedError'; throw e; } } };
  const r = await P.registriere({ rp: { id: 'l', name: 'n' }, user: { id: 'AQ', name: 'a', displayName: 'a' }, challenge: 'AQID' }, nav);
  assert.strictEqual(r.rawId, 'AQ');
  assert.ok(gesehen.publicKey.challenge instanceof ArrayBuffer);
  await assert.rejects(P.melde({ challenge: 'AQID' }, nav), (e) => e.art === 'abgebrochen');
  const doppelt = { credentials: { create: async () => { const e = new Error('x'); e.name = 'InvalidStateError'; throw e; } } };
  await assert.rejects(P.registriere({ user: { id: 'AQ' }, challenge: 'AQID' }, doppelt), (e) => e.art === 'vorhanden');
  const nichts = { credentials: { get: async () => null } };
  await assert.rejects(P.melde({ challenge: 'AQID' }, nichts), (e) => e.art === 'abgebrochen');
});
