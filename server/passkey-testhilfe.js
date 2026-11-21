'use strict';
// Test helper only (not copied into the image): a simulated WebAuthn authenticator that builds real
// CBOR, authenticator data and signatures with node:crypto, plus a tiny CBOR encoder.
const crypto = require('node:crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64url');

function kopf(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
  if (n < 0x100000000) { const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b; }
  const b = Buffer.alloc(9); b[0] = (major << 5) | 27; b.writeBigUInt64BE(BigInt(n), 1); return b;
}

// Encodes integers, Buffers, strings, arrays, Maps, plain objects (string keys), booleans and null.
function cborKodieren(w) {
  if (w === null) return Buffer.from([0xf6]);
  if (w === false) return Buffer.from([0xf4]);
  if (w === true) return Buffer.from([0xf5]);
  if (typeof w === 'number') {
    if (!Number.isInteger(w)) throw new Error('nur Ganzzahlen');
    return w >= 0 ? kopf(0, w) : kopf(1, -1 - w);
  }
  if (Buffer.isBuffer(w)) return Buffer.concat([kopf(2, w.length), w]);
  if (typeof w === 'string') { const b = Buffer.from(w, 'utf8'); return Buffer.concat([kopf(3, b.length), b]); }
  if (Array.isArray(w)) return Buffer.concat([kopf(4, w.length), ...w.map(cborKodieren)]);
  const paare = w instanceof Map ? [...w.entries()] : Object.entries(w);
  return Buffer.concat([kopf(5, paare.length), ...paare.flatMap(([k, v]) => [cborKodieren(k), cborKodieren(v)])]);
}

const UP = 0x01, UV = 0x04, AT = 0x40, ED = 0x80;

function neuerAuthenticator({ alg = -7, modulusLength = 2048 } = {}) {
  const paar = alg === -257
    ? crypto.generateKeyPairSync('rsa', { modulusLength })
    : crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = paar.publicKey.export({ format: 'jwk' });
  const credId = crypto.randomBytes(16);
  let zaehler = 0;

  function coseSchluessel(coseAlg) {
    if (alg === -257) {
      return new Map([[1, 3], [3, coseAlg], [-1, Buffer.from(jwk.n, 'base64url')], [-2, Buffer.from(jwk.e, 'base64url')]]);
    }
    return new Map([[1, 2], [3, coseAlg], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
  }

  function clientData(typ, o) {
    const cd = { type: typ, challenge: b64u(o.challenge), origin: o.origin, crossOrigin: false, ...(o.clientData || {}) };
    return Buffer.from(o.clientDataRoh !== undefined ? o.clientDataRoh : JSON.stringify(cd), 'utf8');
  }

  function authKopf(o, flags, signCount) {
    const sc = Buffer.alloc(4); sc.writeUInt32BE(signCount >>> 0, 0);
    const rpIdHash = o.rpIdHash || crypto.createHash('sha256').update(o.rpId).digest();
    return Buffer.concat([rpIdHash, Buffer.from([flags]), sc]);
  }

  // Registration response (navigator.credentials.create JSON form). Options allow manipulation for tests.
  function registriere(o) {
    const flags = o.flags !== undefined ? o.flags : (UP | UV | AT | (o.erweiterungen ? ED : 0));
    const idLen = Buffer.alloc(2); idLen.writeUInt16BE(credId.length, 0);
    const teile = [authKopf(o, flags, o.signCount || 0)];
    if (flags & AT) {
      teile.push(Buffer.alloc(16), idLen, credId, o.coseRoh || cborKodieren(o.cose || coseSchluessel(o.coseAlg !== undefined ? o.coseAlg : alg)));
    }
    if (o.erweiterungen) teile.push(cborKodieren(o.erweiterungen));
    if (o.anhang) teile.push(o.anhang);
    const authData = Buffer.concat(teile);
    const attObj = o.attestationRoh || cborKodieren({ fmt: o.fmt || 'none', attStmt: o.attStmt || {}, authData });
    const id = b64u(credId);
    return {
      id, rawId: o.rawId || id, type: o.type || 'public-key',
      response: { clientDataJSON: b64u(clientData(o.cdType || 'webauthn.create', o)), attestationObject: b64u(attObj) },
    };
  }

  // Authentication response (navigator.credentials.get JSON form).
  function melde(o) {
    const flags = o.flags !== undefined ? o.flags : (UP | UV);
    const signCount = o.signCount !== undefined ? o.signCount : ++zaehler;
    const authData = Buffer.concat([authKopf(o, flags, signCount), o.anhang || Buffer.alloc(0)]);
    const cdj = clientData(o.cdType || 'webauthn.get', o);
    const daten = Buffer.concat([authData, crypto.createHash('sha256').update(cdj).digest()]);
    const signatur = alg === -257
      ? crypto.sign('sha256', daten, { key: paar.privateKey, padding: crypto.constants.RSA_PKCS1_PADDING })
      : crypto.sign('sha256', daten, { key: paar.privateKey, dsaEncoding: 'der' });
    const id = b64u(credId);
    return {
      id, rawId: o.rawId || id, type: o.type || 'public-key',
      response: {
        clientDataJSON: b64u(cdj), authenticatorData: b64u(authData), signature: b64u(signatur),
        userHandle: o.userHandle !== undefined ? b64u(o.userHandle) : null,
      },
    };
  }

  return { id: b64u(credId), registriere, melde };
}

module.exports = { neuerAuthenticator, cborKodieren, b64u, FLAGS: { UP, UV, AT, ED } };
