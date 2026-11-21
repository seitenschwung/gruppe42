'use strict';
// Wächter für die Selbsttests: stellt sicher, dass nur Textfelder geändert werden (Struktur bleibt fest)
// und dass die Texte den Regeln entsprechen. Reines Modul ohne Node-APIs – läuft im Build (Node) und im Browser-Editor.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Testwaechter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const TEXTFELDER_TEST = [
    'name', 'status',
    'scale.*',
    'categories[].name', 'categories[].headline', 'categories[].lowContext',
    'categories[].sections[].title', 'categories[].sections[].text',
    'questions[].text',
    'result.kicker', 'result.title', 'result.intro', 'result.outro', 'result.note',
    'result.highlight', 'result.lead', 'result.tie', 'result.lowLabel',
    'result.cta.text',
    'result.levels[].title', 'result.levels[].text',
  ];
  const TEXTFELDER_EINTRAG = ['titel', 'motto', 'intro', 'kurz', 'beschreibung'];
  const BETONT_ERLAUBT = ['result.title', 'motto'];
  const GRENZEN = { kurz: 120, mittel: 400, lang: 1500 };

  const KURZ = [
    'name', 'status', 'scale.*', 'categories[].name', 'categories[].sections[].title',
    'result.kicker', 'result.highlight', 'result.lowLabel', 'result.cta.text', 'result.levels[].title',
    'titel', 'motto', 'kurz',
  ];
  const MITTEL = [
    'questions[].text', 'categories[].headline', 'result.intro', 'intro', 'beschreibung', 'result.lead', 'result.tie',
  ];
  function grenzeFuer(muster) {
    if (KURZ.includes(muster)) return GRENZEN.kurz;
    if (MITTEL.includes(muster)) return GRENZEN.mittel;
    return GRENZEN.lang;
  }

  // Bidi-Steuerzeichen und Zeichen ohne Breite: unsichtbar, können Text verfälschen oder verschleiern.
  const STEUERZEICHEN = /[\u202A-\u202E\u2066-\u2069\u200B-\u200F\uFEFF]/;
  // C0-Steuerzeichen inkl. Zeilenumbruch und Tab: alle Textfelder sind einzeilig.
  const C0 = /[\u0000-\u001F]/;

  const MARKER = '<text>';
  const PLATZHALTER = '{names}';

  // Konkreter Pfad ("questions[3].text") -> Muster ("questions[].text"); Schlüssel unter scale -> "*".
  function muster(pfad) {
    return pfad.replace(/\[\d+\]/g, '[]').replace(/^scale\.[^.[]+$/, 'scale.*');
  }
  const unterschluessel = (pfad, schluessel) => (pfad ? pfad + '.' + schluessel : schluessel);
  const hat = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const istObjekt = (w) => w !== null && typeof w === 'object' && !Array.isArray(w);

  // Tiefe Kopie, bei der jeder String an einem Textfeld durch den Marker ersetzt wird.
  function struktur(daten, textfelder, pfad) {
    pfad = pfad || '';
    if (Array.isArray(daten)) return daten.map((w, i) => struktur(w, textfelder, pfad + '[' + i + ']'));
    if (istObjekt(daten)) {
      const aus = {};
      for (const k of Object.keys(daten)) {
        // defineProperty statt Zuweisung, damit auch ein eigener Schlüssel "__proto__" erhalten bleibt
        Object.defineProperty(aus, k, {
          value: struktur(daten[k], textfelder, unterschluessel(pfad, k)),
          enumerable: true, writable: true, configurable: true,
        });
      }
      return aus;
    }
    if (typeof daten === 'string' && textfelder.includes(muster(pfad))) {
      // Anzahl der Platzhalter zählt mit: die Engine ersetzt nur den ersten, daher ist genau einer erlaubt.
      return MARKER + PLATZHALTER.repeat(daten.split(PLATZHALTER).length - 1);
    }
    return daten;
  }

  function vergleiche(ist, soll, pfad, aus) {
    const bez = pfad || '(Wurzel)';
    if (Array.isArray(soll)) {
      if (!Array.isArray(ist)) { aus.push(bez + ': geändert'); return; }
      if (ist.length !== soll.length) { aus.push(bez + ': Anzahl ' + ist.length + ' statt ' + soll.length); return; }
      soll.forEach((w, i) => vergleiche(ist[i], w, pfad + '[' + i + ']', aus));
      return;
    }
    if (istObjekt(soll)) {
      if (!istObjekt(ist)) { aus.push(bez + ': geändert'); return; }
      for (const k of Object.keys(soll)) {
        const p = unterschluessel(pfad, k);
        if (!hat(ist, k)) aus.push(p + ': fehlt');
        else vergleiche(ist[k], soll[k], p, aus);
      }
      for (const k of Object.keys(ist)) {
        if (!hat(soll, k)) aus.push(unterschluessel(pfad, k) + ': unbekanntes Feld');
      }
      return;
    }
    if (ist === soll) return;
    const istText = typeof ist === 'string' && ist.startsWith(MARKER);
    if (soll === MARKER + PLATZHALTER && ist === MARKER) aus.push(bez + ': Platzhalter ' + PLATZHALTER + ' fehlt');
    else if (soll === MARKER + PLATZHALTER && istText && ist.length > soll.length) {
      aus.push(bez + ': Platzhalter ' + PLATZHALTER + ' mehrfach (nur einmal erlaubt)');
    } else if (soll === MARKER && istText) aus.push(bez + ': Platzhalter ' + PLATZHALTER + ' unerwartet');
    else aus.push(bez + ': geändert');
  }

  // Meldungen zu allem, was sich an der Struktur gegenüber dem erwarteten Abdruck geändert hat; [] = ok.
  function pruefeStruktur(daten, erwartet, textfelder) {
    const aus = [];
    vergleiche(struktur(daten, textfelder), erwartet, '', aus);
    return aus;
  }

  function sammleTextfelder(daten, textfelder, pfad, fn) {
    if (Array.isArray(daten)) daten.forEach((w, i) => sammleTextfelder(w, textfelder, pfad + '[' + i + ']', fn));
    else if (istObjekt(daten)) for (const k of Object.keys(daten)) sammleTextfelder(daten[k], textfelder, unterschluessel(pfad, k), fn);
    else if (textfelder.includes(muster(pfad))) fn(pfad, muster(pfad), daten);
  }

  // Prüft alle vorhandenen Textfelder gegen die Textregeln.
  function pruefeTexte(daten, textfelder) {
    const aus = [];
    sammleTextfelder(daten, textfelder, '', (pfad, m, wert) => {
      const melde = (meldung) => aus.push({ pfad, meldung });
      if (typeof wert !== 'string') return melde('Kein Text');
      if (!wert.trim()) return melde('Darf nicht leer sein');
      const grenze = grenzeFuer(m);
      if (wert.length > grenze) melde('Zu lang (' + wert.length + ' von maximal ' + grenze + ' Zeichen)');
      if (wert.includes('<')) melde('Das Zeichen "<" ist nicht erlaubt');
      if (wert.includes('*') && !BETONT_ERLAUBT.includes(m)) melde('Das Zeichen "*" ist hier nicht erlaubt');
      if (wert.includes('](')) melde('Links sind nicht erlaubt');
      if (C0.test(wert)) melde('Enthält Zeilenumbrüche oder Steuerzeichen – bitte als eine Zeile schreiben.');
      if (STEUERZEICHEN.test(wert)) melde('Enthält unsichtbare Steuerzeichen – bitte Text neu eintippen.');
      // Die Testseite hängt ". Kein Diagnoseinstrument." an den Status an.
      if (m === 'status' && /\.\s*$/.test(wert)) melde('Bitte ohne Punkt am Ende – er wird automatisch ergänzt.');
    });
    return aus;
  }

  return { TEXTFELDER_TEST, TEXTFELDER_EINTRAG, BETONT_ERLAUBT, GRENZEN, struktur, pruefeStruktur, pruefeTexte };
});
