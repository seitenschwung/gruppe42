'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const pk = require('./passkey');
const { neuerAuthenticator, cborKodieren, b64u, FLAGS } = require('./passkey-testhilfe');

const RP = 'gruppe42.seitenschwung.com';
const ORIGIN = 'https://gruppe42.seitenschwung.com';
const CH = Buffer.alloc(32, 7);
const basis = { challenge: CH, origin: ORIGIN, rpId: RP };

function abgelehnt(fn, grund) {
  assert.throws(fn, (e) => {
    assert.strictEqual(e.art, 'passkey');
    if (grund) assert.match(e.grund, grund);
    return true;
  });
}

function registriert(alg = -7) {
  const a = neuerAuthenticator({ alg });
  const antwort = a.registriere(basis);
  const passkey = pk.pruefeRegistrierung({ antwort, ...basis });
  return { a, passkey };
}

// --- Options ---
test('registrierungOptionen', () => {
  const o = pk.registrierungOptionen({ rpId: RP, rpName: 'Gruppe 42', userId: Buffer.from('u1'), userName: 'ingrid', challenge: CH });
  assert.deepStrictEqual(o, {
    rp: { id: RP, name: 'Gruppe 42' }, user: { id: b64u('u1'), name: 'ingrid', displayName: 'ingrid' },
    challenge: b64u(CH), pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    timeout: 300000, attestation: 'none', authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    excludeCredentials: [],
  });
  assert.doesNotThrow(() => JSON.stringify(o));
});

test('anmeldungOptionen', () => {
  assert.deepStrictEqual(pk.anmeldungOptionen({ rpId: RP, challenge: CH }),
    { rpId: RP, challenge: b64u(CH), timeout: 300000, userVerification: 'required', allowCredentials: [] });
});

// --- Registration ---
test('registrierung_es256_gueltig', () => {
  const { a, passkey } = registriert(-7);
  assert.strictEqual(passkey.id, a.id);
  assert.strictEqual(passkey.alg, -7);
  assert.strictEqual(passkey.jwk.kty, 'EC');
  assert.strictEqual(passkey.jwk.crv, 'P-256');
  assert.strictEqual(passkey.signCount, 0);
  assert.doesNotThrow(() => JSON.stringify(passkey));
});

test('registrierung_rs256_gueltig', () => {
  const { a, passkey } = registriert(-257);
  assert.strictEqual(passkey.id, a.id);
  assert.strictEqual(passkey.alg, -257);
  assert.strictEqual(passkey.jwk.kty, 'RSA');
});

test('registrierung_mit_erweiterungen_ok', () => {
  const a = neuerAuthenticator();
  const antwort = a.registriere({ ...basis, erweiterungen: new Map([['credProtect', 2]]) });
  assert.strictEqual(pk.pruefeRegistrierung({ antwort, ...basis }).alg, -7);
});

test('registrierung_challenge_als_string_ok', () => {
  const a = neuerAuthenticator();
  const antwort = a.registriere(basis);
  assert.strictEqual(pk.pruefeRegistrierung({ antwort, ...basis, challenge: b64u(CH) }).alg, -7);
});

