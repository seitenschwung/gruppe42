(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Testseite = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Markup der Testseiten: wird vom Build (Node) und vom Editor (Browser, Live-Vorschau) genutzt.
  // Keine Node-APIs, keine Abhängigkeit von build.js: alles kommt über Parameter.

  function esc(wert) {
    return String(wert ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const betont = (text) => esc(text || '').replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Entspricht seitenkopf(titel, motto, intro, null, true) im Build.
  function kopf(e) {
    const titel = e.titel;
    return `<section class="seitenkopf seitenkopf-kompakt">
  <div class="container">
    <nav class="brotkrumen" aria-label="Brotkrumen"><ol><li><a href="./">Start</a></li><li aria-current="page">${esc(titel)}</li></ol></nav>
    <div class="seitenkopf-inhalt">
      <div class="seitenkopf-text">
        <p class="kicker">${esc(titel)}</p>
        <h1>${betont(e.motto || titel)}</h1>
        ${e.intro ? `<p>${esc(e.intro)}</p>` : ''}
      </div>
      
    </div>
  </div>
</section>`;
  }

  // Test- und Ergebnisabschnitt plus Daten-Skript. `zwischen` (z. B. kontaktband()) steht
  // zwischen Ergebnisabschnitt und Skript, genau wie auf der gebauten Seite.
  // Marker <!--g42:...--> begrenzen die Bereiche, die der Server (server/seiten.js) mit Live-Texten neu erzeugt.
  function sektionen(cfg, daten, testsCfg) {
    const titel = cfg.titel;
    const entwurf = cfg.sichtbar !== true;
    const r = daten.result;
    const dauer = cfg.kurz ? esc(cfg.kurz) : `${daten.questions.length} Aussagen`;
    return `<!--g42:test--><section class="abschnitt test" id="test" aria-label="${esc(titel)}">
  <div class="container">
    <noscript><p class="shop-hinweis">Für den Test wird JavaScript benötigt. Deine Antworten verlassen dabei nie deinen Browser.</p></noscript>
    ${entwurf ? '<p class="shop-hinweis">Entwurf: Dieser Test ist noch nicht freigegeben (nicht im Menü, nicht indexierbar).</p>' : ''}
    <div class="test-karte" data-test>
      <div data-schritt="intro">
        <p class="kicker">Vorab</p>
        <h2 class="test-titel">So funktioniert es</h2>
        <ul class="test-hinweise">
          <li><strong>${dauer}.</strong> Antworte spontan und denke an deinen Alltag.</li>
          <li><strong>Keine richtigen oder falschen Antworten.</strong> Am Ende erhältst du eine Auswertung mit Impulsen.</li>
          <li><strong>Privat:</strong> ${esc(testsCfg.datenschutz || 'Deine Antworten werden nur in deinem Browser verarbeitet und nicht gespeichert.')}</li>
        </ul>
        <p class="test-note">${esc(daten.status || '')}. Kein Diagnoseinstrument.${testsCfg.methodik ? ' <a href="methodik.html">So entstehen unsere Tests</a>' : ''}</p>
        <button class="knopf knopf-dunkel" type="button" data-start hidden>Test starten</button>
      </div>
      <div data-schritt="frage" hidden>
        <div class="test-kopf">
          <p class="test-zaehler" data-zaehler aria-live="polite"></p>
          <div class="test-balken" role="progressbar" aria-label="Fortschritt" aria-valuemin="0" aria-valuemax="${daten.questions.length}" aria-valuenow="0" data-balken><span></span></div>
        </div>
        <fieldset class="test-frage">
          <legend tabindex="-1" data-frage></legend>
          <div class="test-optionen" data-optionen></div>
        </fieldset>
        <div class="test-aktionen">
          <button class="knopf knopf-rand" type="button" data-zurueck>Zurück</button>
          <button class="knopf knopf-dunkel" type="button" data-weiter disabled>Weiter</button>
        </div>
      </div>
    </div>
  </div>
</section>
<section class="sand abschnitt test-ergebnis" id="ergebnis" aria-labelledby="ergebnis-titel" data-ergebnis hidden>
  <div class="container">
    <p class="kicker" data-kicker>${esc(r.kicker || 'Dein Ergebnis')}</p>
    <h2 class="titel" id="ergebnis-titel" tabindex="-1">${betont(r.title || 'Dein Ergebnis')}</h2>
    <p class="test-lead" data-intro></p>
    <div class="test-stufe" data-stufe hidden></div>
    <figure class="test-chart" data-chart></figure>
    <div class="test-details" data-details></div>
    <p class="test-lead test-outro" data-outro></p>
    <p class="test-note" data-note></p>
    <div class="knoepfe test-ende">
      ${r.cta && r.cta.href ? `<a class="knopf knopf-honig" href="${esc(r.cta.href)}">${esc(r.cta.text || 'Im Erstgespräch vertiefen')}</a>` : ''}
      <button class="knopf knopf-rand" type="button" data-mail>Per E-Mail an mich senden</button>
      <button class="knopf knopf-rand" type="button" data-neu>Neu starten</button>
      <button class="knopf knopf-rand" type="button" data-druck>Als PDF speichern / drucken</button>
    </div>
  </div>
</section><!--/g42:test-->`;
  }

  function datenSkript(daten) {
    const json = JSON.stringify(daten).replace(/</g, '\\u003c');
    return `<!--g42:daten--><script type="application/json" id="antreiber-daten">${json}</script><!--/g42:daten-->`;
  }

  function abschnitte(cfg, daten, testsCfg, zwischen) {
    return `${sektionen(cfg, daten, testsCfg)}
${zwischen || ''}
${datenSkript(daten)}`;
  }

  // Karte eines Tests in der Übersicht (selbsttests.html).
  function kachel(e, href) {
    return `
      <li class="karte">
        <div class="karte-inhalt">
          ${e.kurz ? `<ul class="schlagworte"><li>${esc(e.kurz)}</li></ul>` : ''}
          <h2>${esc(e.titel)}</h2>
          ${e.beschreibung ? `<p>${esc(e.beschreibung)}</p>` : ''}
          <a class="knopf knopf-dunkel" href="${href}">Test starten<span class="sr-only">: ${esc(e.titel)}</span></a>
        </div>
      </li>`;
  }

  return { esc, betont, kopf, sektionen, datenSkript, abschnitte, kachel };
}));
