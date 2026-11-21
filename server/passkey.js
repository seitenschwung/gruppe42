'use strict';
// WebAuthn (passkey) verification without dependencies, following W3C WebAuthn Level 2 §7.1/§7.2 for the
// subset used by the editor: attestation "none", user verification required, ES256 (-7) and RS256 (-257).
// Inputs from the browser are the JSON form (base64url strings). Errors: Error with art 'passkey' and a
// short internal reason in grund (never secrets, challenges or key material).
const crypto = require('node:crypto');

const TIMEOUT = 300000;
const ALGS = [-7, -257];
const MAX_FELD = 16384; // max length of one base64url field
const MAX_TIEFE = 8;
const MAX_ELEMENTE = 1024;
const MAX_CRED_ID = 1023;
const UP = 0x01, UV = 0x04, BE = 0x08, BS = 0x10, AT = 0x40, ED = 0x80;

function fehler(grund) {
  const e = new Error('passkey: ' + grund);
  e.art = 'passkey';
  e.grund = grund;
  return e;
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');

// Strict base64url: alphabet only, no padding, canonical (re-encodes to the same string).
function vonB64u(s, feld) {
  if (typeof s !== 'string' || s.length > MAX_FELD || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) {
    throw fehler('base64url ' + feld);
  }
  const buf = Buffer.from(s, 'base64url');
  if (b64u(buf) !== s) throw fehler('base64url ' + feld);
  return buf;
}

const alsB64u = (wert, feld) => {
  if (Buffer.isBuffer(wert) || wert instanceof Uint8Array) return b64u(wert);
  if (typeof wert === 'string') { vonB64u(wert, feld); return wert; }
  throw fehler(feld);
};

function gleichSicher(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// --- CBOR (RFC 8949 subset): definite lengths only; unsigned/negative ints, byte/text strings, arrays,
// maps (always returned as Map, keys int or text, no duplicates), false/true/null. No tags, floats,
// indefinite lengths. Depth and total item count bounded.
function cborAb(buf, start) {
  if (!Buffer.isBuffer(buf)) throw fehler('cbor eingabe');
  let pos = start;
  let elemente = 0;
  const utf8 = new TextDecoder('utf-8', { fatal: true });

  function laenge(zusatz) {
    if (zusatz < 24) return zusatz;
    const n = { 24: 1, 25: 2, 26: 4, 27: 8 }[zusatz];
    if (!n) throw fehler('cbor zusatzinfo');
    if (pos + n > buf.length) throw fehler('cbor abgeschnitten');
    let wert;
    if (n === 8) {
      const big = buf.readBigUInt64BE(pos);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw fehler('cbor zahl zu gross');
      wert = Number(big);
    } else {
      wert = buf.readUIntBE(pos, n);
    }
    pos += n;
    return wert;
  }

  function bytes(n) {
    if (n > buf.length - pos) throw fehler('cbor laenge');
    const b = Buffer.from(buf.subarray(pos, pos + n));
    pos += n;
    return b;
  }

  function element(tiefe) {
    if (tiefe > MAX_TIEFE) throw fehler('cbor zu tief');
    if (++elemente > MAX_ELEMENTE) throw fehler('cbor zu viele elemente');
    if (pos >= buf.length) throw fehler('cbor abgeschnitten');
    const kopf = buf[pos++];
    const major = kopf >> 5;
    const zusatz = kopf & 0x1f;
    if (major === 7) {
      if (zusatz === 20) return false;
      if (zusatz === 21) return true;
      if (zusatz === 22) return null;
      throw fehler('cbor simple/float');
    }
    if (zusatz === 31) throw fehler('cbor indefinite');
    if (major === 6) throw fehler('cbor tag');
    const n = laenge(zusatz);
    switch (major) {
      case 0: return n;
      case 1: return -1 - n;
      case 2: return bytes(n);
      case 3:
        try { return utf8.decode(bytes(n)); } catch (e) { if (e.art) throw e; throw fehler('cbor utf8'); }
      case 4: {
        if (n > buf.length - pos) throw fehler('cbor laenge');
        const arr = [];
        for (let i = 0; i < n; i++) arr.push(element(tiefe + 1));
        return arr;
      }
      default: { // 5: map
        if (n * 2 > buf.length - pos) throw fehler('cbor laenge');
        const m = new Map();
        for (let i = 0; i < n; i++) {
          const k = element(tiefe + 1);
          if (typeof k !== 'number' && typeof k !== 'string') throw fehler('cbor schluesseltyp');
          if (m.has(k)) throw fehler('cbor doppelter schluessel');
          m.set(k, element(tiefe + 1));
        }
        return m;
      }
    }
  }

  const wert = element(1);
  return { wert, ende: pos };
}

function cbor(buf) {
  const { wert, ende } = cborAb(buf, 0);
  if (ende !== buf.length) throw fehler('cbor nachlauf');
  return wert;
}

// --- Options ---
function registrierungOptionen({ rpId, rpName, userId, userName, challenge }) {
  const uid = typeof userId === 'string' ? Buffer.from(userId, 'utf8') : Buffer.from(userId);
  if (uid.length < 1 || uid.length > 64) throw fehler('user.id laenge');
  return {
    rp: { id: rpId, name: rpName },
    user: { id: b64u(uid), name: userName, displayName: userName },
    challenge: alsB64u(challenge, 'challenge'),
    pubKeyCredParams: ALGS.map((alg) => ({ type: 'public-key', alg })),
    timeout: TIMEOUT,
    attestation: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    excludeCredentials: [],
  };
}

function anmeldungOptionen({ rpId, challenge }) {
  return { rpId, challenge: alsB64u(challenge, 'challenge'), timeout: TIMEOUT, userVerification: 'required', allowCredentials: [] };
}

// --- Shared steps ---
function pruefeHuelle(antwort, felder) {
  if (!antwort || typeof antwort !== 'object' || Array.isArray(antwort)) throw fehler('antwort form');
  if (antwort.type !== 'public-key') throw fehler('credential type');
  if (typeof antwort.id !== 'string' || antwort.id !== antwort.rawId) throw fehler('id/rawId');
  const id = vonB64u(antwort.rawId, 'rawId');
  if (id.length < 1 || id.length > MAX_CRED_ID) throw fehler('id laenge');
  const r = antwort.response;
  if (!r || typeof r !== 'object') throw fehler('response form');
  const aus = {};
  for (const f of felder) aus[f] = vonB64u(r[f], f);
  return { idBytes: id, ...aus };
}

// §7.1 steps 5-12 / §7.2 steps 10-15: clientDataJSON.
function pruefeClientData(roh, typ, challenge, origin) {
  let cd;
  try { cd = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(roh)); } catch { throw fehler('clientData json'); }
  if (!cd || typeof cd !== 'object' || Array.isArray(cd)) throw fehler('clientData form');
  if (cd.type !== typ) throw fehler('clientData type');
  if (typeof cd.challenge !== 'string' || !gleichSicher(cd.challenge, alsB64u(challenge, 'challenge'))) {
    throw fehler('clientData challenge');
  }
  if (typeof origin !== 'string' || !origin || cd.origin !== origin) throw fehler('clientData origin');
  if (cd.crossOrigin !== undefined && cd.crossOrigin !== false) throw fehler('clientData crossOrigin');
  return crypto.createHash('sha256').update(roh).digest();
}

// Parses authenticator data completely; no trailing bytes allowed.
function leseAuthData(ad, rpId) {
  if (ad.length < 37) throw fehler('authData kurz');
  if (typeof rpId !== 'string' || !rpId) throw fehler('rpId fehlt');
  const erwartet = crypto.createHash('sha256').update(rpId, 'utf8').digest();
  if (!crypto.timingSafeEqual(ad.subarray(0, 32), erwartet)) throw fehler('rpIdHash');
  const flags = ad[32];
  if (!(flags & UP)) throw fehler('flag UP');
  if (!(flags & UV)) throw fehler('flag UV');
  if ((flags & BS) && !(flags & BE)) throw fehler('flag BS ohne BE');
  const signCount = ad.readUInt32BE(33);
  let pos = 37;
  let credId = null;
  let cose = null;
  if (flags & AT) {
    if (ad.length < pos + 18) throw fehler('authData attested');
    pos += 16; // AAGUID (all zero for attestation none; not used)
    const len = ad.readUInt16BE(pos);
    pos += 2;
    if (len < 1 || len > MAX_CRED_ID || pos + len > ad.length) throw fehler('authData credentialId');
    credId = Buffer.from(ad.subarray(pos, pos + len));
    pos += len;
    const r = cborAb(ad, pos);
    cose = r.wert;
    pos = r.ende;
  }
  if (flags & ED) {
    const r = cborAb(ad, pos);
    if (!(r.wert instanceof Map)) throw fehler('authData extensions');
    pos = r.ende;
  }
  if (pos !== ad.length) throw fehler('authData nachlauf');
  return { flags, signCount, credId, cose };
}

// COSE_Key -> JWK. Only EC2/P-256/ES256 and RSA/RS256 (2048..8192 bits).
function coseZuJwk(cose) {
  if (!(cose instanceof Map)) throw fehler('cose form');
  const kty = cose.get(1);
  const alg = cose.get(3);
  if (!ALGS.includes(alg)) throw fehler('cose alg');
  for (const k of cose.keys()) if (typeof k !== 'number') throw fehler('cose schluessel');
  let jwk;
  if (alg === -7) {
    const x = cose.get(-2), y = cose.get(-3);
    if (kty !== 2 || cose.get(-1) !== 1) throw fehler('cose kty/crv');
    if (cose.has(-4)) throw fehler('cose privat');
    if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) throw fehler('cose ec koordinaten');
    jwk = { kty: 'EC', crv: 'P-256', x: b64u(x), y: b64u(y) };
  } else {
    const n = cose.get(-1), e = cose.get(-2);
    if (kty !== 3) throw fehler('cose kty');
    if (cose.has(-3) || cose.has(-4)) throw fehler('cose privat');
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e) || n.length < 1 || e.length < 1 || e.length > 8) throw fehler('cose rsa');
    jwk = { kty: 'RSA', n: b64u(n), e: b64u(e) };
  }
  oeffentlicherSchluessel(jwk, alg);
  return { jwk, alg };
}