test('registrierung_abgelehnt', async (t) => {
  const a = neuerAuthenticator();
  const faelle = {
    falsche_challenge: [{}, { challenge: Buffer.alloc(32, 8) }, /challenge/],
    challenge_andere_laenge: [{}, { challenge: Buffer.alloc(16, 7) }, /challenge/],
    falscher_type: [{ cdType: 'webauthn.get' }, {}, /type/],
    falscher_origin: [{ origin: 'https://evil.example' }, {}, /origin/],
    origin_mit_slash: [{ origin: ORIGIN + '/' }, {}, /origin/],
    falscher_rpIdHash: [{ rpIdHash: crypto.createHash('sha256').update('evil.example').digest() }, {}, /rpId/],
    falsche_rpId_erwartet: [{}, { rpId: 'seitenschwung.com' }, /rpId/],
    up_fehlt: [{ flags: FLAGS.UV | FLAGS.AT }, {}, /UP/],
    uv_fehlt: [{ flags: FLAGS.UP | FLAGS.AT }, {}, /UV/],
    at_fehlt: [{ flags: FLAGS.UP | FLAGS.UV }, {}, /AT/],
    crossOrigin_true: [{ clientData: { crossOrigin: true } }, {}, /crossOrigin/],
    fmt_packed: [{ fmt: 'packed', attStmt: { alg: -7, sig: Buffer.alloc(8) } }, {}, /fmt/],
    fmt_none_mit_attStmt: [{ attStmt: { x: 1 } }, {}, /attStmt/],
    unbekannter_alg: [{ coseAlg: -8 }, {}, /alg/],
    angehaengte_bytes: [{ anhang: Buffer.from([0]) }, {}, /authData/],
    kaputtes_cbor: [{ attestationRoh: Buffer.from([0xa3, 0x63, 0x66]) }, {}, /cbor/],
    id_ungleich_rawId: [{ rawId: b64u(Buffer.alloc(16)) }, {}, /rawId/],
    type_falsch: [{ type: 'password' }, {}, /type/],
    clientData_kein_json: [{ clientDataRoh: 'nicht json' }, {}, /clientData/],
  };
  for (const [name, [reg, pruef, grund]] of Object.entries(faelle)) {
    await t.test(name, () => {
      const antwort = a.registriere({ ...basis, ...reg });
      abgelehnt(() => pk.pruefeRegistrierung({ antwort, ...basis, ...pruef }), grund);
    });
  }
});

test('registrierung_ec_punkt_nicht_auf_kurve', () => {
  const a = neuerAuthenticator();
  const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.alloc(32, 1)], [-3, Buffer.alloc(32, 2)]]);
  abgelehnt(() => pk.pruefeRegistrierung({ antwort: a.registriere({ ...basis, cose }), ...basis }), /schluessel/);
});

test('registrierung_cose_falsche_kurve_oder_kty', () => {
  const a = neuerAuthenticator();
  for (const cose of [
    new Map([[1, 2], [3, -7], [-1, 2], [-2, Buffer.alloc(32)], [-3, Buffer.alloc(32)]]),
    new Map([[1, 3], [3, -7], [-1, Buffer.alloc(256)], [-2, Buffer.from([1, 0, 1])]]),
    new Map([[1, 2], [3, -257], [-1, 1], [-2, Buffer.alloc(32)], [-3, Buffer.alloc(32)]]),
    new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.alloc(31)], [-3, Buffer.alloc(32)]]),
  ]) {
    abgelehnt(() => pk.pruefeRegistrierung({ antwort: a.registriere({ ...basis, cose }), ...basis }));
  }
});

test('registrierung_rsa_kleiner_modulus', () => {
  const a = neuerAuthenticator({ alg: -257, modulusLength: 1024 });
  abgelehnt(() => pk.pruefeRegistrierung({ antwort: a.registriere(basis), ...basis }), /schluessel/);
});

test('fehler_ohne_geheimnisse', () => {
  const a = neuerAuthenticator();
  const antwort = a.registriere({ ...basis, origin: 'https://evil.example' });
  try { pk.pruefeRegistrierung({ antwort, ...basis }); assert.fail('nicht abgelehnt'); } catch (e) {
    assert.ok(e instanceof Error);
    assert.ok(!e.message.includes(b64u(CH)) && !e.grund.includes(b64u(CH)));
  }
});

test('eingabe_falsche_form', () => {
  for (const antwort of [null, 'x', {}, { id: 'a', rawId: 'a', type: 'public-key' },
    { id: 'a', rawId: 'a', type: 'public-key', response: { clientDataJSON: 'a+b', attestationObject: 'AA' } },
    { id: 'a', rawId: 'a', type: 'public-key', response: { clientDataJSON: 'AA==', attestationObject: 'AA' } }]) {
    abgelehnt(() => pk.pruefeRegistrierung({ antwort, ...basis }));
  }
});

