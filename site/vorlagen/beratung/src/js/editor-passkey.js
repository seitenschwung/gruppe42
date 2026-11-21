// Passkey im Browser: Optionen vom Server (base64url) in WebAuthn-Optionen umwandeln und die Antwort des
// Browsers als JSON mit kanonischem base64url (ohne Padding) zurückgeben. credential.toJSON() wird bewusst
// nicht benutzt (fehlt z. B. in älterem Safari). Fehler haben e.art: 'abgebrochen' | 'vorhanden' | 'passkey'.
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EditorPasskey = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function fehler(art, text) {
    const e = new Error(text || art);
    e.art = art;
    return e;
  }

  function bytesVon(puffer) {
    if (puffer instanceof ArrayBuffer) return new Uint8Array(puffer);
    if (ArrayBuffer.isView(puffer)) return new Uint8Array(puffer.buffer, puffer.byteOffset, puffer.byteLength);
    throw new Error('Kein ArrayBuffer');
  }

  function zuB64u(puffer) {
    const b = bytesVon(puffer);
    let s = '';
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function vonB64u(text) {
    if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new Error('Kein base64url');
    const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b.buffer;
  }

  const liste = (l) => (Array.isArray(l) ? l : []).map((c) => Object.assign({}, c, { id: vonB64u(c.id) }));

  // Server-Optionen -> PublicKeyCredentialCreationOptions
  function erstellOptionen(o) {
    return Object.assign({}, o, {
      challenge: vonB64u(o.challenge),
      user: Object.assign({}, o.user, { id: vonB64u(o.user.id) }),
      excludeCredentials: liste(o.excludeCredentials),
    });
  }

  // Server-Optionen -> PublicKeyCredentialRequestOptions
  function anmeldOptionen(o) {
    return Object.assign({}, o, { challenge: vonB64u(o.challenge), allowCredentials: liste(o.allowCredentials) });
  }

  function huelle(cred, response) {
    const id = zuB64u(cred.rawId);
    return { id, rawId: id, type: cred.type, response };
  }

  function registrierungJson(cred) {
    const r = cred.response;
    return huelle(cred, { clientDataJSON: zuB64u(r.clientDataJSON), attestationObject: zuB64u(r.attestationObject) });
  }

  function anmeldungJson(cred) {
    const r = cred.response;
    const uh = r.userHandle && bytesVon(r.userHandle).length ? zuB64u(r.userHandle) : null;
    return huelle(cred, {
      clientDataJSON: zuB64u(r.clientDataJSON), authenticatorData: zuB64u(r.authenticatorData), signature: zuB64u(r.signature), userHandle: uh,
    });
  }

  function unterstuetzt(fenster) {
    const n = fenster && fenster.navigator;
    return !!(fenster && typeof fenster.PublicKeyCredential === 'function' && n && n.credentials
      && typeof n.credentials.create === 'function' && typeof n.credentials.get === 'function');
  }

  // Abbruch durch die Person (oder Zeitablauf) und "schon eingerichtet" sind eigene Fälle.
  function browserFehler(e) {
    if (e && e.art) return e;
    const name = e && e.name;
    if (name === 'NotAllowedError' || name === 'AbortError') return fehler('abgebrochen');
    if (name === 'InvalidStateError') return fehler('vorhanden');
    return fehler('passkey', (e && e.message) || 'Passkey-Fehler');
  }

  async function registriere(optionen, nav) {
    let cred;
    try {
      cred = await nav.credentials.create({ publicKey: erstellOptionen(optionen) });
    } catch (e) { throw browserFehler(e); }
    if (!cred) throw fehler('abgebrochen');
    return registrierungJson(cred);
  }

  async function melde(optionen, nav) {
    let cred;
    try {
      cred = await nav.credentials.get({ publicKey: anmeldOptionen(optionen) });
    } catch (e) { throw browserFehler(e); }
    if (!cred) throw fehler('abgebrochen');
    return anmeldungJson(cred);
  }

  return { zuB64u, vonB64u, erstellOptionen, anmeldOptionen, registrierungJson, anmeldungJson, unterstuetzt, registriere, melde };
});