// Builds a KeyObject from a stored JWK and checks it matches alg (curve on-point check is done by OpenSSL).
function oeffentlicherSchluessel(jwk, alg) {
  if (!ALGS.includes(alg)) throw fehler('alg');
  let key;
  try { key = crypto.createPublicKey({ key: jwk, format: 'jwk' }); } catch { throw fehler('schluessel ungueltig'); }
  const d = key.asymmetricKeyDetails || {};
  if (alg === -7) {
    if (key.asymmetricKeyType !== 'ec' || d.namedCurve !== 'prime256v1') throw fehler('schluessel typ');
  } else {
    if (key.asymmetricKeyType !== 'rsa') throw fehler('schluessel typ');
    if (!(d.modulusLength >= 2048 && d.modulusLength <= 8192)) throw fehler('schluessel rsa groesse');
    const e = d.publicExponent;
    if (typeof e !== 'bigint' || e < 3n || e % 2n === 0n) throw fehler('schluessel rsa exponent');
  }
  return key;
}

// --- §7.1 Registering a new credential ---
function pruefeRegistrierung({ antwort, challenge, origin, rpId }) {
  const h = pruefeHuelle(antwort, ['clientDataJSON', 'attestationObject']);
  pruefeClientData(h.clientDataJSON, 'webauthn.create', challenge, origin);
  const att = cbor(h.attestationObject);
  if (!(att instanceof Map) || att.size !== 3 || !att.has('fmt') || !att.has('attStmt') || !att.has('authData')) {
    throw fehler('attestationObject form');
  }
  if (att.get('fmt') !== 'none') throw fehler('attestation fmt');
  const stmt = att.get('attStmt');
  if (!(stmt instanceof Map) || stmt.size !== 0) throw fehler('attStmt nicht leer');
  const authData = att.get('authData');
  if (!Buffer.isBuffer(authData)) throw fehler('authData typ');
  const ad = leseAuthData(authData, rpId);
  if (!(ad.flags & AT)) throw fehler('flag AT');
  if (!ad.credId.equals(h.idBytes)) throw fehler('credentialId/rawId');
  const { jwk, alg } = coseZuJwk(ad.cose);
  return { id: b64u(ad.credId), jwk, alg, signCount: ad.signCount };
}

