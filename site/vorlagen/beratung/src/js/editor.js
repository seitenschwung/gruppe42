/* Test-Editor (/editor/): Texte der Selbsttests bearbeiten, prüfen, in der Vorschau ansehen und live speichern.
   Ansichten: abgemeldet, einrichten (#einladung=), testwahl, bearbeiten, verlauf. Anmeldung per Passkey; die Sitzung
   ist ein HttpOnly-Cookie (für das Skript unsichtbar). Ungespeicherte Entwürfe (nur Texte) liegen in localStorage.
   Alles DOM entsteht über textContent; Markup für die Vorschau kommt ausschließlich aus Testseite (maskiert). */
(function () {
  'use strict';
  const d = document;
  const W = window.Testwaechter, K = window.EditorKern, A = window.EditorApi, P = window.EditorPasskey, V = window.EditorVorschau;
  const app = d.querySelector('[data-ed-app]');
  const meldungEl = d.querySelector('[data-ed-meldung]');
  if (!app || !meldungEl || !W || !K || !A || !P || !V || !window.Testseite) return;

  // fetch und credentials werden einmal beim Laden festgehalten; spätere Änderungen (z. B. durch Fremdskripte) wirken nicht.
  const api = A.erstelle(window.fetch.bind(window));
  const nav = { credentials: navigator.credentials };
  const passkeyDa = P.unterstuetzt(window);
  const SPEICHER = 'g42-editor-entwurf-';
  const GRUPPEN = [
    ['start', 'Startseite des Tests'], ['skala', 'Antwortskala'], ['fragen', 'Fragen'],
    ['ergebnis', 'Ergebnis: allgemein'], ['stufen', 'Ergebnis-Stufen'], ['bereiche', 'Ergebnis je Bereich'],
  ];
  const AUS = {
    aus: 'Der Editor ist derzeit nicht eingeschaltet. Bitte wenden Sie sich an Seitenschwung.',
    nicht_schreibbar: 'Speichern ist gerade nicht möglich, weil der Datenspeicher nicht erreichbar ist. Ihr Entwurf bleibt erhalten. Bitte wenden Sie sich an Seitenschwung.',
    overlay_unlesbar: 'Die gespeicherten Änderungen können gerade nicht gelesen werden. Bitte wenden Sie sich an Seitenschwung.',
    gesperrt: 'Gerade wird an anderer Stelle gespeichert. Bitte versuchen Sie es in einem Moment erneut; Ihr Entwurf bleibt erhalten.',
  };

  let wer = '';
  let stand = null; // { tests: [{id, titel, sichtbar, daten, eintrag, verwaist}], testsCfg } von /api/editor/stand
  let t = null; // aktuell bearbeiteter Test
  let zaehler = 0;

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
  const seitenLink = (id, text) => el('a', { klasse: 'knopf knopf-rand ed-klein', href: '/' + encodeURIComponent(id) + '.html',
    target: '_blank', rel: 'noopener', text: text || 'Testseite ansehen' });

  function meldung(text, art, ...extra) {
    meldungEl.replaceChildren();
    meldungEl.className = 'ed-meldung' + (text ? ' ed-meldung-' + (art || 'info') : '');
    if (text) meldungEl.append(el('p', { text }), ...extra);
    // Die Meldung steht über dem Formular; liegt sie außerhalb des sichtbaren Bereichs, dorthin scrollen.
    if (text && meldungEl.getBoundingClientRect().top < 0) meldungEl.scrollIntoView({ block: 'center' });
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
  // Knöpfe während einer Anfrage sperren (gegen Doppelklicks).
  async function gesperrt(knoepfe, fn) {
    knoepfe.forEach((b) => { b.disabled = true; });
    try { return await fn(); } finally { knoepfe.forEach((b) => { b.disabled = false; }); }
  }

  // --- Entwurf (nur Texte) ------------------------------------------------------------------
  const schluessel = (f) => f.datei + '|' + f.pfad;
  function leseEntwurf(id) {
    try { return JSON.parse(localStorage.getItem(SPEICHER + id) || 'null'); } catch (e) { return null; }
  }
  function speichereEntwurf() {
    // basis: Wert beim Laden; beim Wiederherstellen wird ein Feld nur übernommen, wenn er noch gilt.
    const werte = {}, basis = {};
    for (const f of t.felder) {
      if (f.fest) continue;
      const w = wert(t.jetzt, f);
      if (w !== wert(t.orig, f)) { werte[schluessel(f)] = w; basis[schluessel(f)] = wert(t.orig, f); }
    }
    try {
      if (Object.keys(werte).length) localStorage.setItem(SPEICHER + t.id, JSON.stringify({ werte, basis }));
      else localStorage.removeItem(SPEICHER + t.id);
    } catch (e) { /* privater Modus: Entwurf bleibt nur bis zum Schließen */ }
  }
  function loescheEntwurf(id) { try { localStorage.removeItem(SPEICHER + id); } catch (e) { /* egal */ } }
  function hatEntwuerfe() {
    try { return Object.keys(localStorage).some((k) => k.startsWith(SPEICHER)); } catch (e) { return false; }
  }

  // --- Fehler ---------------------------------------------------------------------------
  // Allgemeine Fehlerbehandlung; Konflikt und ungültige Texte behandeln Speichern und Rückgängig selbst.
  function fehler(e) {
    const art = e && e.art;
    if (art === 'anmeldung') {
      zeigeAbgemeldet();
      return meldung('Bitte erneut anmelden. Ihr Entwurf bleibt in diesem Browser gespeichert.', 'fehler');
    }
    if (art === 'aus') return meldung(AUS[e.grund] || AUS.aus, 'fehler');
    if (art === 'zuviele') return meldung('Zu viele Anfragen in kurzer Zeit. Bitte warten Sie eine Minute und versuchen Sie es dann erneut.', 'fehler');
    if (art === 'herkunft') return meldung('Die Anfrage wurde abgelehnt. Bitte öffnen Sie den Editor direkt über die Adresse der Website.', 'fehler');
    if (art === 'netz') return meldung('Keine Verbindung. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.', 'fehler');
    if (art === 'unbekannt') {
      zurTestwahl();
      return meldung('Diesen Test gibt es nicht mehr.', 'fehler');
    }
    if (art === 'konflikt') return meldung('Das Feld „' + labelFuer(e.pfad) + '“ wurde inzwischen geändert. Bitte laden Sie den Test neu.', 'fehler');
    meldung('Das hat leider nicht geklappt' + (e && e.status ? ' (Fehler ' + e.status + ')' : '') +
      '. Ihr Entwurf bleibt erhalten. Bitte versuchen Sie es später erneut oder wenden Sie sich an Seitenschwung.', 'fehler');
  }
  // Label eines Feldes für Meldungen (Pfad aus der Server-Antwort, ohne Dateiangabe).
  function labelFuer(pfad, datei) {
    const f = t && t.felder.find((x) => x.pfad === pfad && (!datei || x.datei === datei));
    return f ? f.label : (pfad || 'unbekannt');
  }

  // --- Ansichten: abgemeldet und einrichten ----------------------------------------------------
  const keinPasskey = () => !passkeyDa && el('p', { klasse: 'shop-hinweis', role: 'note', text: 'Dieser Browser unterstützt keine Passkeys.' });

  function zeigeAbgemeldet() {
    t = null;
    stand = null;
    const k = knopf('Mit Passkey anmelden', 'knopf-dunkel', () => gesperrt([k], anmelden).catch(passkeyFehler), { disabled: !passkeyDa });
    ansicht(el('div', { klasse: 'ed-karte' },
      el('h2', { text: 'Anmelden' }),
      el('p', { text: 'Melden Sie sich mit Ihrem Passkey an, um die Texte der Selbsttests zu bearbeiten. ' +
        'Gespeicherte Änderungen sind sofort auf der Website sichtbar.' }),
      hatEntwuerfe() && el('p', { klasse: 'ed-leise', text: 'Ein ungespeicherter Entwurf ist in diesem Browser gespeichert und nach der Anmeldung wieder da.' }),
      keinPasskey(), k));
  }

  function zeigeEinrichten(code) {
    t = null;
    const k = knopf('Passkey einrichten', 'knopf-dunkel', () => gesperrt([k], () => einrichten(code)).catch(passkeyFehler), { disabled: !passkeyDa });
    ansicht(el('div', { klasse: 'ed-karte' },
      el('h2', { text: 'Passkey einrichten' }),
      el('p', { text: 'Mit einem Passkey melden Sie sich künftig ohne Passwort an: mit Fingerabdruck, Gesichtserkennung ' +
        'oder der PIN Ihres Geräts. Der Passkey bleibt auf Ihrem Gerät oder in Ihrem Passwort-Manager.' }),
      el('p', { klasse: 'ed-leise', text: 'Der Einladungslink gilt nur einmal. Danach melden Sie sich mit „Mit Passkey anmelden“ an.' }),
      keinPasskey(),
      el('div', { klasse: 'knoepfe' }, k, knopf('Ich habe schon einen Passkey', 'knopf-rand', () => { meldung(''); zeigeAbgemeldet(); }))));
  }

  // Fehler bei Einrichten und Anmelden: hier bedeuten 400/401 etwas anderes als "Sitzung abgelaufen".
  function passkeyFehler(e) {
    const art = e && e.art;
    if (art === 'abgebrochen') return meldung('Abgebrochen. Sie können es jederzeit erneut versuchen.', 'info');
    if (art === 'vorhanden') return meldung('Auf diesem Gerät ist bereits ein Passkey für den Editor eingerichtet. Bitte melden Sie sich damit an.', 'fehler');
    if (art === 'passkey') return meldung('Der Passkey konnte nicht verwendet werden. Bitte versuchen Sie es erneut.', 'fehler');
    if (art === 'anmeldung') return meldung('Die Anmeldung hat nicht geklappt. Bitte versuchen Sie es erneut.', 'fehler');
    if (art === 'fehler' && e.code === 'einladung') {
      zeigeAbgemeldet();
      return meldung('Dieser Einladungslink ist ungültig, abgelaufen oder wurde schon verwendet. Bitte fordern Sie bei Seitenschwung einen neuen an.', 'fehler');
    }
    if (art === 'fehler' && e.code === 'registrierung') return meldung('Der Passkey konnte nicht eingerichtet werden. Bitte versuchen Sie es erneut.', 'fehler');
    return fehler(e);
  }

  async function einrichten(code) {
    meldung('Passkey wird eingerichtet …');
    const s = await api.registrierenStart(code);
    const antwort = await P.registriere(s.optionen, nav);
    await api.registrierenEnde(code, antwort);
    await starte('Ihr Passkey ist eingerichtet. Sie sind angemeldet.');
  }

  async function anmelden() {
    meldung('Anmeldung läuft …');
    const s = await api.anmeldenStart();
    const antwort = await P.melde(s.optionen, nav);
    await api.anmeldenEnde(antwort);
    await starte('');
  }

  // Sitzung beim Server beenden (Ergebnis egal). Der Entwurf bleibt gespeichert.
  async function abmelden() {
    try { await api.abmelden(); } catch (e) { /* Abmelden gilt lokal trotzdem */ }
    zeigeAbgemeldet();
    meldung('Sie sind abgemeldet.', 'info');
  }

  // --- Ansicht: Testwahl ---------------------------------------------------------------------
  function kopfleiste() {
    return el('div', { klasse: 'ed-leiste' },
      el('p', { klasse: 'ed-leise', text: 'Angemeldet als ' + wer }),
      knopf('Abmelden', 'knopf-rand ed-klein', abmelden));
  }

  function zeigeTestwahl() {
    t = null;
    const liste = el('ul', { klasse: 'karten ed-wahl' });
    stand.tests.forEach((x) => {
      const e = x.eintrag || {};
      const marken = el('ul', { klasse: 'schlagworte' },
        e.kurz && el('li', { text: e.kurz }),
        x.sichtbar !== true && el('li', { text: 'Nicht veröffentlicht' }),
        leseEntwurf(x.id) && el('li', { text: 'Entwurf gespeichert' }));
      liste.append(el('li', { klasse: 'karte' }, el('div', { klasse: 'karte-inhalt' }, marken,
        el('h3', { text: x.titel }),
        e.beschreibung && el('p', { text: e.beschreibung }),
        el('div', { klasse: 'knoepfe' },
          knopf('Bearbeiten', 'knopf-dunkel', () => { meldung(''); oeffneTest(x.id); }, { 'aria-label': 'Bearbeiten: ' + x.titel }),
          knopf('Verlauf', 'knopf-rand', () => zeigeVerlauf(x.id).catch(fehler), { 'aria-label': 'Verlauf: ' + x.titel })))));
    });
    ansicht(kopfleiste(), el('h2', { text: 'Welchen Test möchten Sie bearbeiten?' }), liste);
  }

  // --- Test öffnen ------------------------------------------------------------------------
  const wert = (stand_, f) => {
    let w = stand_[f.datei];
    f.pfad.replace(/([^.[\]]+)|\[(\d+)\]/g, (_, n, i) => { w = w == null ? w : w[n !== undefined ? n : Number(i)]; return ''; });
    return w;
  };

  // Öffnet den Test mit dem Stand aus /stand; vorspann: Meldungen, die vor den Entwurfshinweisen stehen;
  // ohne: Label, das schon im Vorspann genannt ist (nicht noch einmal als verworfen melden).
  function oeffneTest(id, vorspann, ohne) {
    const x = stand.tests.find((y) => y.id === id);
    if (!x) return fehler({ art: 'unbekannt' });
    const orig = { test: x.daten, eintrag: x.eintrag };
    t = {
      id, titel: x.titel, ansicht: 'fragen', spec: '', frage: null, timer: null, server: new Map(),
      verwaist: Array.isArray(x.verwaist) ? x.verwaist : [],
      orig, jetzt: orig, felder: K.felder(x.daten, x.eintrag),
      // Struktur-Abdruck vom geladenen Stand: nur Texte sind änderbar, die Struktur bleibt wie sie ist.
      soll: { test: W.struktur(x.daten, W.TEXTFELDER_TEST), eintrag: W.struktur(x.eintrag, W.TEXTFELDER_EINTRAG) },
    };
    const r = K.entwurfAnwenden(t.jetzt, leseEntwurf(t.id), t.felder);
    t.jetzt = r.daten;
    const teile = (vorspann || []).slice();
    if (r.angewendet) {
      teile.push('Ihr gespeicherter Entwurf wurde wiederhergestellt (' + r.angewendet +
        (r.angewendet === 1 ? ' geändertes Feld).' : ' geänderte Felder).'));
    }
    const verworfen = r.verworfen.filter((l) => l !== ohne);
    if (verworfen.length) {
      teile.push('Diese Felder wurden inzwischen geändert; Ihr Entwurf wurde dort nicht übernommen: ' + verworfen.join(', ') + '.');
    }
    meldung(teile.join(' '), verworfen.length || (vorspann && vorspann.length) ? 'fehler' : 'info');
    zeigeBearbeiten();
  }

  // --- Ansicht: bearbeiten -----------------------------------------------------------------
  // Name des Tests und Titel: live nicht änderbar, nur als Info.
  function festInfo() {
    const fest = t.felder.filter((f) => f.fest);
    if (!fest.length) return null;
    const liste = el('dl', { klasse: 'ed-fest' });
    fest.forEach((f) => liste.append(el('dt', { text: f.label }), el('dd', { text: wert(t.jetzt, f) })));
    return el('div', { klasse: 'ed-info' }, liste,
      el('p', { klasse: 'ed-leise', text: 'Diese Angaben lassen sich hier nicht ändern. Bitte wenden Sie sich dafür an Seitenschwung.' }));
  }

  function zeigeBearbeiten() {
    const formular = el('div', { klasse: 'ed-formular', id: 'ed-formular' });
    const istStufen = t.jetzt.test.result.kind === 'levels';
    t.dom = { felder: new Map(), gruppen: new Map() };
    for (const [g, titel] of GRUPPEN) {
      const liste = t.felder.filter((f) => f.gruppe === g && !f.fest)
        .sort((a, b) => (a.datei === b.datei ? 0 : a.datei === 'eintrag' ? -1 : 1));
      if (!liste.length) continue;
      const zahl = el('span', { klasse: 'ed-zahl' });
      const gruppe = el('details', { klasse: 'ed-gruppe', open: g === 'start' },
        el('summary', {}, el('span', { klasse: 'ed-gruppe-titel', text: titel }), zahl));
      if (g === 'stufen') gruppe.append(el('p', { klasse: 'ed-leise', text: 'Die Grenzen der Stufen (z. B. „ab 50 %“) sind fest und lassen sich hier nicht ändern.' }));
      if (g === 'bereiche' && istStufen) gruppe.append(el('p', { klasse: 'ed-leise', text: 'Diese Texte erscheinen im Ergebnis bei den einzelnen Bereichen.' }));
      liste.forEach((f) => gruppe.append(feldElement(f)));
      gruppe.addEventListener('toggle', () => { if (gruppe.open) passeGruppeAn(gruppe); });
      t.dom.gruppen.set(g, { el: gruppe, zahl, anzahl: liste.length });
      formular.append(gruppe);
    }

    const suche = sucheBereich();
    const sendeKnopf = knopf('Speichern und veröffentlichen', 'knopf-dunkel', oeffneDialog);
    t.dom.senden = sendeKnopf;
    t.dom.offen = el('p', { klasse: 'ed-leise', 'aria-live': 'polite' });
    t.dom.hinweise = el('ul', { klasse: 'ed-hinweise' });
    const aktionen = el('div', { klasse: 'ed-aktionen' },
      t.dom.hinweise, t.dom.offen,
      el('div', { klasse: 'knoepfe' }, sendeKnopf,
        knopf('Verlauf', 'knopf-rand', () => zeigeVerlauf(t.id).catch(fehler)),
        knopf('Anderen Test wählen', 'knopf-rand', zurTestwahl)));

    const vorschau = vorschauBereich();
    const umschalter = el('div', { klasse: 'ed-umschalter ed-modus', role: 'group', 'aria-label': 'Bearbeiten oder Vorschau' });
    const flaeche = el('div', { klasse: 'ed-flaeche' }, el('div', { klasse: 'ed-spalte-form' }, suche, formular, aktionen), vorschau);
    [['Bearbeiten', false], ['Vorschau', true]].forEach(([text, zeigt]) => {
      umschalter.append(knopf(text, 'knopf-rand ed-klein', (ev) => {
        flaeche.classList.toggle('ed-zeigt-vorschau', zeigt);
        umschalter.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === ev.currentTarget)));
        if (zeigt) planeVorschau(0); else passeGruppeAn(formular);
      }, { 'aria-pressed': String(!zeigt) }));
    });

    ansicht(kopfleiste(),
      el('h2', { text: t.titel }),
      festInfo(),
      t.verwaist.length && el('p', { klasse: 'shop-hinweis', role: 'note', text: 'Einige früher gespeicherte Änderungen passen nicht mehr ' +
        'zum aktuellen Stand der Website und werden nicht angezeigt. Seitenschwung kümmert sich darum.' }),
      umschalter, flaeche, dialog());
    waehleAnsicht(t.ansicht);
    pruefe();
    passeGruppeAn(formular);
    planeVorschau(0);
  }

  // --- Suche im Formular ------------------------------------------------------------------------
  function sucheBereich() {
    const feld = el('input', { id: 'ed-suche', type: 'search', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'ed-suche-h' });
    const treffer = el('p', { klasse: 'ed-leise ed-treffer', id: 'ed-suche-h', 'aria-live': 'polite' });
    feld.addEventListener('input', () => filtere(feld.value));
    feld.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && feld.value) { ev.preventDefault(); leereSuche(); }
    });
    t.dom.suche = { feld, treffer, offen: null };
    return el('div', { klasse: 'ed-suche', role: 'search' }, el('label', { for: 'ed-suche', text: 'Text suchen' }), feld, treffer);
  }

  function leereSuche() {
    t.dom.suche.feld.value = '';
    filtere('');
  }

  // Blendet Felder ohne Treffer aus und öffnet Gruppen mit Treffern; leerer Suchtext stellt den vorigen Zustand her.
  function filtere(text) {
    const s = t.dom.suche;
    const aktiv = text.trim() !== '';
    if (aktiv && !s.offen) s.offen = new Map([...t.dom.gruppen].map(([g, info]) => [g, info.el.open]));
    const jeGruppe = new Map();
    let n = 0;
    for (const x of t.dom.felder.values()) {
      const ok = !aktiv || K.passt(x.f, x.eingabe.value, text);
      x.box.hidden = !ok;
      if (ok) { n++; jeGruppe.set(x.f.gruppe, (jeGruppe.get(x.f.gruppe) || 0) + 1); }
    }
    for (const [g, info] of t.dom.gruppen) {
      info.el.hidden = aktiv && !jeGruppe.get(g);
      if (aktiv && jeGruppe.get(g)) info.el.open = true;
      if (!aktiv && s.offen) info.el.open = s.offen.get(g);
    }
    if (!aktiv) s.offen = null;
    const neu = !aktiv ? '' : n === 0 ? 'Keine Treffer' : n + ' Treffer';
    // Live-Region nur bei geändertem Inhalt neu setzen
    if (s.treffer.textContent !== neu) s.treffer.textContent = neu;
    passeGruppeAn(d.getElementById('ed-formular') || d);
  }

  // Zeilen nach Länge (K.zeilen); ist das Feld sichtbar und der Text trotzdem länger, wächst es bis 12 Zeilen.
  function passeHoeheAn(ta) {
    let z = K.zeilen(ta.value);
    if (ta.rows !== z) ta.rows = z;
    while (z < 12 && ta.clientHeight && ta.scrollHeight > ta.clientHeight + 1) ta.rows = ++z;
  }
  const passeGruppeAn = (wurzel) => wurzel.querySelectorAll('.ed-feld textarea').forEach(passeHoeheAn);

  function feldElement(f) {
    const n = ++zaehler;
    const id = 'ed-f-' + n;
    const hilfeText = [f.hinweis, f.betont ? 'Ein Wort zwischen Sternchen wird hervorgehoben, z. B. *Wort*.' : ''].filter(Boolean).join(' ');
    const hilfe = hilfeText && el('p', { klasse: 'ed-hilfe', id: id + '-h', text: hilfeText });
    const fehlerEl = el('p', { klasse: 'ed-fehler', id: id + '-m', hidden: true });
    // Immer mehrzeilig, damit lange Texte ganz sichtbar sind. Zeilenumbrüche erscheinen auf der Website nicht,
    // daher fügt Enter keinen ein und eingefügte Umbrüche werden zu Leerzeichen.
    const eingabe = el('textarea', { id });
    eingabe.value = wert(t.jetzt, f);
    eingabe.rows = K.zeilen(eingabe.value);
    eingabe.addEventListener('keydown', (ev) => {
      // Während einer IME-Eingabe (z. B. Wortvorschläge) bestätigt Enter nur die Auswahl: nicht abfangen.
      if (ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229) ev.preventDefault();
    });
    const marke = el('span', { klasse: 'ed-marke', text: 'geändert', hidden: true });
    const zurueck = knopf('Zurücksetzen', 'knopf-rand ed-klein', () => {
      setzeWert(f, wert(t.orig, f));
      eingabe.value = wert(t.orig, f);
      passeHoeheAn(eingabe);
      eingabe.focus();
    }, { hidden: true, 'aria-label': 'Zurücksetzen: ' + f.label });
    eingabe.addEventListener('input', () => {
      if (/[\r\n\u2028\u2029]/.test(eingabe.value)) {
        const pos = eingabe.selectionStart;
        eingabe.value = eingabe.value.replace(/\r\n?|\n|\u2028|\u2029/g, ' ');
        eingabe.setSelectionRange(pos, pos);
      }
      passeHoeheAn(eingabe);
      setzeWert(f, eingabe.value);
    });
    eingabe.addEventListener('focus', () => folgeFokus(f));
    const box = el('div', { klasse: 'ed-feld' },
      el('div', { klasse: 'ed-feld-kopf' }, el('label', { for: id, text: f.label }), marke, zurueck),
      eingabe, hilfe, fehlerEl);
    t.dom.felder.set(schluessel(f), { f, box, eingabe, marke, zurueck, fehlerEl, hilfeId: hilfe ? id + '-h' : '' });
    return box;
  }

  function setzeWert(f, w) {
    t.jetzt = Object.assign({}, t.jetzt, { [f.datei]: K.setze(t.jetzt[f.datei], f.pfad, w) });
    t.server.delete(schluessel(f)); // Meldung des Servers gilt nur bis zur nächsten Änderung des Feldes
    speichereEntwurf();
    pruefe();
    planeVorschau();
  }

  // Meldungen von Textregeln, Struktur und (nach einem abgelehnten Speichern) vom Server, je Feld zugeordnet.
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
      W.pruefeStruktur(daten, soll, felder).forEach((m) => {
        const [pfad, ...rest] = m.split(': ');
        const platzhalter = m.includes('{names}');
        const text = platzhalter && /fehlt$/.test(m) ? 'Der Platzhalter {names} muss stehen bleiben.'
          : platzhalter && m.includes('mehrfach') ? 'Der Platzhalter {names} darf nur einmal vorkommen.'
            : 'Diese Änderung ist hier nicht möglich (' + rest.join(': ') + ').';
        dazu(datei, pfad, text);
      });
    };
    struktur('test', t.jetzt.test, t.soll.test, W.TEXTFELDER_TEST);
    struktur('eintrag', t.jetzt.eintrag, t.soll.eintrag, W.TEXTFELDER_EINTRAG);
    for (const [k, liste] of t.server) {
      const [datei, pfad] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)];
      liste.forEach((text) => {
        const schon = (je.get(k) || []).includes(text);
        if (!schon) dazu(datei, pfad, text);
      });
    }
    return { je, allgemein };
  }

  // Meldungen aus einer 422-Antwort ({pfad, meldung}, ohne Datei) den Feldern zuordnen.
  function serverMeldungen(liste) {
    t.server = new Map();
    for (const m of liste) {
      const k = t.dom.felder.has('test|' + m.pfad) ? 'test|' + m.pfad : t.dom.felder.has('eintrag|' + m.pfad) ? 'eintrag|' + m.pfad : '|' + m.pfad;
      (t.server.get(k) || t.server.set(k, []).get(k)).push(m.meldung);
    }
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
          onclick: () => { if (x.box.hidden) leereSuche(); x.box.closest('details').open = true; x.eingabe.focus(); } })));
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
    t.dom.senden.textContent = offen > 0 ? 'Noch ' + offen + (offen === 1 ? ' Hinweis offen' : ' Hinweise offen') : 'Speichern und veröffentlichen';
    // Live-Region nur bei geändertem Inhalt neu setzen (sonst Ansage bei jedem Tastendruck)
    const offenText = offen > 0 ? 'Noch ' + offen + (offen === 1 ? ' Hinweis' : ' Hinweise') + ' offen. Bitte beheben Sie zuerst die markierten Stellen.'
      : anzahl === 0 ? 'Noch keine Änderungen.' : anzahl + (anzahl === 1 ? ' Änderung' : ' Änderungen') + ' bereit zum Veröffentlichen.';
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
      // Alle Antworten gleich: kein Bereich liegt vorne, das Ergebnis zeigt den Text bei Gleichstand (result.tie).
      auswahl.append(el('option', { value: '3', text: 'Gleichstand (kein Bereich vorne)' }));
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
      if (f.pfad === 'result.tie' && r.kind !== 'levels') spec = '3';
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
    const doc = V.dokument(html, t.jetzt.eintrag, t.jetzt.test, stand.testsCfg, t.ansicht, t.spec);
    const frage = t.ansicht === 'fragen' && t.frage !== null ? t.frage : undefined;
    V.zeige(v.iframe, doc, { frage, halten: t.ansicht !== 'fragen' && v.zuletzt === t.ansicht + t.spec });
    v.zuletzt = t.ansicht + t.spec;
    v.status.textContent = t.ansicht === 'kachel' ? 'So erscheint der Test in der Übersicht der Selbsttests.'
      : t.ansicht === 'ergebnis' ? 'Beispiel-Ergebnis mit erfundenen Antworten.'
        : frage !== undefined ? 'Die Vorschau zeigt Frage ' + (frage + 1) + '.' : 'Startseite des Tests.';
  }

  // --- Speichern und veröffentlichen ------------------------------------------------------------
  function dialog() {
    const liste = el('ul', { klasse: 'ed-liste' });
    const fehlerP = el('p', { klasse: 'ed-fehler', role: 'alert' });
    const dlg = el('dialog', { klasse: 'ed-dialog', 'aria-labelledby': 'ed-dialog-titel' });
    const ja = knopf('Speichern und veröffentlichen', 'knopf-dunkel', () => gesperrt([ja, nein], () => speichere(dlg)).catch((e) => { dlg.close(); fehler(e); }));
    const nein = knopf('Abbrechen', 'knopf-rand', () => dlg.close());
    dlg.append(
      el('h2', { id: 'ed-dialog-titel', text: 'Speichern und veröffentlichen' }),
      el('p', { text: 'Diese Änderungen sind nach dem Speichern sofort auf der Website sichtbar:' }),
      liste, fehlerP, el('div', { klasse: 'knoepfe' }, ja, nein));
    t.dom.dialog = { dlg, liste, fehlerP };
    dlg.addEventListener('close', () => { if (t && t.dom.senden.isConnected) t.dom.senden.focus(); });
    return dlg;
  }

  const altNeu = (a, vorher, nachher) => el('li', {}, el('strong', { text: a.label }), el('br'),
    el('span', { klasse: 'ed-alt', text: vorher }), ' → ', el('span', { text: nachher }));

  function oeffneDialog() {
    const x = t.dom.dialog;
    x.liste.replaceChildren(...K.aenderungen(t.orig, t.jetzt, t.felder).map((a) => altNeu(a, a.alt, a.neu)));
    x.fehlerP.textContent = '';
    x.dlg.showModal();
  }

  // Meldung nach Speichern oder Rückgängig: "Ist live." nur, wenn der Server die Seite neu erzeugt hat.
  function erfolg(id, live, vorne) {
    meldung((vorne ? vorne + ' ' : '') + (live ? 'Ist live.' : 'Gespeichert, wird gerade veröffentlicht – bitte Seite in einer Minute prüfen.'),
      'info', seitenLink(id));
  }

  async function speichere(dlg) {
    const liste = K.aenderungen(t.orig, t.jetzt, t.felder);
    if (!liste.length) return dlg.close();
    const id = t.id;
    let r;
    try {
      r = await api.speichern(id, liste.map((a) => ({ datei: a.datei, pfad: a.pfad, alt: a.alt, neu: a.neu })));
    } catch (e) {
      dlg.close();
      if (e.art === 'konflikt') {
        // Neu laden; der Entwurf bleibt und wird auf den neuen Stand angewendet (wo möglich).
        const label = labelFuer(e.pfad);
        const eigen = liste.find((a) => a.pfad === e.pfad);
        await ladeStand();
        return oeffneTest(id, ['Nicht gespeichert: Das Feld „' + label + '“ wurde inzwischen von anderer Seite geändert. Der aktuelle Stand wurde geladen.' +
          (eigen ? ' Ihr Text dafür war: „' + eigen.neu + '“.' : '') + (liste.length > 1 ? ' Ihre übrigen Änderungen sind noch da.' : '')], label);
      }
      if (e.art === 'ungueltig') {
        serverMeldungen(e.meldungen);
        pruefe();
        return meldung('Nicht gespeichert: Bitte beheben Sie zuerst die markierten Stellen.', 'fehler');
      }
      throw e;
    }
    loescheEntwurf(id);
    dlg.close();
    await ladeStand();
    oeffneTest(id);
    erfolg(id, r.live === true, 'Gespeichert.');
  }

  // --- Ansicht: Verlauf -------------------------------------------------------------------
  const zeitText = (z) => {
    const dt = new Date(z);
    return isNaN(dt) ? String(z || '') : dt.toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' });
  };

  async function zeigeVerlauf(id) {
    const x = stand.tests.find((y) => y.id === id);
    if (!x) return fehler({ art: 'unbekannt' });
    meldung('Verlauf wird geladen …');
    const v = await api.verlauf(id);
    meldung('');
    const felder = K.felder(x.daten, x.eintrag);
    const label = (a) => { const f = felder.find((y) => y.datei === a.datei && y.pfad === a.pfad); return f ? f.label : a.pfad; };
    const eintraege = Array.isArray(v.verlauf) ? v.verlauf : [];
    const dlg = el('dialog', { klasse: 'ed-dialog', 'aria-labelledby': 'ed-rg-titel' });
    const liste = el('ol', { klasse: 'ed-verlauf' });
    eintraege.forEach((z) => {
      const aend = Array.isArray(z.aenderungen) ? z.aenderungen : [];
      const k = knopf('Rückgängig', 'knopf-rand ed-klein', () => fragRueckgaengig(dlg, id, z, aend, label, k),
        { 'aria-label': 'Rückgängig: Änderung vom ' + zeitText(z.zeit) });
      liste.append(el('li', { klasse: 'ed-verlauf-eintrag' },
        el('p', {}, el('strong', { text: zeitText(z.zeit) }), ' · ' + (z.wer || 'unbekannt')),
        el('ul', {}, ...aend.map((a) => el('li', { text: label(a) }))),
        k));
    });
    ansicht(kopfleiste(),
      el('h2', { text: 'Verlauf: ' + x.titel }),
      eintraege.length ? el('p', { klasse: 'ed-leise', text: 'Die letzten gespeicherten Änderungen, neueste zuerst.' })
        : el('p', { text: 'Für diesen Test wurde noch nichts gespeichert.' }),
      liste,
      el('div', { klasse: 'knoepfe' },
        knopf('Bearbeiten', 'knopf-dunkel', () => { meldung(''); oeffneTest(id); }),
        knopf('Anderen Test wählen', 'knopf-rand', zurTestwahl)),
      dlg);
  }

  function fragRueckgaengig(dlg, id, z, aend, label, ausloeser) {
    const fehlerP = el('p', { klasse: 'ed-fehler', role: 'alert' });
    const ja = knopf('Rückgängig machen', 'knopf-dunkel', () => gesperrt([ja, nein], () => rueckgaengig(dlg, id, z.nr)).catch((e) => { dlg.close(); fehler(e); }));
    const nein = knopf('Abbrechen', 'knopf-rand', () => dlg.close());
    dlg.replaceChildren(
      el('h2', { id: 'ed-rg-titel', text: 'Änderung rückgängig machen' }),
      el('p', { text: 'Diese Felder bekommen wieder ihren vorherigen Text; das ist sofort auf der Website sichtbar:' }),
      el('ul', { klasse: 'ed-liste' }, ...aend.map((a) => altNeu({ label: label(a) }, a.neu, a.alt))),
      fehlerP, el('div', { klasse: 'knoepfe' }, ja, nein));
    dlg.onclose = () => { if (ausloeser.isConnected) ausloeser.focus(); };
    dlg.showModal();
  }

  async function rueckgaengig(dlg, id, nr) {
    let r;
    try {
      r = await api.rueckgaengig(nr);
    } catch (e) {
      dlg.close();
      if (e.art === 'konflikt') {
        const x = stand.tests.find((y) => y.id === id);
        const f = x && K.felder(x.daten, x.eintrag).find((y) => y.pfad === e.pfad);
        return meldung('Rückgängig ist nicht möglich: Das Feld „' + (f ? f.label : e.pfad) + '“ wurde danach noch einmal geändert.', 'fehler');
      }
      if (e.art === 'ungueltig') return meldung('Rückgängig ist nicht möglich, weil der frühere Text heute nicht mehr gültig wäre.', 'fehler');
      throw e;
    }
    dlg.close();
    await ladeStand();
    oeffneTest(id);
    erfolg(id, r.live === true, 'Rückgängig gemacht.');
  }

  // --- Start --------------------------------------------------------------------------------
  async function ladeStand() {
    const s = await api.stand();
    if (!s || !Array.isArray(s.tests)) throw Object.assign(new Error('Stand'), { art: 'fehler' });
    stand = s;
    wer = typeof s.wer === 'string' ? s.wer : '';
  }
  // Zurück zur Testwahl mit frischem Stand (Titel, Kurzinfos); scheitert das Laden, bleibt der bisherige.
  function zurTestwahl() {
    meldung('');
    ladeStand()
      .catch((e) => { if (e && e.art === 'anmeldung') throw e; })
      .then(() => { if (stand) zeigeTestwahl(); })
      .catch(fehler);
  }

  async function starte(text) {
    await ladeStand();
    meldung(text || '', 'info');
    zeigeTestwahl();
  }

  // Einladung: Fragment sofort entfernen (Code nur in einer Variablen). Sonst: besteht schon eine Sitzung?
  const frag = new URLSearchParams(location.hash.slice(1));
  const einladung = frag.get('einladung');
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  if (einladung) {
    zeigeEinrichten(einladung);
  } else {
    zeigeAbgemeldet();
    starte('').catch((e) => {
      zeigeAbgemeldet();
      if (e && e.art !== 'anmeldung') fehler(e);
    });
  }
})();
