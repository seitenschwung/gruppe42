// Editor-Kern: Felderliste, Änderungen und PR-Text für den Test-Editor. Ohne DOM, ohne Node-APIs.
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
    titel: 'Titel', motto: 'Motto', intro: 'Einleitung', kurz: 'Kurzinfo', beschreibung: 'Beschreibung',
  };
  const NAME_STATUS = { name: 'Name des Tests', status: 'Hinweis zum Status des Tests' };

  // Liefert {gruppe, label, hinweis?} für ein Textfeld des Tests.
  function beschreibeTestfeld(daten, pfad, m) {
    const s = teile(pfad);
    const bereichsName = (i) => '„' + (daten.categories[i] && daten.categories[i].name) + '“';
    if (NAME_STATUS[m]) return { gruppe: 'start', label: NAME_STATUS[m] };
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

  function baueFeld(datei, pfad, wert, kern) {
    const betont = Testwaechter.BETONT_ERLAUBT.includes(muster(pfad));
    return Object.assign({
      datei, pfad, gruppe: 'start', label: pfad, wert,
      mehrzeilig: wert.length > 70 || wert.includes('\n'), betont,
    }, kern);
  }

  // Alle bearbeitbaren Textfelder (Test-JSON und Eintrag in gruppe42.json), genau die, die der Wächter freigibt.
  function felder(daten, eintrag) {
    const aus = [];
    sammle(daten, '', Testwaechter.TEXTFELDER_TEST, (pfad, m, wert) => {
      aus.push(baueFeld('test', pfad, wert, beschreibeTestfeld(daten, pfad, m)));
    });
    if (eintrag) {
      sammle(eintrag, '', Testwaechter.TEXTFELDER_EINTRAG, (pfad, m, wert) => {
        aus.push(baueFeld('eintrag', pfad, wert, { gruppe: 'start', label: 'Teaser: ' + EINTRAG_LABEL[m] }));
      });
    }
    return aus.sort((a, b) => GRUPPEN.indexOf(a.gruppe) - GRUPPEN.indexOf(b.gruppe));
  }

  // vorher/nachher: je ein Objekt, oder {test, eintrag} wenn die Felder beide Dateien betreffen.
  function aenderungen(vorher, nachher, felderListe) {
    const paar = (o) => o && (o.test !== undefined || o.eintrag !== undefined) && !('categories' in o);
    const quelle = (o, datei) => (paar(o) ? o[datei] : o);
    const aus = [];
    for (const f of felderListe) {
      const alt = hole(quelle(vorher, f.datei), f.pfad);
      const neu = hole(quelle(nachher, f.datei), f.pfad);
      if (alt !== neu) aus.push({ label: f.label, alt, neu });
    }
    return aus;
  }

  // Verhindert Erwähnungen (@name) und Querverweise (#12, owner/repo#12) in GitHub-Texten.
  const entschaerfe = (t) => String(t).replace(/@/g, '@\u200b').replace(/#(?=\d)/g, '#\u200b');
  const einzeilig = (t) => entschaerfe(String(t).replace(/\s*[\r\n]+\s*/g, ' '));

  function prText(testTitel, liste, notiz) {
    const n = liste.length;
    const titel = 'Inhalt: ' + einzeilig(testTitel) + ' (' + n + (n === 1 ? ' Änderung' : ' Änderungen') + ')';
    const teile2 = [];
    if (notiz && notiz.trim()) teile2.push(entschaerfe(notiz.trim()));
    teile2.push(liste.map((a) => '- ' + einzeilig(a.label) + ': „' + einzeilig(a.alt) + '“ → „' + einzeilig(a.neu) + '“').join('\n'));
    teile2.push('Erstellt mit dem Test-Editor.');
    return { titel, text: teile2.join('\n\n') };
  }

  return { felder, setze, aenderungen, prText };
});