// --- Authentication ---
test('anmeldung_gueltig_es256_und_rs256', () => {
  for (const alg of [-7, -257]) {
    const { a, passkey } = registriert(alg);
    const r = pk.pruefeAnmeldung({ antwort: a.melde({ ...basis, userHandle: Buffer.from('u1') }), ...basis, passkey });
    assert.deepStrictEqual(r, { signCount: 1 });
  }
});

test('anmeldung_signcount_null_bleibt_ok', () => {
  const { a, passkey } = registriert();
  for (let i = 0; i < 2; i++) {
    assert.deepStrictEqual(pk.pruefeAnmeldung({ antwort: a.melde({ ...basis, signCount: 0 }), ...basis, passkey }), { signCount: 0 });
  }
});

test('anmeldung_signcount', () => {
  const { a, passkey } = registriert();
  const p = { ...passkey, signCount: 5 };
  assert.deepStrictEqual(pk.pruefeAnmeldung({ antwort: a.melde({ ...basis, signCount: 6 }), ...basis, passkey: p }), { signCount: 6 });
  abgelehnt(() => pk.pruefeAnmeldung({ antwort: a.melde({ ...basis, signCount: 5 }), ...basis, passkey: p }), /signCount/);
  abgelehnt(() => pk.pruefeAnmeldung({ antwort: a.melde({ ...basis, signCount: 4 }), ...basis, passkey: p }), /signCount/);
  abgelehnt(() => pk.pruefeAnmeldung({ antwort: a.melde({ ...basis, signCount: 0 }), ...basis, passkey: p }), /signCount/);
});

test('anmeldung_abgelehnt', async (t) => {
  for (const alg of [-7, -257]) {
    const { a, passkey } = registriert(alg);
    const faelle = {
      falsche_challenge: [{}, { challenge: Buffer.alloc(32, 9) }, /challenge/],
      falscher_type: [{ cdType: 'webauthn.create' }, {}, /type/],
      falscher_origin: [{ origin: 'http://gruppe42.seitenschwung.com' }, {}, /origin/],
      falscher_rpIdHash: [{ rpIdHash: Buffer.alloc(32) }, {}, /rpId/],
      up_fehlt: [{ flags: FLAGS.UV }, {}, /UP/],
      uv_fehlt: [{ flags: FLAGS.UP }, {}, /UV/],
      crossOrigin_true: [{ clientData: { crossOrigin: true } }, {}, /crossOrigin/],
      angehaengte_bytes: [{ anhang: Buffer.from([1]) }, {}, /authData/],
      id_ungleich_rawId: [{ rawId: b64u(Buffer.alloc(16)) }, {}, /rawId/],
      fremder_passkey: [{}, { passkey: { ...passkey, id: b64u(Buffer.alloc(16, 3)) } }, /id/],
    };
    for (const [name, [an, pruef, grund]] of Object.entries(faelle)) {
      await t.test(`${alg}_${name}`, () => {
        abgelehnt(() => pk.pruefeAnmeldung({ antwort: a.melde({ ...basis, ...an }), ...basis, passkey, ...pruef }), grund);
      });
    }
    await t.test(`${alg}_manipulierte_signatur`, () => {
      const antwort = a.melde(basis);
      const sig = Buffer.from(antwort.response.signature, 'base64url');
      sig[sig.length - 1] ^= 1;
      antwort.response.signature = b64u(sig);
      abgelehnt(() => pk.pruefeAnmeldung({ antwort, ...basis, passkey }), /signatur/);
    });
    await t.test(`${alg}_manipulierte_authdata`, () => {
      const antwort = a.melde(basis);
      const ad = Buffer.from(antwort.response.authenticatorData, 'base64url');
      ad[33] = ad[33] | 0x02; // flip a reserved flag bit: signature no longer matches
      antwort.response.authenticatorData = b64u(ad);
      abgelehnt(() => pk.pruefeAnmeldung({ antwort, ...basis, passkey }), /signatur/);
    });
    await t.test(`${alg}_anderer_schluessel`, () => {
      const fremd = neuerAuthenticator({ alg });
      const antwort = fremd.melde(basis);
      abgelehnt(() => pk.pruefeAnmeldung({ antwort, ...basis, passkey: { ...passkey, id: antwort.id } }), /signatur/);
    });
  }
});

