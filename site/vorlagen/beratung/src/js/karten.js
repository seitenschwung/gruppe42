/* Gesprächskarten: zufällige Karte ohne Wiederholung, Vollbild zum Projizieren. Nichts wird gespeichert oder gesendet. */
(function () {
  'use strict';
  var d = document;
  var wurzel = d.querySelector('[data-karten]');
  var datenEl = d.getElementById('karten-daten');
  if (!wurzel || !datenEl) return;
  var saetze;
  try { saetze = JSON.parse(datenEl.textContent); } catch (e) { return; }
  if (!saetze || !saetze.length) return;

  function q(s) { return wurzel.querySelector(s); }
  var wahl = q('[data-wahl]');
  var textEl = q('[data-text]');
  var zaehlerEl = q('[data-zaehler]');
  var ansage = q('[data-ansage]');
  var weiter = q('[data-weiter]');
  var neu = q('[data-neu]');
  var voll = q('[data-voll]');
  var liste = d.querySelector('[data-liste]');

  var satz = null;
  var stapel = [];
  var gezogen = 0;

  function mischen(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function melde(text) {
    ansage.textContent = '';
    window.setTimeout(function () { ansage.textContent = text; }, 30);
  }
  function zeigeZaehler() {
    zaehlerEl.textContent = satz ? satz.titel + ' · Karte ' + gezogen + ' von ' + satz.karten.length : '';
  }

  function waehle(s, fokus) {
    satz = s;
    stapel = mischen(s.karten);
    gezogen = 0;
    Array.prototype.forEach.call(wahl.children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.id === s.id)); });
    textEl.textContent = 'Kartenset „' + s.titel + '“ gewählt. Ziehe die erste Karte.';
    textEl.classList.remove('gkarten-ende');
    weiter.disabled = false;
    neu.hidden = true;
    zeigeZaehler();
    melde('Kartenset ' + s.titel + ' gewählt, ' + s.karten.length + ' Karten.');
    if (fokus) weiter.focus();
  }

  function ziehe() {
    if (!satz || weiter.disabled) return;
    var karte = stapel[gezogen];
    gezogen++;
    textEl.textContent = karte;
    textEl.classList.remove('gkarten-ende');
    zeigeZaehler();
    var ende = gezogen >= stapel.length;
    if (ende) {
      weiter.disabled = true;
      neu.hidden = false;
      melde(karte + '. Das war die letzte Karte. Du kannst die Karten neu mischen.');
      neu.focus();
    } else {
      melde(karte);
    }
  }

  saetze.forEach(function (s) {
    var b = d.createElement('button');
    b.type = 'button';
    b.className = 'gkarten-satz';
    b.dataset.id = s.id;
    b.setAttribute('aria-pressed', 'false');
    b.textContent = s.titel || s.id;
    b.addEventListener('click', function () { waehle(s, true); });
    wahl.append(b);
  });

  weiter.addEventListener('click', ziehe);
  neu.addEventListener('click', function () { waehle(satz, false); ziehe(); weiter.focus(); });

  // Leertaste / Eingabetaste ziehen die nächste Karte, wenn nicht gerade ein Bedienelement fokussiert ist
  d.addEventListener('keydown', function (e) {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    var t = e.target;
    if (t && t !== d.body && t !== textEl && t !== wurzel && t !== d.documentElement) {
      var tag = (t.tagName || '').toLowerCase();
      if (tag === 'button' || tag === 'a' || tag === 'input' || tag === 'select' || tag === 'textarea' || t.isContentEditable) return;
    }
    e.preventDefault();
    ziehe();
  });

  // Vollbild für die Projektion
  var fsFaehig = wurzel.requestFullscreen || wurzel.webkitRequestFullscreen;
  function istVoll() { return d.fullscreenElement || d.webkitFullscreenElement; }
  function aktualisiereVoll() { voll.textContent = istVoll() ? 'Vollbild beenden' : 'Vollbild'; }
  if (fsFaehig && (d.fullscreenEnabled || d.webkitFullscreenEnabled)) {
    voll.hidden = false;
    voll.addEventListener('click', function () {
      if (istVoll()) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); return; }
      var p = (wurzel.requestFullscreen || wurzel.webkitRequestFullscreen).call(wurzel);
      if (p && p.catch) p.catch(function () {});
    });
    d.addEventListener('fullscreenchange', aktualisiereVoll);
    d.addEventListener('webkitfullscreenchange', aktualisiereVoll);
  }

  // JS läuft: interaktive Ansicht statt Liste aller Karten
  wurzel.hidden = false;
  if (liste) liste.hidden = true;
  waehle(saetze[0], false);
  textEl.textContent = 'Ziehe die erste Karte aus dem Set „' + saetze[0].titel + '“.';
})();