// --- §7.2 Verifying an authentication assertion ---
function pruefeAnmeldung({ antwort, challenge, origin, rpId, passkey }) {
  const h = pruefeHuelle(antwort, ['clientDataJSON', 'authenticatorData', 'signature']);
  if (!passkey || typeof passkey !== 'object' || passkey.id !== antwort.id) throw fehler('passkey id');
  const ud = antwort.response.userHandle;
  if (ud !== undefined && ud !== null) vonB64u(ud, 'userHandle');
  const key = oeffentlicherSchluessel(passkey.jwk, passkey.alg);
  const cdHash = pruefeClientData(h.clientDataJSON, 'webauthn.get', challenge, origin);
  const ad = leseAuthData(h.authenticatorData, rpId);
  if (ad.flags & AT) throw fehler('flag AT bei anmeldung');
  const daten = Buffer.concat([h.authenticatorData, cdHash]);
  let ok = false;
  try {
    ok = passkey.alg === -7
      ? crypto.verify('sha256', daten, { key, dsaEncoding: 'der' }, h.signature)
      : crypto.verify('sha256', daten, { key, padding: crypto.constants.RSA_PKCS1_PADDING }, h.signature);
  } catch { ok = false; }
  if (!ok) throw fehler('signatur');
  const alt = passkey.signCount;
  if (!Number.isInteger(alt) || alt < 0 || alt > 0xffffffff) throw fehler('passkey signCount');
  if ((ad.signCount !== 0 || alt !== 0) && ad.signCount <= alt) throw fehler('signCount');
  return { signCount: ad.signCount };
}

module.exports = { cbor, registrierungOptionen, anmeldungOptionen, pruefeRegistrierung, pruefeAnmeldung };
