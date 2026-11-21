// Vorschau für den Test-Editor: baut aus der veröffentlichten Testseite und den bearbeiteten Daten ein
// vollständiges Dokument (Markup aus Testseite, gleiche Funktionen wie im Build) und zeigt es in einem iframe.
(function (root, factory) {
  'use strict';
  root.EditorVorschau = factory(root.Testseite);
})(typeof self !== 'undefined' ? self : this, function (T) {
  'use strict';

  const seiten = {};

  // Veröffentlichte Seite des Tests (Kopf, Menü, CSS, Kontaktband); einmal je Test geladen.
  async function ladeSeite(id) {
    if (!seiten[id]) {
      const antwort = await fetch('/' + encodeURIComponent(id) + '.html', { cache: 'no-store' });
      if (!antwort.ok) throw new Error('Seite ' + id + '.html fehlt (' + antwort.status + ')');
      seiten[id] = await antwort.text();
    }
    return seiten[id];
  }

  // Markup (aus Testseite, dort maskiert) in ein Element des Dokuments `doc` umwandeln.
  function teile(doc, html) {
    const t = doc.createElement('template');
    t.innerHTML = html;
    return t.content;
  }

  function ersetze(doc, selektor, neu) {
    const alt = doc.querySelector(selektor);
    if (alt && neu) alt.replaceWith(neu);
  }

  // ansicht: 'fragen' | 'ergebnis' | 'kachel'; spec: Wert für data-vorschau (nur 'ergebnis').
  function dokument(html, eintrag, daten, testsCfg, ansicht, spec) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const base = doc.createElement('base');
    base.setAttribute('href', '/');
    doc.head.prepend(base);
    const main = doc.querySelector('main') || doc.body;
    if (ansicht === 'kachel') {
      main.replaceChildren(teile(doc, '<section class="abschnitt" aria-label="Kachel in der Übersicht"><div class="container">' +
        '<ul class="karten">' + T.kachel(eintrag, '#') + '</ul></div></section>'));
    } else {
      ersetze(doc, '.seitenkopf', teile(doc, T.kopf(eintrag)).firstElementChild);
      const neu = teile(doc, T.abschnitte(eintrag, daten, testsCfg));
      ['#test', '#ergebnis', '#antreiber-daten'].forEach((sel) => ersetze(doc, sel, neu.querySelector(sel)));
      if (ansicht === 'ergebnis') {
        const wurzel = doc.querySelector('[data-test]');
        if (wurzel) wurzel.setAttribute('data-vorschau', spec || '');
      }
    }
    return '<!doctype html>\n' + doc.documentElement.outerHTML;
  }

  // Im iframe (gleicher Ursprung) bis zur Frage `nummer` (0-basiert) blättern: starten, je eine Antwort wählen, weiter.
  function zeigeFrage(fenster, nummer) {
    const d = fenster.document;
    const start = d.querySelector('[data-start]');
    if (!start || start.hidden) return;
    start.click();
    for (let i = 0; i < nummer; i++) {
      const wahl = d.querySelector('[data-optionen] input');
      const weiter = d.querySelector('[data-weiter]');
      if (!wahl || !weiter) return;
      wahl.checked = true;
      wahl.dispatchEvent(new Event('change'));
      weiter.click();
    }
  }

  // Ein iframe neu befüllen. opt.frage: zu dieser Frage blättern; opt.halten: Scrollposition im iframe behalten.
  // Das Test-Skript setzt beim Ergebnis den Fokus und scrollt; Fokus und Scrollposition des Editors werden
  // danach wiederhergestellt, damit Tippen und Lesen im Formular nicht unterbrochen werden.
  function zeige(iframe, html, opt) {
    opt = opt || {};
    const d = iframe.ownerDocument;
    const aussen = d.defaultView;
    let y = 0;
    try { y = iframe.contentWindow ? iframe.contentWindow.scrollY : 0; } catch (e) { y = 0; }
    const merke = () => ({ aktiv: d.activeElement, x: aussen.scrollX, y: aussen.scrollY });
    const vorher = merke();
    const zurueck = () => {
      if (vorher.aktiv && vorher.aktiv !== iframe && d.activeElement !== vorher.aktiv && vorher.aktiv.focus) {
        vorher.aktiv.focus({ preventScroll: true });
      }
      aussen.scrollTo({ left: vorher.x, top: vorher.y, behavior: 'instant' });
    };
    iframe.addEventListener('load', function geladen() {
      iframe.removeEventListener('load', geladen);
      const w = iframe.contentWindow;
      if (w) {
        if (typeof opt.frage === 'number') zeigeFrage(w, opt.frage);
        else if (opt.halten) w.scrollTo({ top: y, behavior: 'instant' });
      }
      zurueck();
    });
    iframe.srcdoc = html;
  }

  return { ladeSeite, dokument, zeige };
});
