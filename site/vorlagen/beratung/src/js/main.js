/* Beratung-Vorlage – minimales JavaScript: Jahr im Fuß und Workshop-Filter.
   Ohne JavaScript sind alle Workshops sichtbar, die Filterknöpfe bleiben ausgeblendet. */
(function () {
  'use strict';
  var d = document;

  d.querySelectorAll('[data-jahr]').forEach(function (el) { el.textContent = new Date().getFullYear(); });

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