test('anmeldung_unbekannter_alg_im_passkey', () => {
  const { a, passkey } = registriert();
  abgelehnt(() => pk.pruefeAnmeldung({ antwort: a.melde(basis), ...basis, passkey: { ...passkey, alg: -8 } }), /alg/);
  abgelehnt(() => pk.pruefeAnmeldung({ antwort: a.melde(basis), ...basis, passkey: { ...passkey, alg: -257 } }), /alg|schluessel/);
});

// --- CBOR ---
test('cbor_dekodiert', () => {
  const m = pk.cbor(cborKodieren(new Map([[1, 2], [-1, Buffer.from([1, 2])], ['a', [true, false, null, 'ü', 1000000]]])));
  assert.ok(m instanceof Map);
  assert.strictEqual(m.get(1), 2);
  assert.deepStrictEqual(m.get(-1), Buffer.from([1, 2]));
  assert.deepStrictEqual(m.get('a'), [true, false, null, 'ü', 1000000]);
});

test('cbor_abgelehnt', () => {
  const faelle = {
    leer: [],
    abgeschnitten: [0x42, 0x01],
    doppelter_schluessel: [0xa2, 0x01, 0x01, 0x01, 0x02],
    doppelter_text_schluessel: [0xa2, 0x61, 0x61, 0x01, 0x61, 0x61, 0x02],
    indefinite_bytes: [0x5f, 0x41, 0x00, 0xff],
    indefinite_array: [0x9f, 0x01, 0xff],
    indefinite_map: [0xbf, 0x01, 0x01, 0xff],
    tag: [0xc0, 0x01],
    float: [0xf9, 0x3c, 0x00],
    undefined: [0xf7],
    nachlauf: [0x01, 0x01],
    laenge_ueber_puffer: [0x5a, 0x00, 0x00, 0x10, 0x00, 0x01],
    acht_byte_laenge: [0x5b, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    acht_byte_riesig: [0x1b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
    reservierte_zusatzinfo: [0x1c],
    kaputtes_utf8: [0x61, 0xff],
    array_schluessel: [0xa1, 0x80, 0x01],
    zu_tief: [0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0x01],
  };
  for (const [name, bytes] of Object.entries(faelle)) {
    assert.throws(() => pk.cbor(Buffer.from(bytes)), (e) => e.art === 'passkey', name);
  }
  // too many items: array header claiming many entries
  const viele = Buffer.concat([Buffer.from([0x99, 0x27, 0x10]), Buffer.alloc(10000, 0x01)]);
  assert.throws(() => pk.cbor(viele), (e) => e.art === 'passkey');
  // tiefe 8 ist erlaubt
  assert.deepStrictEqual(pk.cbor(Buffer.from([0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0x01])), [[[[[[[1]]]]]]]);
});

test('challenge_vergleich_mit_timingSafeEqual', () => {
  const orig = crypto.timingSafeEqual;
  let aufrufe = 0;
  crypto.timingSafeEqual = (x, y) => { aufrufe++; return orig(x, y); };
  try {
    const a = neuerAuthenticator();
    pk.pruefeRegistrierung({ antwort: a.registriere(basis), ...basis });
    assert.ok(aufrufe >= 1);
  } finally { crypto.timingSafeEqual = orig; }
});
