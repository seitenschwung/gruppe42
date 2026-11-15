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

  // Abschnitte einer Kategorie: kind "text" | "labeled" | "column" (aufeinanderfolgende Spalten nebeneinander) | "quote"
  function abschnitte(art, c) {
    var spalten = null;
    (c.sections || []).forEach(function (s) {
      if (s.kind === 'column') {
        if (!spalten) { spalten = el('div', 'test-spalten'); art.append(spalten); }
        var sp = el('div', 'test-spalte' + (s.tone === 'pressure' ? ' test-spalte-druck' : ''));
        if (s.title) sp.append(el('h4', null, s.title));
        sp.append(el('p', null, s.text));
        spalten.append(sp);
        return;
      }
      spalten = null;
      if (s.kind === 'quote') {
        var z = el('blockquote', 'test-erlaubnis');
        z.append(el('p', null, '„' + s.text + '“'));
        art.append(z);
      } else if (s.kind === 'labeled') {
        absatz(art, s.title, s.text);
      } else {
        absatz(art, '', s.text);
      }
    });
  }

  var letztesErgebnis = '';

  function auswerten() {
    if (antworten.some(function (a) { return a === null; })) return;
    var R = DATA.result;
    var skalaMax = Math.max.apply(null, Object.keys(DATA.scale).map(Number));
    var skalaMin = Math.min.apply(null, Object.keys(DATA.scale).map(Number));
    var summe = {}, anzahl = {};
    DATA.categories.forEach(function (c) { summe[c.id] = 0; anzahl[c.id] = 0; });
    DATA.questions.forEach(function (f, i) {
      var a = antworten[i];
      summe[f.category] += f.reverse ? skalaMax + skalaMin - a : a;
      anzahl[f.category]++;
    });
    function maxVon(c) { return anzahl[c.id] * skalaMax; }
    var ranking = R.kind === 'ranking';
    var gesamt = 0, gesamtMax = 0;
    DATA.categories.forEach(function (c) { gesamt += summe[c.id]; gesamtMax += maxVon(c); });
    var prozent = gesamt / gesamtMax * 100;

    var sortiert = DATA.categories.slice();
    if (ranking) sortiert.sort(function (a, b) { return summe[b.id] / maxVon(b) - summe[a.id] / maxVon(a); });
    var hochW = sortiert.length ? summe[sortiert[0].id] / maxVon(sortiert[0]) : 0;
    var tiefW = sortiert.length ? summe[sortiert[sortiert.length - 1].id] / maxVon(sortiert[sortiert.length - 1]) : 0;
    var gleich = hochW === tiefW;
    var spitze = sortiert.filter(function (c) { return summe[c.id] / maxVon(c) === hochW; });

    ergebnis.querySelector('[data-intro]').textContent = R.intro || '';
    ergebnis.querySelector('[data-outro]').textContent = R.outro || '';
    ergebnis.querySelector('[data-note]').textContent = R.note || '';

    // Stufe (nur kind "levels"): Kennzahl + segmentierte Skala mit Markierung
    var stufeEl = ergebnis.querySelector('[data-stufe]');
    stufeEl.replaceChildren();
    var stufeTitel = '';
    if (!ranking) {
      var stufen = R.levels.slice().sort(function (a, b) { return a.min - b.min; });
      var stufe = stufen.filter(function (l) { return prozent >= l.min; }).pop() || stufen[0];
      stufeTitel = stufe.title;
      stufeEl.append(el('p', 'test-stufe-wert', Math.round(prozent) + ' %'), el('h3', null, stufe.title), el('p', null, stufe.text));
      var skala = el('div', 'test-skala');
      skala.setAttribute('role', 'img');
      skala.setAttribute('aria-label', 'Skala von 0 bis 100 Prozent, dein Wert: ' + Math.round(prozent) + ' Prozent, Stufe „' + stufe.title + '“');
      var band = el('div', 'test-skala-band');
      stufen.forEach(function (l, i) {
        var bis = i + 1 < stufen.length ? stufen[i + 1].min : 100;
        var seg = el('div', 'test-skala-seg' + (l === stufe ? ' ist-aktiv' : ''));
        seg.style.flex = (bis - l.min) + ' 1 0';
        seg.dataset.stufe = String(i);
        seg.append(el('span', null, l.title));
        band.append(seg);
      });
      var marke = el('div', 'test-skala-marke');
      marke.style.left = Math.min(100, Math.max(0, prozent)) + '%';
      band.append(marke);
      var achse = el('div', 'test-skala-achse');
      achse.append(el('span', null, '0 %'), el('span', null, '100 %'));
      skala.append(band, achse);
      stufeEl.append(skala);
      stufeEl.hidden = false;
    } else {
      stufeEl.hidden = true;
    }

    // Balkendiagramm: gerankte horizontale Balken, eine Farbe, Skala 0–max, Tabellenansicht
    var chart = ergebnis.querySelector('[data-chart]');
    chart.replaceChildren();
    var zeilen = [];
    var kopfZeile = el('figcaption', 'test-chart-kopf');
    var ueberschrift = ranking ? 'Dein Profil im Überblick' : 'Ergebnis je Bereich';
    kopfZeile.append(el('h3', null, ueberschrift), el('p', null, 'Punkte je Bereich' + (ranking ? ', höchster Wert zuerst' : '') + '. Ein hoher Wert heißt nur: Diesen Aussagen hast du häufiger zugestimmt.'));
    var plot = el('div', 'test-chart-plot');
    var skalaMaxPunkte = Math.max.apply(null, sortiert.map(maxVon));
    var achseEl = el('div', 'test-chart-achse');
    achseEl.setAttribute('aria-hidden', 'true');
    [0, 20, 40, 60, 80, 100].forEach(function (pz) { var s = el('span', null, String(Math.round(skalaMaxPunkte * pz / 100))); s.style.left = pz + '%'; achseEl.append(s); });
    var zeilenListe = el('ol', 'test-chart-zeilen');
    var tooltip = el('div', 'test-tooltip');
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    sortiert.forEach(function (c, idx) {
      var max = maxVon(c), wert = summe[c.id], pz = wert / max * 100;
      var istSpitze = ranking && !gleich && wert / max === hochW;
      var li = el('li', 'test-zeile' + (istSpitze ? ' ist-spitze' : ''));
      var satz = c.name + ': ' + wert + ' von ' + max + ' Punkten (' + Math.round(pz) + ' %)';
      li.tabIndex = 0;
      li.setAttribute('aria-label', (ranking ? 'Platz ' + (idx + 1) + '. ' : '') + satz);
      var name;
      if ((c.sections || []).length) {
        name = el('a', 'test-zeile-name', c.name);
        name.href = '#thema-' + c.id;
        name.tabIndex = -1;
      } else {
        name = el('span', 'test-zeile-name', c.name);
      }
      var kopf = el('div', 'test-zeile-label');
      if (ranking) kopf.append(el('span', 'test-platz', String(idx + 1)));
      kopf.append(name);
      var spur = el('div', 'test-spur');
      spur.setAttribute('aria-hidden', 'true');
      var f = el('span', 'test-balken-fuell');
      f.style.width = pz + '%';
      spur.append(f);
      var zahl = el('span', 'test-zeile-wert');
      zahl.setAttribute('aria-hidden', 'true');
      zahl.append(el('strong', null, String(wert)), document.createTextNode(' / ' + max));
      li.append(kopf, spur, zahl);
      function zeigeTip() {
        tooltip.textContent = satz;
        tooltip.hidden = false;
        var r = li.getBoundingClientRect(), p = plot.getBoundingClientRect(), s = spur.getBoundingClientRect();
        var halb = tooltip.offsetWidth / 2;
        var links = s.left - p.left + s.width * pz / 100;
        tooltip.style.top = (r.top - p.top - 8) + 'px';
        tooltip.style.left = Math.max(halb, Math.min(links, s.right - p.left - halb)) + 'px';
      }
      li.addEventListener('mouseenter', zeigeTip);
      li.addEventListener('focus', zeigeTip);
      li.addEventListener('mouseleave', function () { tooltip.hidden = true; });
      li.addEventListener('blur', function () { tooltip.hidden = true; });
      zeilenListe.append(li);
      zeilen.push(c.name + ': ' + wert + ' / ' + max);
    });
    var achsenZeile = el('div', 'test-chart-achsenzeile');
    achsenZeile.append(el('span'), achseEl, el('span'));
    plot.append(zeilenListe, achsenZeile, tooltip);

    // Tabellenansicht (barrierefreie Alternative zur Grafik)
    var tabKnopf = el('button', 'test-tabknopf', 'Als Tabelle anzeigen');
    tabKnopf.type = 'button';
    tabKnopf.setAttribute('aria-expanded', 'false');
    var tab = el('table', 'test-tabelle');
    tab.hidden = true;
    var th = el('tr');
    ['Bereich', 'Punkte', 'Maximum', 'Anteil'].forEach(function (h) { var c = el('th', null, h); c.scope = 'col'; th.append(c); });
    var thead = el('thead'); thead.append(th); tab.append(thead);
    var tb = el('tbody');
    sortiert.forEach(function (c) {
      var tr = el('tr'), max = maxVon(c);
      var tdName = el('th', null, c.name); tdName.scope = 'row';
      tr.append(tdName, el('td', null, String(summe[c.id])), el('td', null, String(max)), el('td', null, Math.round(summe[c.id] / max * 100) + ' %'));
      tb.append(tr);
    });
    tab.append(tb);
    tabKnopf.addEventListener('click', function () {
      var offen = tab.hidden;
      tab.hidden = !offen;
      plot.hidden = offen;
      tabKnopf.setAttribute('aria-expanded', String(offen));
      tabKnopf.textContent = offen ? 'Als Grafik anzeigen' : 'Als Tabelle anzeigen';
    });
    chart.append(kopfZeile, plot, tab, tabKnopf);

    var details = ergebnis.querySelector('[data-details]');
    details.replaceChildren();
    if (ranking && R.lead) {
      details.append(el('p', 'test-lead', gleich ? (R.tie || '') : R.lead.replace('{names}', spitze.map(function (c) { return c.name; }).join(', '))));
    }

    sortiert.forEach(function (c) {
      if (!(c.sections || []).length && !c.headline) return;
      var art = el('article', 'test-thema');
      art.id = 'thema-' + c.id;
      var kopf = el('header', 'test-thema-kopf');
      kopf.append(el('h3', null, c.name));
      if (ranking && !gleich && summe[c.id] / maxVon(c) === hochW && R.highlight) kopf.append(el('span', 'test-marke', R.highlight));
      art.append(kopf);
      if (c.headline) art.append(el('p', 'test-headline', c.headline));
      if (ranking && !gleich && summe[c.id] / maxVon(c) === tiefW && c.lowContext) absatz(art, R.lowLabel || '', c.lowContext);
      abschnitte(art, c);
      details.append(art);
    });

    letztesErgebnis = (stufeTitel ? [stufeTitel + ' (' + Math.round(prozent) + ' %)'] : []).concat(zeilen).join('\n');
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
  ergebnis.querySelector('[data-mail]').addEventListener('click', function () {
    var betreff = (DATA.name || 'Mein Ergebnis') + ': mein Ergebnis';
    var text = betreff + '\n\n' + letztesErgebnis + '\n\n' + location.href.split('#')[0];
    location.href = 'mailto:?subject=' + encodeURIComponent(betreff) + '&body=' + encodeURIComponent(text);
  });
  ergebnis.querySelector('[data-druck]').addEventListener('click', function () { window.print(); });

  // Vorschau der Auswertung ohne Test: ?vorschau (Zufallsantworten) oder ?vorschau=3 (alle Antworten = 3)
  var vorschau = new URLSearchParams(location.search).get('vorschau');
  if (vorschau !== null) {
    var werte = Object.keys(DATA.scale).map(Number);
    var fest = Number(vorschau);
    antworten = antworten.map(function () {
      return werte.indexOf(fest) !== -1 && vorschau !== '' ? fest : werte[Math.floor(Math.random() * werte.length)];
    });
    index = DATA.questions.length - 1;
    auswerten();
  }
})();
