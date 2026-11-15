/* Beratung-Vorlage – minimales JavaScript: Jahr im Fuß und Workshop-Filter.
   Ohne JavaScript sind alle Workshops sichtbar, die Filterknöpfe bleiben ausgeblendet. */
(function () {
  'use strict';
  var d = document;

  d.querySelectorAll('[data-jahr]').forEach(function (el) { el.textContent = new Date().getFullYear(); });

  // Hauptmenü: Aufklappliste schließt per Esc und Klick daneben; mobil Menüknopf (ohne JavaScript bleibt alles sichtbar)
  var navListe = d.getElementById('nav-liste');
  var navKnopf = d.querySelector('.nav-toggle');
  var gruppen = Array.prototype.slice.call(d.querySelectorAll('.nav-gruppe details'));
  var schmal = window.matchMedia('(max-width: 860px)');
  function schliesse(ausser) { gruppen.forEach(function (g) { if (g !== ausser) g.open = false; }); }
  gruppen.forEach(function (g) {
    g.addEventListener('toggle', function () { if (g.open) schliesse(g); });
    g.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && g.open) { g.open = false; g.querySelector('summary').focus(); }
    });
    g.addEventListener('focusout', function (e) { if (!schmal.matches && e.relatedTarget && !g.contains(e.relatedTarget)) g.open = false; });
  });
  d.addEventListener('click', function (e) { gruppen.forEach(function (g) { if (!g.contains(e.target)) g.open = false; }); });
  if (navKnopf && navListe) {
    navKnopf.hidden = false;
    function setzeMenue(offen) {
      navListe.classList.toggle('nav-zu', !offen);
      navKnopf.setAttribute('aria-expanded', String(offen));
    }
    setzeMenue(false);
    navKnopf.addEventListener('click', function () { setzeMenue(navKnopf.getAttribute('aria-expanded') !== 'true'); });
    d.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && navKnopf.getAttribute('aria-expanded') === 'true' && schmal.matches) { setzeMenue(false); navKnopf.focus(); }
    });
    navListe.addEventListener('click', function (e) { if (e.target.closest('a') && schmal.matches) setzeMenue(false); });
  }

  var filter = d.querySelector('[data-filter]');
  if (!filter) return;
  var karten = Array.prototype.slice.call(d.querySelectorAll('[data-kategorie]'));
  var knoepfe = Array.prototype.slice.call(filter.querySelectorAll('button'));
  var anzahl = d.querySelector('[data-anzahl]');
  filter.hidden = false;

  knoepfe.forEach(function (knopf) {
    knopf.addEventListener('click', function () {
      var wahl = knopf.getAttribute('data-wert');
      knoepfe.forEach(function (k) { k.setAttribute('aria-pressed', String(k === knopf)); });
      var sichtbar = 0;
      karten.forEach(function (karte) {
        var passt = !wahl || karte.getAttribute('data-kategorie') === wahl;
        karte.hidden = !passt;
        if (passt) sichtbar++;
      });
      if (anzahl) anzahl.textContent = sichtbar;
    });
  });
})();
