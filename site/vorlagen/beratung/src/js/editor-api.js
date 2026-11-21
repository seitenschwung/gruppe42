// Editor-API im Browser: je Route eine Funktion, einheitliche Fehler. Ohne DOM.
// Fehler haben e.art: 'anmeldung' | 'herkunft' | 'aus' (+grund) | 'konflikt' (+pfad) | 'ungueltig' (+meldungen)
// | 'unbekannt' | 'zuviele' | 'netz' | 'fehler' (+status, +code aus der Antwort).
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EditorApi = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BASIS = '/api/editor/';

  function fehler(art, felder) {
    const e = new Error('Editor-API: ' + art);
    e.art = art;
    return Object.assign(e, felder || {});
  }

  // Status + Antwort-JSON (oder null) -> Fehler mit art.
  function fehlerAus(status, body) {
    const b = body && typeof body === 'object' ? body : {};
    switch (status) {
      case 401: return fehler('anmeldung', { status });
      case 403: return fehler('herkunft', { status });
      case 404: return fehler('unbekannt', { status });
      case 409: return fehler('konflikt', { status, pfad: typeof b.pfad === 'string' ? b.pfad : '' });
      case 422: return fehler('ungueltig', {
        status,
        meldungen: Array.isArray(b.meldungen)
          ? b.meldungen.filter((m) => m && typeof m.meldung === 'string').map((m) => ({ pfad: typeof m.pfad === 'string' ? m.pfad : '', meldung: m.meldung }))
          : [],
      });
      case 429: return fehler('zuviele', { status });
      case 503: return fehler('aus', { status, grund: typeof b.grund === 'string' && b.grund ? b.grund : 'aus' });
      default: return fehler('fehler', { status, code: typeof b.error === 'string' ? b.error : '' });
    }
  }

  // fetchFn wird einmal festgehalten; spätere Änderungen an window.fetch wirken nicht.
  function erstelle(fetchFn) {
    if (typeof fetchFn !== 'function') throw new Error('fetch fehlt');

    async function anfrage(methode, route, body) {
      const init = { method: methode, credentials: 'same-origin', cache: 'no-store', headers: { 'X-G42-Editor': '1' } };
      if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      let antwort;
      try { antwort = await fetchFn(BASIS + route, init); } catch (e) { throw fehler('netz'); }
      let daten = null;
      try { daten = await antwort.json(); } catch (e) { daten = null; }
      if (!antwort.ok) throw fehlerAus(antwort.status, daten);
      if (!daten || typeof daten !== 'object') throw fehler('fehler', { status: antwort.status, code: '' });
      return daten;
    }

    return {
      registrierenStart: (einladung) => anfrage('POST', 'registrieren/start', { einladung }),
      registrierenEnde: (einladung, antwort) => anfrage('POST', 'registrieren/ende', { einladung, antwort }),
      anmeldenStart: () => anfrage('POST', 'anmelden/start', {}),
      anmeldenEnde: (antwort) => anfrage('POST', 'anmelden/ende', { antwort }),
      abmelden: () => anfrage('POST', 'abmelden', {}),
      stand: () => anfrage('GET', 'stand'),
      speichern: (testId, aenderungen) => anfrage('POST', 'speichern', { testId, aenderungen }),
      verlauf: (testId) => anfrage('GET', 'verlauf?testId=' + encodeURIComponent(testId)),
      rueckgaengig: (nr) => anfrage('POST', 'rueckgaengig', { nr }),
    };
  }

  return { erstelle, fehlerAus };
});
