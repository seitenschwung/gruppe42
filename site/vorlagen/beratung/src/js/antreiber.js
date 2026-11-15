/* Antreiber-Test – läuft komplett im Browser, nichts wird gespeichert oder gesendet.
   Die Seite (build.js) liefert Gerüst und Daten (#antreiber-daten); hier: Ablauf, Auswertung, Ergebnis. */
(function () {
  'use strict';
  var d = document;
  var datenEl = d.getElementById('antreiber-daten');
  var wurzel = d.querySelector('[data-test]');
  var ergebnis = d.querySelector('[data-ergebnis]');
  if (!datenEl || !wurzel || !ergebnis) return;

  var DATA = JSON.parse(datenEl.textContent);
  var antworten = new Array(DATA.questions.length).fill(null);
  var index = 0;

  function q(sel, root) { return (root || wurzel).querySelector(sel); }
  var schritte = { intro: q('[data-schritt="intro"]'), frage: q('[data-schritt="frage"]') };
  var startKnopf = q('[data-start]');
  var zaehler = q('[data-zaehler]');
  var balken = q('[data-balken]');
  var frage = q('[data-frage]');
  var optionen = q('[data-optionen]');
  var zurueck = q('[data-zurueck]');
  var weiter = q('[data-weiter]');
  var testSektion = d.getElementById('test');

  function el(tag, klasse, text) {
    var e = d.createElement(tag);
    if (klasse) e.className = klasse;
    if (text != null) e.textContent = text;
    return e;
  }
  function zeige(welcher) {
    Object.keys(schritte).forEach(function (k) { schritte[k].hidden = k !== welcher; });
  }
  function nachOben(ziel) {
    var weich = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    ziel.scrollIntoView({ behavior: weich ? 'smooth' : 'auto', block: 'start' });
  }

  function zeigeFrage(fokus) {
    var f = DATA.questions[index];
    var n = DATA.questions.length;
    zaehler.textContent = 'Frage ' + (index + 1) + ' von ' + n;
    balken.setAttribute('aria-valuenow', String(index + 1));
    balken.firstElementChild.style.width = (100 * (index + 1) / n) + '%';
    frage.textContent = f.text;
    optionen.replaceChildren();
    Object.keys(DATA.scale).forEach(function (wert) {
      var zeile = el('label', 'test-option');
      var eingabe = d.createElement('input');
      eingabe.type = 'radio';
      eingabe.name = 'antwort';
      eingabe.value = wert;
      eingabe.checked = antworten[index] === Number(wert);
      eingabe.addEventListener('change', function () {
        antworten[index] = Number(wert);
        weiter.disabled = false;
      });
      zeile.append(eingabe, el('span', 'test-wert', wert), el('span', null, DATA.scale[wert]));
      optionen.append(zeile);
    });
    zurueck.disabled = index === 0;
    weiter.disabled = antworten[index] === null;
    weiter.textContent = index === n - 1 ? 'Auswertung ansehen' : 'Weiter';
    if (fokus) frage.focus({ preventScroll: true });
  }

  function absatz(eltern, label, text) {
    var p = el('p');
    if (label) p.append(el('strong', null, label + ' '));
    p.append(d.createTextNode(text));
    eltern.append(p);
  }

  function auswerten() {
    if (antworten.some(function (a) { return a === null; })) return;
    var summe = {};
    DATA.categories.forEach(function (c) { summe[c.id] = 0; });
    DATA.questions.forEach(function (f, i) { summe[f.category] += antworten[i]; });
    var sortiert = DATA.categories.slice().sort(function (a, b) { return summe[b.id] - summe[a.id]; });
    var hoch = summe[sortiert[0].id];
    var tief = summe[sortiert[sortiert.length - 1].id];
    var gleich = hoch === tief;
    var spitze = sortiert.filter(function (c) { return summe[c.id] === hoch; });
    var max = DATA.questions.length / DATA.categories.length * 5;

    ergebnis.querySelector('[data-intro]').textContent = DATA.resultsIntro;
    ergebnis.querySelector('[data-outro]').textContent = DATA.resultsOutro;
    ergebnis.querySelector('[data-note]').textContent = DATA.interpretationNote + ' ' + DATA.contentNote;

    var rang = ergebnis.querySelector('[data-rang]');
    rang.replaceChildren();
    sortiert.forEach(function (c) {
      var wert = summe[c.id];
      var li = el('li', 'test-zeile' + (!gleich && wert === hoch ? ' ist-spitze' : ''));
      var kopf = el('div', 'test-zeile-kopf');
      var name = el('a', 'test-zeile-name', c.name);
      name.href = '#antreiber-' + c.id;
      kopf.append(name, el('span', 'test-zeile-wert', wert + ' / ' + max));
      var spur = el('div', 'test-spur');
      spur.setAttribute('aria-hidden', 'true');
      var fuell = el('span');
      fuell.style.width = (wert / max * 100) + '%';
      spur.append(fuell);
      li.append(kopf, spur);
      rang.append(li);
    });

    var details = ergebnis.querySelector('[data-details]');
    details.replaceChildren();
    if (gleich) {
      details.append(el('p', 'test-lead', 'Alle fünf Bereiche liegen in deinen Antworten gleichauf. Welche der Beschreibungen sich für dich richtig anfühlt, darfst du ganz in Ruhe selbst herausfinden.'));
    } else {
      details.append(el('p', 'test-lead', 'Besonders angesprochen haben dich die Aussagen zu: ' + spitze.map(function (c) { return c.name; }).join(', ') + '. Das ist keine Festlegung auf einen Persönlichkeitstyp, sondern ein möglicher Ausgangspunkt für deine Reflexion.'));
    }

    sortiert.forEach(function (c) {
      var wert = summe[c.id];
      var art = el('article', 'test-thema');
      art.id = 'antreiber-' + c.id;
      var kopf = el('header', 'test-thema-kopf');
      var h = el('h3', null, c.name);
      kopf.append(h);
      if (!gleich && wert === hoch) kopf.append(el('span', 'test-marke', 'Am stärksten angesprochen'));
      art.append(kopf);
      art.append(el('p', 'test-headline', c.headline));
      if (!gleich && wert === tief) absatz(art, 'Ein Blick auf dein Profil:', c.lowContext);
      absatz(art, '', c.intro);
      var spalten = el('div', 'test-spalten');
      var links = el('div', 'test-spalte');
      links.append(el('h4', null, c.strengthTitle));
      links.append(el('p', null, c.strength));
      var rechts = el('div', 'test-spalte test-spalte-druck');
      rechts.append(el('h4', null, c.underPressureTitle));
      rechts.append(el('p', null, c.underPressure));
      spalten.append(links, rechts);
      art.append(spalten);
      var zitat = el('blockquote', 'test-erlaubnis');
      zitat.append(el('p', null, '„' + c.permission + '“'));
      art.append(zitat);
      absatz(art, 'Eine kleine Einladung für deinen Alltag:', c.microStep);
      absatz(art, 'Deine Reflexionsfrage:', c.reflection);
      details.append(art);
    });

    testSektion.hidden = true;
    ergebnis.hidden = false;
    var titel = d.getElementById('ergebnis-titel');
    titel.focus({ preventScroll: true });
    nachOben(ergebnis);
  }

  startKnopf.hidden = false;
  startKnopf.addEventListener('click', function () {
    zeige('frage');
    zeigeFrage(true);
    nachOben(wurzel);
  });
  weiter.addEventListener('click', function () {
    if (antworten[index] === null) return;
    if (index === DATA.questions.length - 1) { auswerten(); return; }
    index++;
    zeigeFrage(true);
    nachOben(wurzel);
  });
  zurueck.addEventListener('click', function () {
    if (!index) return;
    index--;
    zeigeFrage(true);
  });
  ergebnis.querySelector('[data-neu]').addEventListener('click', function () {
    antworten.fill(null);
    index = 0;
    ergebnis.hidden = true;
    testSektion.hidden = false;
    zeige('intro');
    nachOben(wurzel);
  });
  ergebnis.querySelector('[data-druck]').addEventListener('click', function () { window.print(); });
})();
