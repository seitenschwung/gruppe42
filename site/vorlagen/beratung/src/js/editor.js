/* Test-Editor (/editor/): Texte der Selbsttests bearbeiten, prüfen, in der Vorschau ansehen und zur Freigabe senden.
   Ablauf: abgemeldet -> testwahl -> bearbeiten -> gesendet. Das Token liegt nur in einer Variablen (nie im Speicher
   des Browsers); ungesendete Entwürfe (nur Texte) liegen in localStorage. Alles DOM entsteht über textContent; Markup
   für die Vorschau kommt ausschließlich aus Testseite (maskiert). */
(function () {
  'use strict';
  const d = document;
  const W = window.Testwaechter, K = window.EditorKern, G = window.EditorGithub, V = window.EditorVorschau;
  const app = d.querySelector('[data-ed-app]');
  const meldungEl = d.querySelector('[data-ed-meldung]');
  if (!app || !meldungEl || !W || !K || !G || !V || !window.Testseite) return;

  const REPO = 'seitenschwung/gruppe42';
  const KUNDE = 'site/kunden/gruppe42/';
  const PFAD_GRUPPE = KUNDE + 'gruppe42.json';
  const PFAD_STRUKTUR = KUNDE + 'tests/struktur.json';
  const SPEICHER = 'g42-editor-entwurf-';
  const LOGIN = '/api/editor/login';
  const GRUPPEN = [
    ['start', 'Startseite des Tests'], ['skala', 'Antwortskala'], ['fragen', 'Fragen'],
    ['ergebnis', 'Ergebnis: allgemein'], ['stufen', 'Ergebnis-Stufen'], ['bereiche', 'Ergebnis je Bereich'],
  ];

  const sitzung = { token: null, ablauf: 0, login: '', darfSchreiben: false };
  let stand = null; // { gruppe, struktur } von main
  let t = null; // aktuell bearbeiteter Test
  let zaehler = 0;

  // fetch wird bei jedem Aufruf frisch geholt (nicht zwischengespeichert).
  const ctx = () => ({ token: sitzung.token, fetch: (...a) => window.fetch(...a), repo: REPO, basis: 'main' });
  async function gh(name, ...args) {
    if (sitzung.ablauf && Date.now() > sitzung.ablauf) {
      const e = new Error('Anmeldung abgelaufen');
      e.art = 'abgelaufen';
      throw e;
    }
    return G[name](ctx(), ...args);
  }

  // --- kleine DOM-Helfer (nur textContent) -------------------------------------------------
  function el(tag, attrs, ...kinder) {
    const e = d.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'text') e.textContent = v;
      else if (k === 'klasse') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kinder) if (k != null && k !== false) e.append(k);
    return e;
  }
  const knopf = (text, klasse, onclick, attrs) => el('button', Object.assign({ type: 'button', klasse: 'knopf ' + klasse, text, onclick }, attrs));
  const loginLink = (text) => el('a', { klasse: 'knopf knopf-dunkel', href: LOGIN, text: text || 'Mit GitHub anmelden' });

  function meldung(text, art, ...extra) {
    meldungEl.replaceChildren();
    meldungEl.className = 'ed-meldung' + (text ? ' ed-meldung-' + (art || 'info') : '');
    if (text) meldungEl.append(el('p', { text }), ...extra);
  }
  // Neue Ansicht; der Fokus geht auf die Überschrift (nicht beim ersten Aufbau der Seite).
  let ersteAnsicht = true;
  function ansicht(...kinder) {
    app.replaceChildren(...kinder.filter(Boolean));
    const h = app.querySelector('h2');
    if (h) h.setAttribute('tabindex', '-1');
    if (h && !ersteAnsicht) h.focus();
    ersteAnsicht = false;
  }

  // --- Entwurf (nur Texte, nie das Token) -------------------------------------------------
  const schluessel = (f) => f.datei + '|' + f.pfad;
  function leseEntwurf(id) {
    try { return JSON.parse(localStorage.getItem(SPEICHER + id) || 'null'); } catch (e) { return null; }
  }
  function speichereEntwurf() {
    // basis: Wert beim Laden; beim Wiederherstellen wird ein Feld nur übernommen, wenn er noch gilt.
    const werte = {}, basis = {};
    for (const f of t.felder) {
      const w = wert(t.jetzt, f);
      if (w !== wert(t.orig, f)) { werte[schluessel(f)] = w; basis[schluessel(f)] = wert(t.orig, f); }
    }
    try {
      if (Object.keys(werte).length) localStorage.setItem(SPEICHER + t.id, JSON.stringify({ werte, basis }));
      else localStorage.removeItem(SPEICHER + t.id);
    } catch (e) { /* privater Modus: Entwurf bleibt nur bis zum Schließen */ }
  }
  function loescheEntwurf(id) { try { localStorage.removeItem(SPEICHER + id); } catch (e) { /* egal */ } }

  // --- Fehler ---------------------------------------------------------------------------
  function fehler(e) {
    const art = e && e.art;
    if (art === 'abgelaufen') {
      sitzung.token = null;
      zeigeAbgemeldet();
      return meldung('Ihre Anmeldung ist abgelaufen. Bitte erneut anmelden. Ihr Entwurf bleibt gespeichert.', 'fehler', loginLink('Erneut anmelden'));
    }
    if (art === 'konflikt') {
      return meldung('Ihre Änderung konnte nicht gespeichert werden, weil sich die Inhalte in der Zwischenzeit geändert haben. ' +
        'Ihr Entwurf bleibt erhalten. Seitenschwung kümmert sich darum; bitte geben Sie kurz Bescheid.', 'fehler');
    }
    if (art === 'netz') return meldung('Keine Verbindung. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.', 'fehler');
    meldung('Das hat leider nicht geklappt' + (e && e.status ? ' (Fehler ' + e.status + ')' : '') +
      '. Ihr Entwurf bleibt erhalten. Bitte versuchen Sie es später erneut oder wenden Sie sich an Seitenschwung.', 'fehler');
  }

  // --- Ansicht: abgemeldet -----------------------------------------------------------------
  function hatEntwuerfe() {
    try { return Object.keys(localStorage).some((k) => k.startsWith(SPEICHER)); } catch (e) { return false; }
  }
  function zeigeAbgemeldet() {
    t = null;
    ansicht(el('div', { klasse: 'ed-karte' },
      el('h2', { text: 'Anmelden' }),
      el('p', { text: 'Melden Sie sich mit Ihrem GitHub-Konto an, um die Texte der Selbsttests zu bearbeiten. ' +
        'Ihre Änderungen gehen erst online, wenn Seitenschwung sie freigegeben hat.' }),
      hatEntwuerfe() && el('p', { klasse: 'ed-leise', text: 'Ein ungesendeter Entwurf ist in diesem Browser gespeichert und nach der Anmeldung wieder da.' }),
      loginLink()));
  }

  // --- Ansicht: Testwahl ---------------------------------------------------------------------
  function kopfleiste() {
    return el('div', { klasse: 'ed-leiste' },
      el('p', { klasse: 'ed-leise', text: 'Angemeldet als ' + sitzung.login }),
      knopf('Abmelden', 'knopf-rand ed-klein', () => { sitzung.token = null; sitzung.ablauf = 0; meldung(''); zeigeAbgemeldet(); }));
  }
  function keinZugriff() {
    return !sitzung.darfSchreiben && el('p', { klasse: 'shop-hinweis', role: 'note',
      text: 'Kein Zugriff: Ihr Konto darf keine Änderungen senden. Sie können die Texte ansehen und ausprobieren; ' +
        'zum Senden wenden Sie sich bitte an Seitenschwung.' });
  }

  function zeigeTestwahl() {
    t = null;
    const liste = el('ul', { klasse: 'karten ed-wahl' });
    stand.gruppe.tests.eintraege.forEach((e, i) => {
      const marken = el('ul', { klasse: 'schlagworte' },
        e.kurz && el('li', { text: e.kurz }),
        e.sichtbar !== true && el('li', { text: 'Nicht veröffentlicht' }),
        leseEntwurf(e.id) && el('li', { text: 'Entwurf gespeichert' }));
      liste.append(el('li', { klasse: 'karte' }, el('div', { klasse: 'karte-inhalt' }, marken,
        el('h3', { text: e.titel }),
        e.beschreibung && el('p', { text: e.beschreibung }),
        knopf('Bearbeiten', 'knopf-dunkel', () => oeffneTest(i).catch(fehler), { 'aria-label': 'Bearbeiten: ' + e.titel }))));
    });
    ansicht(kopfleiste(), keinZugriff(), el('h2', { text: 'Welchen Test möchten Sie bearbeiten?' }), liste);
  }

  // --- Test laden ------------------------------------------------------------------------
  const wert = (stand_, f) => {
    let w = stand_[f.datei];
    f.pfad.replace(/([^.[\]]+)|\[(\d+)\]/g, (_, n, i) => { w = w == null ? w : w[n !== undefined ? n : Number(i)]; return ''; });
    return w;
  };

  async function oeffneTest(i) {
    meldung('Test wird geladen …');
    const basisEintrag = stand.gruppe.tests.eintraege[i];
    const pr = await gh('offenerPr', basisEintrag.id);
    // Wartet schon eine Änderung auf Freigabe, wird auf deren Stand weitergearbeitet (derselbe PR, neuer Commit).
    const ref = pr ? pr.branch : undefined;
    const gruppe = pr ? JSON.parse((await gh('ladeDatei', PFAD_GRUPPE, ref)).text) : stand.gruppe;
    const eintrag = gruppe.tests.eintraege[i];
    const pfadDaten = KUNDE + eintrag.daten.replace(/^\.\//, '');
    const daten = JSON.parse((await gh('ladeDatei', pfadDaten, ref)).text);
    t = {
      index: i, id: eintrag.id, pfadDaten, gruppe, pr, ansicht: 'fragen', spec: '', frage: null, timer: null,
      orig: { test: daten, eintrag }, jetzt: { test: daten, eintrag }, felder: K.felder(daten, eintrag),
    };
    const r = K.entwurfAnwenden(t.jetzt, leseEntwurf(t.id), t.felder);
    t.jetzt = r.daten;
    const teile = [];
    if (r.angewendet) {
      teile.push('Ihr gespeicherter Entwurf wurde wiederhergestellt (' + r.angewendet +
        (r.angewendet === 1 ? ' geändertes Feld).' : ' geänderte Felder).'));
    }
    if (r.verworfen.length) {
      teile.push('Diese Felder wurden inzwischen geändert; Ihr Entwurf wurde dort nicht übernommen: ' + r.verworfen.join(', ') + '.');
    }
    meldung(teile.join(' '), r.verworfen.length ? 'fehler' : 'info');
    zeigeBearbeiten();
  }

  // --- Ansicht: bearbeiten -----------------------------------------------------------------
  function zeigeBearbeiten() {
    const formular = el('div', { klasse: 'ed-formular', id: 'ed-formular' });
    const istStufen = t.jetzt.test.result.kind === 'levels';
    t.dom = { felder: new Map(), gruppen: new Map() };
    for (const [g, titel] of GRUPPEN) {
      const liste = t.felder.filter((f) => f.gruppe === g)
        .sort((a, b) => (a.datei === b.datei ? 0 : a.datei === 'eintrag' ? -1 : 1));
      if (!liste.length) continue;
      const zahl = el('span', { klasse: 'ed-zahl' });
      const gruppe = el('details', { klasse: 'ed-gruppe', open: g === 'start' },
        el('summary', {}, el('span', { klasse: 'ed-gruppe-titel', text: titel }), zahl));
      if (g === 'stufen') gruppe.append(el('p', { klasse: 'ed-leise', text: 'Die Grenzen der Stufen (z. B. „ab 50 %“) sind fest und lassen sich hier nicht ändern.' }));
      if (g === 'bereiche' && istStufen) gruppe.append(el('p', { klasse: 'ed-leise', text: 'Diese Texte erscheinen im Ergebnis bei den einzelnen Bereichen.' }));
      liste.forEach((f) => gruppe.append(feldElement(f)));
      t.dom.gruppen.set(g, { el: gruppe, zahl, anzahl: liste.length });
      formular.append(gruppe);
    }

    const sendeKnopf = knopf('Zur Freigabe senden', 'knopf-dunkel', oeffneDialog);
    t.dom.senden = sendeKnopf;
    t.dom.offen = el('p', { klasse: 'ed-leise', 'aria-live': 'polite' });
    t.dom.hinweise = el('ul', { klasse: 'ed-hinweise' });
    const aktionen = el('div', { klasse: 'ed-aktionen' },
      t.dom.hinweise, t.dom.offen,
      el('div', { klasse: 'knoepfe' }, sitzung.darfSchreiben && sendeKnopf,
        knopf('Anderen Test wählen', 'knopf-rand', zurTestwahl)));

    const vorschau = vorschauBereich();
    const umschalter = el('div', { klasse: 'ed-umschalter ed-modus', role: 'group', 'aria-label': 'Bearbeiten oder Vorschau' });
    const flaeche = el('div', { klasse: 'ed-flaeche' }, el('div', { klasse: 'ed-spalte-form' }, formular, aktionen), vorschau);
    [['Bearbeiten', false], ['Vorschau', true]].forEach(([text, zeigt]) => {
      umschalter.append(knopf(text, 'knopf-rand ed-klein', (ev) => {
        flaeche.classList.toggle('ed-zeigt-vorschau', zeigt);
        umschalter.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === ev.currentTarget)));
        if (zeigt) planeVorschau(0);
      }, { 'aria-pressed': String(!zeigt) }));
    });

    ansicht(kopfleiste(), keinZugriff(),
      el('h2', { text: t.jetzt.eintrag.titel }),
      t.pr && statusBox(true),
      umschalter, flaeche, dialog());
    waehleAnsicht(t.ansicht);
    pruefe();
    planeVorschau(0);
  }

  function feldElement(f) {
    const n = ++zaehler;
    const id = 'ed-f-' + n;
    const hilfeText = [f.hinweis, f.betont ? 'Ein Wort zwischen Sternchen wird hervorgehoben, z. B. *Wort*.' : ''].filter(Boolean).join(' ');
    const hilfe = hilfeText && el('p', { klasse: 'ed-hilfe', id: id + '-h', text: hilfeText });
    const fehlerEl = el('p', { klasse: 'ed-fehler', id: id + '-m', hidden: true });
    const eingabe = f.mehrzeilig
      ? el('textarea', { id, rows: String(Math.min(8, Math.max(3, Math.ceil(f.wert.length / 60)))) })
      : el('input', { id, type: 'text' });
    eingabe.value = wert(t.jetzt, f);
    const marke = el('span', { klasse: 'ed-marke', text: 'geändert', hidden: true });
    const zurueck = knopf('Zurücksetzen', 'knopf-rand ed-klein', () => {
      setzeWert(f, wert(t.orig, f));
      eingabe.value = wert(t.orig, f);
      eingabe.focus();
    }, { hidden: true, 'aria-label': 'Zurücksetzen: ' + f.label });
    eingabe.addEventListener('input', () => setzeWert(f, eingabe.value));
    eingabe.addEventListener('focus', () => folgeFokus(f));
    const box = el('div', { klasse: 'ed-feld' },
      el('div', { klasse: 'ed-feld-kopf' }, el('label', { for: id, text: f.label }), marke, zurueck),
      eingabe, hilfe, fehlerEl);
    t.dom.felder.set(schluessel(f), { f, box, eingabe, marke, zurueck, fehlerEl, hilfeId: hilfe ? id + '-h' : '' });
    return box;
  }

  function setzeWert(f, w) {
    t.jetzt = Object.assign({}, t.jetzt, { [f.datei]: K.setze(t.jetzt[f.datei], f.pfad, w) });
    speichereEntwurf();
    pruefe();
    planeVorschau();
  }

  // Meldungen von Textregeln und Struktur, je Feld zugeordnet.
  function meldungen() {
    const je = new Map();
    const allgemein = [];
    const dazu = (datei, pfad, text) => {
      const k = datei + '|' + pfad;
      if (t.dom.felder.has(k)) (je.get(k) || je.set(k, []).get(k)).push(text);
      else allgemein.push(text);
    };
    W.pruefeTexte(t.jetzt.test, W.TEXTFELDER_TEST).forEach((m) => dazu('test', m.pfad, m.meldung));
    W.pruefeTexte(t.jetzt.eintrag, W.TEXTFELDER_EINTRAG).forEach((m) => dazu('eintrag', m.pfad, m.meldung));
    const struktur = (datei, daten, soll, felder) => {
      if (!soll) return allgemein.push('Für diesen Test fehlt der Abdruck der Struktur. Bitte wenden Sie sich an Seitenschwung.');
      W.pruefeStruktur(daten, soll, felder).forEach((m) => {
        const [pfad, ...rest] = m.split(': ');
        const platzhalter = m.includes('{names}');
        const text = platzhalter && /fehlt$/.test(m) ? 'Der Platzhalter {names} muss stehen bleiben.'
          : platzhalter && m.includes('mehrfach') ? 'Der Platzhalter {names} darf nur einmal vorkommen.'
            : 'Diese Änderung ist hier nicht möglich (' + rest.join(': ') + ').';
        dazu(datei, pfad, text);
      });
    };
    struktur('test', t.jetzt.test, (stand.struktur.tests || {})[t.jetzt.test.id], W.TEXTFELDER_TEST);
    struktur('eintrag', t.jetzt.eintrag, (stand.struktur.eintraege || [])[t.index], W.TEXTFELDER_EINTRAG);
    return { je, allgemein };
  }

  function pruefe() {
    const { je, allgemein } = meldungen();
    const zahlen = new Map();
    let offen = allgemein.length;
    t.dom.hinweise.replaceChildren(...allgemein.map((m) => el('li', { text: m })));
    for (const [k, x] of t.dom.felder) {
      const liste = je.get(k) || [];
      const geaendert = wert(t.jetzt, x.f) !== wert(t.orig, x.f);
      offen += liste.length;
      x.fehlerEl.textContent = liste.join(' ');
      x.fehlerEl.hidden = !liste.length;
      x.marke.hidden = !geaendert;
      x.zurueck.hidden = !geaendert;
      x.box.classList.toggle('ed-ist-geaendert', geaendert);
      x.box.classList.toggle('ed-ist-fehler', liste.length > 0);
      x.eingabe.setAttribute('aria-invalid', String(liste.length > 0));
      const ids = [x.hilfeId, liste.length ? x.fehlerEl.id : ''].filter(Boolean).join(' ');
      if (ids) x.eingabe.setAttribute('aria-describedby', ids); else x.eingabe.removeAttribute('aria-describedby');
      const z = zahlen.get(x.f.gruppe) || { geaendert: 0, fehler: 0 };
      z.geaendert += geaendert ? 1 : 0;
      z.fehler += liste.length;
      zahlen.set(x.f.gruppe, z);
      if (liste.length) {
        t.dom.hinweise.append(el('li', {}, el('button', { type: 'button', klasse: 'ed-sprung', text: x.f.label + ': ' + liste.join(' '),
          onclick: () => { x.box.closest('details').open = true; x.eingabe.focus(); } })));
      }
    }
    for (const [g, info] of t.dom.gruppen) {
      const z = zahlen.get(g) || { geaendert: 0, fehler: 0 };
      info.zahl.textContent = info.anzahl + (info.anzahl === 1 ? ' Feld' : ' Felder') +
        (z.geaendert ? ' · ' + z.geaendert + ' geändert' : '') + (z.fehler ? ' · ' + z.fehler + (z.fehler === 1 ? ' Hinweis' : ' Hinweise') : '');
      info.el.classList.toggle('ed-ist-fehler', z.fehler > 0);
    }
    const anzahl = K.aenderungen(t.orig, t.jetzt, t.felder).length;
    t.dom.senden.disabled = offen > 0 || anzahl === 0;
    t.dom.senden.textContent = offen > 0 ? 'Noch ' + offen + (offen === 1 ? ' Hinweis offen' : ' Hinweise offen') : 'Zur Freigabe senden';
    // Live-Region nur bei geändertem Inhalt neu setzen (sonst Ansage bei jedem Tastendruck)
    const offenText = offen > 0 ? 'Noch ' + offen + (offen === 1 ? ' Hinweis' : ' Hinweise') + ' offen. Bitte beheben Sie zuerst die markierten Stellen.'
      : anzahl === 0 ? 'Noch keine Änderungen.' : anzahl + (anzahl === 1 ? ' Änderung' : ' Änderungen') + ' bereit zum Senden.';
    if (t.dom.offen.textContent !== offenText) t.dom.offen.textContent = offenText;
  }

  // --- Vorschau -------------------------------------------------------------------------------
  function vorschauBereich() {
    const iframe = el('iframe', { klasse: 'ed-rahmen', title: 'Vorschau der Testseite' });
    const ansichten = el('div', { klasse: 'ed-umschalter', role: 'group', 'aria-label': 'Was die Vorschau zeigt' });
    const auswahl = el('select', { id: 'ed-auswahl' });
    const r = t.jetzt.test.result;
    if (r.kind === 'levels') {
      r.levels.map((l, i) => ({ l, i })).sort((a, b) => a.l.min - b.l.min).forEach(({ l }, j) => {
        auswahl.append(el('option', { value: 'stufe:' + j, text: 'ab ' + l.min + ' %: ' + l.title }));
      });
    } else {
      t.jetzt.test.categories.forEach((c) => auswahl.append(el('option', { value: 'bereich:' + c.id, text: c.name })));
    }
    t.spec = auswahl.value;
    auswahl.addEventListener('change', () => { t.spec = auswahl.value; planeVorschau(0); });
    const auswahlBox = el('div', { klasse: 'ed-auswahl', hidden: true },
      el('label', { for: 'ed-auswahl', text: r.kind === 'levels' ? 'Welche Stufe soll das Ergebnis zeigen?' : 'Welcher Bereich soll vorne liegen?' }),
      auswahl);
    const status = el('p', { klasse: 'ed-leise ed-vorschau-info', 'aria-live': 'polite' });
    [['fragen', 'Fragen'], ['ergebnis', 'Ergebnis'], ['kachel', 'Kachel']].forEach(([a, text]) => {
      ansichten.append(knopf(text, 'knopf-rand ed-klein', () => { waehleAnsicht(a); planeVorschau(0); },
        { 'aria-pressed': String(a === t.ansicht), 'data-ansicht': a }));
    });
    t.dom.vorschau = { iframe, ansichten, auswahl, auswahlBox, status };
    return el('div', { klasse: 'ed-spalte-vorschau', id: 'ed-vorschau' },
      el('h3', { klasse: 'sr-only', text: 'Vorschau' }), iframe, ansichten, auswahlBox, status);
  }

  function waehleAnsicht(a) {
    t.ansicht = a;
    const v = t.dom.vorschau;
    v.ansichten.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ansicht === a)));
    v.auswahlBox.hidden = a !== 'ergebnis';
  }

  // Beim Bearbeiten springt die Vorschau zur passenden Stelle (Frage, Bereich, Stufe, Kachel).
  function folgeFokus(f) {
    const s = f.pfad.match(/\[(\d+)\]/g) || [];
    const nr = (k) => Number((s[k] || '[0]').slice(1, -1));
    let a = 'fragen', frage = null, spec = t.spec;
    if (f.datei === 'eintrag' && (f.pfad === 'kurz' || f.pfad === 'beschreibung')) a = 'kachel';
    else if (f.gruppe === 'fragen') frage = nr(0);
    else if (f.gruppe === 'skala') frage = t.frage === null ? 0 : t.frage;
    else if (f.gruppe === 'bereiche' || f.gruppe === 'ergebnis' || f.gruppe === 'stufen') {
      a = 'ergebnis';
      const r = t.jetzt.test.result;
      if (f.gruppe === 'bereiche' && r.kind !== 'levels') spec = 'bereich:' + t.jetzt.test.categories[nr(0)].id;
      if (f.gruppe === 'stufen') {
        const sortiert = r.levels.slice().sort((x, y) => x.min - y.min);
        spec = 'stufe:' + sortiert.indexOf(r.levels[nr(0)]);
      }
    }
    if (a === t.ansicht && frage === t.frage && spec === t.spec) return;
    waehleAnsicht(a);
    t.frage = frage;
    t.spec = spec;
    t.dom.vorschau.auswahl.value = spec;
    planeVorschau();
  }

  function planeVorschau(ms) {
    if (!t) return;
    clearTimeout(t.timer);
    const id = t.id;
    t.timer = setTimeout(() => { if (t && t.id === id) rendere().catch(() => {}); }, ms === undefined ? 400 : ms);
  }

  async function rendere() {
    const v = t.dom.vorschau;
    let html;
    try { html = await V.ladeSeite(t.id); } catch (e) {
      v.status.textContent = 'Die Vorschau ist gerade nicht verfügbar (die veröffentlichte Testseite konnte nicht geladen werden).';
      return;
    }
    const doc = V.dokument(html, t.jetzt.eintrag, t.jetzt.test, t.gruppe.tests, t.ansicht, t.spec);
    const frage = t.ansicht === 'fragen' && t.frage !== null ? t.frage : undefined;
    V.zeige(v.iframe, doc, { frage, halten: t.ansicht !== 'fragen' && v.zuletzt === t.ansicht + t.spec });
    v.zuletzt = t.ansicht + t.spec;
    v.status.textContent = t.ansicht === 'kachel' ? 'So erscheint der Test in der Übersicht der Selbsttests.'
      : t.ansicht === 'ergebnis' ? 'Beispiel-Ergebnis mit erfundenen Antworten.'
        : frage !== undefined ? 'Die Vorschau zeigt Frage ' + (frage + 1) + '.' : 'Startseite des Tests.';
  }

  // --- Senden ---------------------------------------------------------------------------------
  function dialog() {
    const notiz = el('textarea', { id: 'ed-notiz', rows: '3', maxlength: '500' });
    const liste = el('ul', { klasse: 'ed-liste' });
    const fehlerP = el('p', { klasse: 'ed-fehler', role: 'alert' });
    const dlg = el('dialog', { klasse: 'ed-dialog', 'aria-labelledby': 'ed-dialog-titel' },
      el('h2', { id: 'ed-dialog-titel', text: 'Zur Freigabe senden' }),
      el('p', { text: 'Diese Änderungen gehen an Seitenschwung. Sie werden online sichtbar, sobald sie freigegeben sind.' }),
      liste,
      el('label', { for: 'ed-notiz', text: 'Notiz an Seitenschwung (optional)' }), notiz, fehlerP,
      el('div', { klasse: 'knoepfe' },
        knopf('Jetzt senden', 'knopf-dunkel', () => sende(dlg, notiz.value).catch((e) => { dlg.close(); fehler(e); })),
        knopf('Abbrechen', 'knopf-rand', () => dlg.close())));
    t.dom.dialog = { dlg, liste, fehlerP };
    dlg.addEventListener('close', () => { if (t && t.dom.senden.isConnected) t.dom.senden.focus(); });
    return dlg;
  }

  function oeffneDialog() {
    const x = t.dom.dialog;
    x.liste.replaceChildren(...K.aenderungen(t.orig, t.jetzt, t.felder).map((a) =>
      el('li', {}, el('strong', { text: a.label }), el('br'), el('span', { klasse: 'ed-alt', text: a.alt }), ' → ', el('span', { text: a.neu }))));
    x.fehlerP.textContent = '';
    x.dlg.showModal();
  }

  function konflikt() {
    const e = new Error('Konflikt');
    e.art = 'konflikt';
    return e;
  }

  // Eigene Änderungen auf den frisch gelesenen Stand anwenden; dieselben Regeln wie beim Bearbeiten prüfen.
  function anwenden(gruppeFrisch, datenFrisch, strukturFrisch) {
    const eintragFrisch = gruppeFrisch.tests && gruppeFrisch.tests.eintraege && gruppeFrisch.tests.eintraege[t.index];
    if (!eintragFrisch || eintragFrisch.id !== t.id || eintragFrisch.daten !== t.orig.eintrag.daten) throw konflikt();
    const nur = (datei) => t.felder.filter((f) => f.datei === datei);
    const rT = K.wendeAn(datenFrisch, t.orig.test, t.jetzt.test, nur('test'));
    const rE = K.wendeAn(eintragFrisch, t.orig.eintrag, t.jetzt.eintrag, nur('eintrag'));
    if (rT.konflikt || rE.konflikt) throw konflikt();
    const sollT = (strukturFrisch.tests || {})[rT.daten.id];
    const sollE = (strukturFrisch.eintraege || [])[t.index];
    const meldungen = !sollT || !sollE ? ['Abdruck fehlt'] : [].concat(
      W.pruefeTexte(rT.daten, W.TEXTFELDER_TEST), W.pruefeTexte(rE.daten, W.TEXTFELDER_EINTRAG),
      W.pruefeStruktur(rT.daten, sollT, W.TEXTFELDER_TEST), W.pruefeStruktur(rE.daten, sollE, W.TEXTFELDER_EINTRAG));
    if (meldungen.length) throw konflikt();
    const gruppe = rE.daten === eintragFrisch ? gruppeFrisch
      : K.setze(gruppeFrisch, 'tests.eintraege[' + t.index + ']', rE.daten);
    return { test: rT.daten, eintrag: rE.daten, gruppe };
  }

  async function sende(dlg, notiz) {
    const knoepfe = dlg.querySelectorAll('button');
    knoepfe.forEach((b) => { b.disabled = true; });
    try {
      const liste = K.aenderungen(t.orig, t.jetzt, t.felder);
      if (!liste.length) return dlg.close();
      // Hat sich inzwischen etwas geändert (anderer PR offen oder der alte schon erledigt), nicht blind weiterschreiben.
      const offen = await gh('offenerPr', t.id);
      if ((offen && offen.nummer) !== (t.pr && t.pr.nummer)) {
        dlg.close();
        return meldung('In der Zwischenzeit hat sich der Stand dieses Tests geändert. Bitte öffnen Sie den Test erneut; ' +
          'Ihr Entwurf bleibt erhalten.', 'fehler', knopf('Test neu öffnen', 'knopf-dunkel', () => oeffneTest(t.index).catch(fehler)));
      }
      // Frisch vom Ziel lesen (PR-Branch oder main, fester Commit), eigene Änderungen darauf anwenden, neu prüfen.
      // So überschreibt der PR keine Änderungen, die inzwischen von anderer Seite gemacht wurden.
      const kopf = await gh('kopf', t.pr ? t.pr.branch : 'main');
      const lies = async (pfad) => JSON.parse((await gh('ladeDatei', pfad, kopf)).text);
      const [gruppeFrisch, datenFrisch, strukturFrisch] = await Promise.all([lies(PFAD_GRUPPE), lies(t.pfadDaten), lies(PFAD_STRUKTUR)]);
      const neu = anwenden(gruppeFrisch, datenFrisch, strukturFrisch);
      const dateien = [];
      if (neu.test !== datenFrisch) dateien.push({ pfad: t.pfadDaten, text: JSON.stringify(neu.test, null, 2) + '\n' });
      if (neu.gruppe !== gruppeFrisch) dateien.push({ pfad: PFAD_GRUPPE, text: JSON.stringify(neu.gruppe, null, 2) + '\n' });
      const text = K.prText(t.jetzt.eintrag.titel, liste, notiz);
      const pr = await gh('sende', { testId: t.id, dateien, titel: text.titel, text: text.text, pr: t.pr || undefined, erwartet: kopf });
      loescheEntwurf(t.id);
      t.pr = pr;
      t.gruppe = neu.gruppe;
      t.orig = { test: neu.test, eintrag: neu.eintrag };
      t.jetzt = t.orig;
      t.felder = K.felder(neu.test, neu.eintrag);
      dlg.close();
      await ladeStand().catch(() => {});
      zeigeGesendet();
    } finally {
      knoepfe.forEach((b) => { b.disabled = false; });
    }
  }

  // --- Status und Ansicht: gesendet ---------------------------------------------------------
  function statusBox(vorhanden) {
    const zustand = el('strong', { text: 'Wird abgefragt …' });
    const box = el('div', { klasse: 'ed-status', role: 'status' },
      el('p', { text: vorhanden ? 'Für diesen Test wartet bereits eine Änderung auf Freigabe. Sie bearbeiten diesen Stand weiter; ' +
        'beim Senden kommt Ihre Änderung dazu.' : 'Ihre Änderungen wurden zur Freigabe gesendet. Vielen Dank!' }),
      el('p', {}, 'Stand: ', zustand),
      el('div', { klasse: 'knoepfe' },
        el('a', { klasse: 'knopf knopf-rand ed-klein', href: t.pr.url, target: '_blank', rel: 'noopener noreferrer', text: 'Änderung auf GitHub ansehen' }),
        knopf('Status aktualisieren', 'knopf-rand ed-klein', () => aktualisiere(zustand))));
    aktualisiere(zustand);
    return box;
  }

  async function aktualisiere(zustand) {
    zustand.textContent = 'Wird abgefragt …';
    try {
      const s = await gh('status', t.pr.nummer);
      let text = s.zustand === 'offen' ? 'Wartet auf Freigabe' : s.zustand === 'gemergt' ? 'Freigegeben, geht live' : 'Geschlossen, nicht freigegeben';
      if (s.zustand === 'gemergt' && s.mergeSha) {
        try {
          const r = await fetch('/version.txt', { cache: 'no-store' });
          const v = r.ok ? (await r.text()).trim() : '';
          if (v && v.startsWith(s.mergeSha)) text = 'Live';
        } catch (e) { /* Seite gerade nicht erreichbar: bleibt bei „geht live“ */ }
      }
      zustand.textContent = text;
    } catch (e) {
      zustand.textContent = 'Unbekannt';
      fehler(e);
    }
  }

  function zeigeGesendet() {
    meldung('');
    ansicht(kopfleiste(), el('h2', { text: t.jetzt.eintrag.titel + ': gesendet' }), statusBox(false),
      el('div', { klasse: 'knoepfe' },
        knopf('Weiter bearbeiten', 'knopf-dunkel', zeigeBearbeiten),
        knopf('Anderen Test wählen', 'knopf-rand', zurTestwahl)));
  }

  // --- Start --------------------------------------------------------------------------------
  async function ladeStand() {
    const [g, s] = await Promise.all([gh('ladeDatei', PFAD_GRUPPE), gh('ladeDatei', PFAD_STRUKTUR)]);
    stand = { gruppe: JSON.parse(g.text), struktur: JSON.parse(s.text) };
  }
  // Zurück zur Testwahl mit frischem Stand (Titel, Kurzinfos); scheitert das Laden, bleibt der bisherige.
  function zurTestwahl() {
    meldung('');
    ladeStand()
      .catch((e) => { if (e && e.art === 'abgelaufen') throw e; })
      .then(() => { if (sitzung.token) zeigeTestwahl(); })
      .catch(fehler);
  }

  async function starte() {
    meldung('Anmeldung wird geprüft …');
    const z = await gh('zugriff');
    sitzung.login = z.login;
    sitzung.darfSchreiben = z.darfSchreiben;
    await ladeStand();
    meldung('');
    zeigeTestwahl();
  }

  const frag = new URLSearchParams(location.hash.slice(1));
  if (location.hash) history.replaceState(null, '', location.pathname);
  const token = frag.get('token');
  if (token) {
    sitzung.token = token;
    const ablauf = Number(frag.get('ablauf'));
    if (ablauf > 0) sitzung.ablauf = Date.now() + ablauf * 1000;
    starte().catch(fehler);
  } else {
    zeigeAbgemeldet();
    const f = frag.get('fehler');
    if (f) {
      meldung(f === 'state'
        ? 'Die Anmeldung konnte nicht bestätigt werden (zu lange gewartet oder in einem anderen Fenster begonnen). Bitte melden Sie sich erneut an.'
        : 'Die Anmeldung bei GitHub hat nicht geklappt. Bitte versuchen Sie es erneut.', 'fehler', loginLink('Erneut anmelden'));
    }
  }
})();
