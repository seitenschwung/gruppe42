// Editor-Kern: Felderliste, Labels, Änderungen, Entwürfe und Meldungstexte für den Test-Editor. Ohne DOM, ohne Node-APIs.
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../../../../lib/testwaechter'));
  else root.EditorKern = factory(root.Testwaechter);
})(typeof self !== 'undefined' ? self : this, function (Testwaechter) {
  'use strict';

  const istObjekt = (w) => w !== null && typeof w === 'object' && !Array.isArray(w);
  const GRUPPEN = ['start', 'skala', 'fragen', 'bereiche', 'ergebnis', 'stufen'];

  function muster(pfad) {
    return pfad.replace(/\[\d+\]/g, '[]').replace(/^scale\.[^.[]+$/, 'scale.*');
  }

  function teile(pfad) {
    const aus = [];
    pfad.replace(/([^.[\]]+)|\[(\d+)\]/g, (_, name, index) => {
      aus.push(name !== undefined ? name : Number(index));
      return '';
    });
    return aus;
  }

  function hole(obj, pfad) {
    let w = obj;
    for (const s of teile(pfad)) {
      if (w === null || typeof w !== 'object') return undefined;
      w = w[s];
    }
    return w;
  }

  // Neue Kopie mit geändertem Wert; nur der Pfad wird kopiert, das Original bleibt unverändert.
  function setze(obj, pfad, wert) {
    const schritte = teile(pfad);
    if (!schritte.length) throw new Error('Leerer Pfad');
    const rek = (knoten, i) => {
      const s = schritte[i];
      const artOk = Array.isArray(knoten) ? typeof s === 'number' : typeof s === 'string';
      if (knoten === null || typeof knoten !== 'object' || !artOk || !Object.prototype.hasOwnProperty.call(knoten, s)) {
        throw new Error('Pfad nicht vorhanden: ' + pfad);
      }
      const kopie = Array.isArray(knoten) ? knoten.slice() : Object.assign({}, knoten);
      kopie[s] = i === schritte.length - 1 ? wert : rek(knoten[s], i + 1);
      return kopie;
    };
    return rek(obj, 0);
  }

  const ERGEBNIS_LABEL = {
    'result.kicker': 'Ergebnis: Kurzzeile über dem Titel',
    'result.title': 'Ergebnis: Titel',
    'result.intro': 'Ergebnis: Einleitung',
    'result.outro': 'Ergebnis: Abschluss',
    'result.note': 'Ergebnis: Hinweis',
    'result.highlight': 'Ergebnis: Hervorhebung',
    'result.lead': 'Ergebnis: Einleitungssatz zu den stärksten Bereichen',
    'result.tie': 'Ergebnis: Text bei Gleichstand',
    'result.lowLabel': 'Ergebnis: Beschriftung für niedrige Werte',
    'result.cta.text': 'Ergebnis: Text des Buttons',
  };
  const EINTRAG_LABEL = {
    titel: 'Kachel und Seitenkopf: Titel', motto: 'Überschrift der Testseite', intro: 'Kachel und Seitenkopf: Einleitung',
    kurz: 'Kachel und Seitenkopf: Kurzinfo', beschreibung: 'Kachel und Seitenkopf: Beschreibung',
  };
  // Wo ein Feld auf der Website erscheint (Felder, deren Name allein mehrdeutig ist).
  const ERSCHEINT = {
    titel: 'Erscheint: als Titel der Kachel in der Übersicht der Selbsttests und als Kurzzeile über der Überschrift der Testseite.',
    motto: 'Erscheint: als Hauptüberschrift oben auf der Testseite.',
    intro: 'Erscheint: als Einleitung unter der Überschrift der Testseite.',
    kurz: 'Erscheint: als Schlagwort auf der Kachel und als erster Punkt unter „So funktioniert es“.',
    beschreibung: 'Erscheint: als Text auf der Kachel in der Übersicht der Selbsttests.',
    name: 'Erscheint: im Betreff, wenn jemand das Ergebnis per E-Mail verschickt, und im Titel des Browser-Tabs.',
    status: 'Erscheint: auf der Testseite unter „So funktioniert es“; dahinter wird automatisch „. Kein Diagnoseinstrument.“ ergänzt.',
    'result.tie': 'Erscheint: im Ergebnis, wenn kein Bereich klar vorne liegt. In der Vorschau mit „Gleichstand“ ansehen.',
  };
  const NAME_STATUS = { name: 'Name des Tests', status: 'Hinweis zum Status des Tests' };

  // Liefert {gruppe, label, hinweis?} für ein Textfeld des Tests.
  function beschreibeTestfeld(daten, pfad, m) {
    const s = teile(pfad);
    const bereichsName = (i) => '„' + (daten.categories[i] && daten.categories[i].name) + '“';
    if (NAME_STATUS[m]) return { gruppe: 'start', label: NAME_STATUS[m], hinweis: ERSCHEINT[m] };
    if (m === 'scale.*') return { gruppe: 'skala', label: 'Antwortstufe ' + s[1] };
    if (m === 'questions[].text') {
      const q = daten.questions[s[1]];
      const bereich = daten.categories.find((c) => c.id === q.category);
      return { gruppe: 'fragen', label: 'Frage ' + (s[1] + 1) + (bereich ? ' (Bereich „' + bereich.name + '“)' : '') };
    }
    if (m === 'categories[].name') return { gruppe: 'bereiche', label: 'Bereich ' + (s[1] + 1) + ': Name' };
    if (m === 'categories[].headline') return { gruppe: 'bereiche', label: 'Bereich ' + bereichsName(s[1]) + ': Überschrift' };
    if (m === 'categories[].lowContext') {
      return { gruppe: 'bereiche', label: 'Bereich ' + bereichsName(s[1]) + ': Hinweis bei niedrigem Wert' };
    }
    if (m === 'categories[].sections[].title' || m === 'categories[].sections[].text') {
      const teil = s[s.length - 1] === 'title' ? 'Titel' : 'Text';
      return { gruppe: 'bereiche', label: 'Bereich ' + bereichsName(s[1]) + ', Abschnitt ' + (s[3] + 1) + ': ' + teil };
    }
    if (m === 'result.levels[].title' || m === 'result.levels[].text') {
      const teil = s[s.length - 1] === 'title' ? 'Überschrift' : 'Text';
      return { gruppe: 'stufen', label: 'Stufe ab ' + daten.result.levels[s[2]].min + ' %: ' + teil };
    }
    const f = { gruppe: 'ergebnis', label: ERGEBNIS_LABEL[m] || pfad };
    if (ERSCHEINT[m]) f.hinweis = ERSCHEINT[m];
    if (m === 'result.lead' && typeof hole(daten, pfad) === 'string' && hole(daten, pfad).includes('{names}')) {
      f.hinweis = '{names} wird durch die stärksten Bereiche ersetzt und muss stehen bleiben.';
    }
    return f;
  }

  function sammle(knoten, pfad, textfelder, fn) {
    if (Array.isArray(knoten)) knoten.forEach((w, i) => sammle(w, pfad + '[' + i + ']', textfelder, fn));
    else if (istObjekt(knoten)) for (const k of Object.keys(knoten)) sammle(knoten[k], pfad ? pfad + '.' + k : k, textfelder, fn);
    else if (typeof knoten === 'string' && textfelder.includes(muster(pfad))) fn(pfad, muster(pfad), knoten);
  }

  // Zeilen für das Textfeld: etwa 60 Zeichen je Zeile plus eine Reserve, mindestens 2, höchstens 12.
  function zeilen(text) {
    const t = String(text || '');
    const n = Math.max(Math.ceil(t.length / 60), t.split('\n').length) + 1;
    return Math.min(12, Math.max(2, n));
  }

  const normal = (t) => String(t).normalize('NFC').toLocaleLowerCase('de');

  // Suche im Editor: passt das Feld (Label oder aktueller Wert) zum Suchtext? Leerer Suchtext passt immer.
  function passt(feld, wert, suche) {
    const s = normal(suche).trim();
    return !s || normal(feld.label).includes(s) || normal(wert).includes(s);
  }

  // Live nicht änderbar (nur als Info gezeigt): Name des Tests und Titel des Eintrags.
  const FEST = ['test|name', 'eintrag|titel'];

  function baueFeld(datei, pfad, wert, kern) {
    const betont = Testwaechter.BETONT_ERLAUBT.includes(muster(pfad));
    const fest = FEST.includes(datei + '|' + pfad);
    return Object.assign({ datei, pfad, gruppe: 'start', label: pfad, wert, zeilen: zeilen(wert), betont, fest }, kern);
  }

  // Alle bearbeitbaren Textfelder (Test-JSON und Eintrag in gruppe42.json), genau die, die der Wächter freigibt.
  function felder(daten, eintrag) {
    const aus = [];
    sammle(daten, '', Testwaechter.TEXTFELDER_TEST, (pfad, m, wert) => {
      aus.push(baueFeld('test', pfad, wert, beschreibeTestfeld(daten, pfad, m)));
    });
    if (eintrag) {
      sammle(eintrag, '', Testwaechter.TEXTFELDER_EINTRAG, (pfad, m, wert) => {
        aus.push(baueFeld('eintrag', pfad, wert, { gruppe: 'start', label: EINTRAG_LABEL[m], hinweis: ERSCHEINT[m] }));
      });
    }
    return aus.sort((a, b) => GRUPPEN.indexOf(a.gruppe) - GRUPPEN.indexOf(b.gruppe));
  }

  // vorher/nachher: je ein Objekt, oder {test, eintrag} wenn die Felder beide Dateien betreffen. Feste Felder zählen nicht.
  function aenderungen(vorher, nachher, felderListe) {
    const paar = (o) => o && (o.test !== undefined || o.eintrag !== undefined) && !('categories' in o);
    const quelle = (o, datei) => (paar(o) ? o[datei] : o);
    const aus = [];
    for (const f of felderListe) {
      if (f.fest) continue;
      const alt = hole(quelle(vorher, f.datei), f.pfad);
      const neu = hole(quelle(nachher, f.datei), f.pfad);
      if (alt !== neu) aus.push({ datei: f.datei, pfad: f.pfad, label: f.label, alt, neu });
    }
    return aus;
  }

  // Gespeicherten Entwurf ({werte, basis}, Schlüssel "datei|pfad") auf einen geladenen Stand {test, eintrag} anwenden.
  // Ein Feld wird nur übernommen, wenn der geladene Wert noch der Basis entspricht, von der der Entwurf ausging;
  // sonst bleibt der geladene Wert und das Label landet in verworfen (auch bei alten Entwürfen ohne Basis).
  function entwurfAnwenden(stand, entwurf, felderListe) {
    let daten = stand;
    let angewendet = 0;
    const verworfen = [];
    const werte = (entwurf && istObjekt(entwurf.werte)) ? entwurf.werte : {};
    const basis = (entwurf && istObjekt(entwurf.basis)) ? entwurf.basis : {};
    for (const f of felderListe) {
      const k = f.datei + '|' + f.pfad;
      if (f.fest) continue;
      if (!Object.prototype.hasOwnProperty.call(werte, k) || typeof werte[k] !== 'string') continue;
      const da = hole(daten[f.datei], f.pfad);
      if (werte[k] === da) continue;
      if (!Object.prototype.hasOwnProperty.call(basis, k) || basis[k] !== da) { verworfen.push(f.label); continue; }
      daten = Object.assign({}, daten, { [f.datei]: setze(daten[f.datei], f.pfad, werte[k]) });
      angewendet++;
    }
    return { daten, angewendet, verworfen };
  }

  // Meldung nach Speichern/Rückgängig. live:false heißt: gespeichert, aber die öffentliche Seite zeigt noch den alten Text.
  function erfolgText(vorne, live) {
    return live ? vorne + '. Ist live.' : vorne + ', aber die Website zeigt noch den alten Text. Bitte wenden Sie sich an Seitenschwung.';
  }

  // Meldungen einer 422-Antwort ({pfad, meldung}, ohne Datei): je Feld ("datei|pfad", test vor eintrag) oder ohne Feld.
  function ordneMeldungen(liste, hatFeld) {
    const jeFeld = new Map();
    const ohneFeld = [];
    for (const m of Array.isArray(liste) ? liste : []) {
      const k = m.pfad && ['test|' + m.pfad, 'eintrag|' + m.pfad].find(hatFeld);
      if (k) (jeFeld.get(k) || jeFeld.set(k, []).get(k)).push(m.meldung);
      else ohneFeld.push(m.meldung);
    }
    return { jeFeld, ohneFeld };
  }

  const AUS = {
    aus: 'Der Editor ist derzeit nicht eingeschaltet. Bitte wenden Sie sich an Seitenschwung.',
    nicht_schreibbar: 'Speichern ist gerade nicht möglich, weil der Datenspeicher nicht erreichbar ist. Ihr Entwurf bleibt erhalten. Bitte wenden Sie sich an Seitenschwung.',
    overlay_unlesbar: 'Die gespeicherten Änderungen können gerade nicht gelesen werden. Bitte wenden Sie sich an Seitenschwung.',
    gesperrt: 'Gerade wird an anderer Stelle gespeichert. Bitte versuchen Sie es in einem Moment erneut; Ihr Entwurf bleibt erhalten.',
  };
  // Meldung zu 503 (editor_aus) je grund; unbekannt oder ohne grund: neutral.
  function ausText(grund) {
    return Object.prototype.hasOwnProperty.call(AUS, grund) ? AUS[grund]
      : 'Der Editor ist gerade nicht verfügbar. Bitte versuchen Sie es in ein paar Minuten erneut.';
  }

  return { felder, setze, aenderungen, entwurfAnwenden, zeilen, passt, erfolgText, ordneMeldungen, ausText };
});
