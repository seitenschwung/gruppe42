# Test-Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingrid Nirnberger ändert die Texte der Selbsttests in einem geführten Editor unter `/editor/`; jede Änderung wird ein Pull Request, der erst nach Code-Owner-Freigabe und grüner CI live geht.

**Architecture:** Zwei gemeinsame UMD-Module unter `site/lib/` (Wächter-Regeln, Testseiten-Markup) laufen im Build (Node) und im Editor (Browser) identisch. Der Build bricht bei Struktur- oder Textverstößen ab. Der Node-Server bekommt nur einen OAuth-Code-Tausch (`/api/editor/*`) und eine CSP für `/editor/`; alles andere spricht der Browser direkt mit `api.github.com`.

**Tech Stack:** Node 20 (Stdlib, keine npm-Pakete), `node:test`, Vanilla-JS (ES5-Stil wie `antreiber.js`), GitHub REST API, GitHub App (User-to-Server-Token).

**Spec:** `docs/superpowers/specs/2026-11-21-test-editor-design.md`

## Global Constraints

- Keine npm-Abhängigkeiten, keine Fremdbibliotheken im Browser.
- Image muss **ohne Env** starten; neue Routen antworten dann `503` (Pipeline-Test).
- Bearbeitbar nur diese Felder (alles andere fest):
  Test-JSON: `name`, `status`, `scale.1`…`scale.5`, `categories[].name`, `categories[].headline`, `categories[].lowContext`,
  `categories[].sections[].title`, `categories[].sections[].text`, `questions[].text`, `result.kicker`, `result.title`, `result.intro`,
  `result.outro`, `result.note`, `result.highlight`, `result.lead`, `result.tie`, `result.lowLabel`, `result.cta.text`,
  `result.levels[].title`, `result.levels[].text`.
  `gruppe42.json` → `tests.eintraege[]`: `titel`, `motto`, `intro`, `kurz`, `beschreibung`.
- `*Wort*` nur in `result.title` und `tests.eintraege[].motto`; sonst kein `*`, kein `[…](…)`; nirgends `<`.
- Platzhalter `{names}` muss in jedem Feld erhalten bleiben, das ihn heute enthält (`result.lead` in antreiber und fuehrungsstil).
- JSON-Dateien schreiben als `JSON.stringify(obj, null, 2) + '\n'` (die heutigen Dateien sind damit byte-identisch).
- Token nie in `localStorage`, nie in Server-Logs; Fragment `#token=` sofort per `history.replaceState` entfernen.
- Editor-UI-Texte deutsch, Ansprache „Sie“.
- `/editor/`: `noindex`, nicht in Menü/Sitemap, `Disallow: /editor/` in `robots.txt`.
- Jeder neue `*.test.js` wird in seinem Task an den `node --test`-Aufruf der Dockerfile-Stufe `test` angehängt (nur so läuft er in CI).
- Commits enden mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Eine Frage wird gelöscht oder umsortiert (Editor-Bug, Handbearbeitung) → Build bricht mit Pfadangabe ab statt still falsch auszuwerten. (Task 1, `fragen_reihenfolge`)
2. Ingrid öffnet den Editor, während ihr PR noch offen ist → weiter auf demselben Branch, kein zweiter PR. (Task 7, `offener_pr_wird_weiterverwendet`)
3. Token läuft nach 8 h ab, während ungesendete Änderungen da sind → Entwurf bleibt, Hinweis „Bitte erneut anmelden“, nach Login wiederhergestellt. (Task 7, `abgelaufen_401`; Task 8, manueller Check 5)
4. Ein Konto ohne Schreibrecht meldet sich an → Meldung „Kein Zugriff“, kein Senden-Knopf. (Task 7, `ohne_schreibrecht`)
5. `{names}` wird beim Umformulieren entfernt → sofortiger Hinweis, Senden gesperrt; Build lehnt ab. (Task 1, `platzhalter_fehlt`, `platzhalter_im_abdruck`)

---

### Task 1: Wächter-Modul (Struktur + Text-Regeln)

**Files:**
- Create: `site/lib/testwaechter.js`
- Test: `site/lib/testwaechter.test.js`

**Interfaces:**
- Produces (UMD: `module.exports` in Node, `window.Testwaechter` im Browser):
  - `TEXTFELDER_TEST: string[]`, `TEXTFELDER_EINTRAG: string[]` – Pfadmuster aus den Global Constraints (`categories[].sections[].text`, `scale.*`; Einträge relativ zu einem Eintrag: `titel` …).
  - `BETONT_ERLAUBT: string[]` = `['result.title', 'motto']`.
  - `GRENZEN = { kurz: 120, mittel: 400, lang: 1500 }`. kurz: `name`, `status`, `scale.*`, `categories[].name`, `sections[].title`, `kicker`, `highlight`, `lowLabel`, `cta.text`, `levels[].title`, `titel`, `motto`, `kurz`. mittel: `questions[].text`, `headline`, `intro`, `beschreibung`, `lead`, `tie`. Rest lang.
  - `struktur(daten, textfelder) -> object` – tiefe Kopie; jeder String an einem Textfeld-Pfad wird `"<text>"`, oder `"<text>{names}"`, wenn er `{names}` enthält.
  - `pruefeStruktur(daten, erwartet, textfelder) -> string[]` – deutsche Meldungen mit konkretem Pfad, z. B. `questions[10].reverse: geändert`, `questions: Anzahl 19 statt 20`, `result.foo: unbekanntes Feld`; `[]` = ok. Platzhalter-Marker im Abdruck → Feld muss `{names}` enthalten, sonst `result.lead: Platzhalter {names} fehlt`.
  - `pruefeTexte(daten, textfelder) -> {pfad, meldung}[]` – String, nicht leer nach `trim`, Längengrenze, kein `<`, `*` nur in `BETONT_ERLAUBT`, kein `](`.

- [ ] **Step 1: Failing tests** (`node:test`, liest die echten Dateien aus `site/kunden/gruppe42/tests/`; `orig` = Original, `d` = `structuredClone(orig)`, `S = struktur(orig, TEXTFELDER_TEST)`):

```js
test('reine_textaenderung_ok', () => { d.questions[0].text = 'Neu'; assert.deepStrictEqual(pruefeStruktur(d, S, TEXTFELDER_TEST), []); });
test('reverse_geaendert', () => { d.questions[10].reverse = !d.questions[10].reverse; assert.match(pruefeStruktur(d, S, TEXTFELDER_TEST).join(), /questions\[10\]\.reverse/); });
// level_min_geaendert   teamklima result.levels[1].min 50 -> 40     => Meldung mit 'result.levels[1].min'
// kategorie_zuordnung   questions[0].category = andere id          => Meldung mit 'questions[0].category'
// fragen_reihenfolge    zwei Fragen tauschen; eine Frage löschen    => je mindestens eine Meldung
// neues_feld            result.foo = 'x'                            => Meldung mit 'result.foo'
// cta_href_fest         antreiber result.cta.href = 'https://x'     => Meldung; nur cta.text geändert => []
// platzhalter_im_abdruck  struktur(antreiber).result.lead === '<text>{names}'
// platzhalter_fehlt     antreiber result.lead ohne '{names}'        => pruefeStruktur meldet 'result.lead'
// leer                  questions[0].text = '  '                    => pruefeTexte enthält pfad 'questions[0].text'
// html_verboten         questions[0].text = '<b>x</b>'              => Meldung
// betont_nur_titel      result.title '*x* y' => []; questions[0].text '*x*' => Meldung
// zu_lang               questions[0].text = 'a'.repeat(401)         => Meldung
// alle_echten_ok        alle 4 Dateien: pruefeTexte(...) => [] und pruefeStruktur(orig, S) => []
// eintraege             TEXTFELDER_EINTRAG: 'id'/'daten'/'sichtbar' geändert => Meldung; 'motto' geändert => []
```

- [ ] **Step 2:** `node --test site/lib/testwaechter.test.js` → FAIL (`Cannot find module`).
- [ ] **Step 3: Implementieren.** Konkreten Pfad zum Muster normalisieren (`[n]` → `[]`, Schlüssel unter `scale` → `*`). Vergleich rekursiv mit Pfadausgabe; bei Arrays zuerst Länge, dann elementweise.
- [ ] **Step 4:** → PASS. Testdatei an Dockerfile-Stufe `test` anhängen (dazu `COPY site/ site/` in Stufe `test`; Task 2 braucht dort auch `build.js`).
- [ ] **Step 5: Commit** `feat: Wächter für Struktur und Texte der Selbsttests`

---

### Task 2: Wächter im Build + Strukturabdruck

**Files:**
- Create: `site/lib/struktur-erzeugen.js` (CLI), `site/kunden/gruppe42/tests/struktur.json` (erzeugt, eingecheckt)
- Modify: `site/vorlagen/beratung/build.js` (`ladeTest` 430-440; Validierung direkt nach Zeile 94, also vor jeder Bildverarbeitung)
- Test: `site/lib/struktur.test.js`

**Interfaces:**
- Consumes: Task 1.
- Produces: `struktur.json` = `{ "version": 1, "tests": { "<daten.id>": <struktur(daten, TEXTFELDER_TEST)> }, "eintraege": <tests.eintraege.map(e => struktur(e, TEXTFELDER_EINTRAG))> }`.
  CLI: `node site/lib/struktur-erzeugen.js site/kunden/gruppe42/gruppe42.json` schreibt `tests/struktur.json` neben die Test-JSONs.
  build.js: neue Funktion `pruefeTests()` läuft direkt nach Zeile 94, lädt jede Test-JSON (über `ladeTest`) einmal und bricht beim ersten Verstoß ab (vorher alle Meldungen per `console.error`). `ladeTest` ruft die Wächter auf.

- [ ] **Step 1: Failing tests:** `abdruck_aktuell` – im Speicher erzeugter Abdruck `deepStrictEqual` eingecheckte `struktur.json`. `build_bricht_ab` – Kopie von `site/kunden/gruppe42` in `os.tmpdir()`, dort `teamklima.json` `questions[0].reverse = true`; `spawnSync('node', ['site/vorlagen/beratung/build.js', <kopie>/gruppe42.json], { env: { ...process.env, DIST_DIR, CACHE_DIR } })` → `status === 1`, `stderr` enthält `questions[0].reverse`. `build_ohne_abdruck` – `struktur.json` in der Kopie gelöscht → `status === 1`, `stderr` enthält `struktur.json`.
- [ ] **Step 2:** `node --test site/lib/struktur.test.js` → FAIL.
- [ ] **Step 3: CLI schreiben, Abdruck erzeugen, Build erweitern.**
- [ ] **Step 4:** `node --test site/lib/*.test.js server/*.test.js` → PASS; `cd site && node vorlagen/beratung/build.js kunden/gruppe42/gruppe42.json` → `✔ Gruppe 42 gebaut`; Testdatei in Dockerfile; `docker build --target test .` → erfolgreich.
- [ ] **Step 5: CLAUDE.md**, Zeile „Tests (Selbsttests)“ ergänzen: Wächter, `struktur.json`, bei bewusster Strukturänderung neu erzeugen mit dem CLI. **Commit** `feat: Build prüft Struktur und Texte der Selbsttests`

---

### Task 3: Gemeinsames Testseiten-Markup

**Files:**
- Create: `site/lib/testseite.js`, Test `site/lib/testseite.test.js`, Snapshots `site/lib/__snapshots__/*.html`
- Modify: `site/vorlagen/beratung/build.js` (`betont` 140, `testSeite` 442-503, Kachel in `testUebersicht` 535-541)

**Interfaces:**
- Produces (UMD, `window.Testseite`):
  - `esc(s)`, `betont(s)` – identisch zu heute.
  - `kopf(eintrag) -> string` = heutiges `seitenkopf(e.titel, e.motto, e.intro, null, true)`.
  - `abschnitte(eintrag, daten, testsCfg) -> string` – `<section id="test">`, `<section id="ergebnis">` und `<script type="application/json" id="antreiber-daten">`; `kontaktband()` bleibt in build.js dazwischen an der heutigen Stelle.
  - `kachel(eintrag, href) -> string` – das `<li class="karte">` eines Tests aus `testUebersicht`.

- [ ] **Step 1:** Vor dem Umbau die gebauten `antreiber-test.html`, `teamklima-check.html`, `fuehrungsstil-check.html`, `employer-branding-check.html`, `selbsttests.html` nach `site/lib/__snapshots__/` kopieren. Tests: `ausgabe_unveraendert` (Build in Temp-Dir, byte-genauer Vergleich – die Zeile mit `?v=`-Hash von `antreiber.js` vor dem Vergleich normalisieren, weil Task 4 die Datei ändert); `kopf_maskiert` (`kopf({titel:'<x>', motto:'*a*'})` enthält `&lt;x&gt;` und `<em>a</em>`).
- [ ] **Step 2:** → `ausgabe_unveraendert` PASS, `kopf_maskiert` FAIL.
- [ ] **Step 3: Markup verschieben**, build.js nutzt das Modul.
- [ ] **Step 4:** → beide PASS; Testdatei in Dockerfile.
- [ ] **Step 5: Commit** `refactor: Testseiten-Markup als gemeinsames Modul`

---

### Task 4: Gezielte Ergebnisvorschau in der Engine

**Files:**
- Modify: `site/vorlagen/beratung/src/js/antreiber.js` (`auswerten` 110ff., Vorschau-Block 335-345)
- Test: `site/vorlagen/beratung/src/js/antreiber.test.js`

**Interfaces:**
- Produces:
  - `auswertenWerte(DATA, antworten) -> { prozent: number, sortiert: string[] /* category ids */, gleichauf: boolean, stufe: number /* Index in nach min sortierten levels, -1 bei ranking */ }` – die Rechnung aus `auswerten()`; `auswerten()` nutzt sie.
  - `vorschauAntworten(DATA, spec) -> number[]`. `spec`: `''` zufällig; `'1'`…`'5'` alle gleich (heutiges Verhalten); `'bereich:<category-id>'` diese Kategorie klar vorne (`gleichauf === false`); `'stufe:<i>'` Ergebnis in Stufe `i`.
  - Node-Export am Dateiende: `if (typeof module === 'object' && module.exports) module.exports = { auswertenWerte, vorschauAntworten };` – der DOM-Teil läuft nur, wenn `typeof document !== 'undefined'`.
  - Browser: Spec zuerst aus `wurzel.getAttribute('data-vorschau')`, sonst `?vorschau`.

- [ ] **Step 1: Failing tests** (die vier echten Test-JSONs): `bereich_vorne` – jede Kategorie jedes `ranking`-Tests: `sortiert[0] === id && !gleichauf`. `stufe_treffen` – jeder `levels`-Test, jeder Index `i`: `stufe === i`. `wert_fest` – `'3'` → nur 3er.
- [ ] **Step 2:** `node --test site/vorlagen/beratung/src/js/antreiber.test.js` → FAIL.
- [ ] **Step 3: Implementieren.** `bereich:` – Zielkategorie gewertet 5, Rest gewertet 2 (Rohwert über `reverse` zurückrechnen). `stufe:` – kleinster gleichmäßiger gewerteter Wert 1…5, dessen Prozent in `[min_i, min_{i+1})` liegt; wenn keiner passt, ab gewertet 1 Frage für Frage um 1 erhöhen, bis Prozent ≥ `min_i`.
- [ ] **Step 4:** → PASS; Task-3-Snapshot bleibt grün; Testdatei in Dockerfile.
- [ ] **Step 5: Manuell:** `python3 -m http.server 8080 -d site/vorlagen/beratung/dist` → `/antreiber-test.html?vorschau=3` und `?vorschau` zeigen ein Ergebnis wie bisher.
- [ ] **Step 6: Commit** `feat: Testvorschau für bestimmten Bereich oder Stufe`

---

### Task 5: Server – Header pro Pfad, Log ohne Query für `/api/editor`

**Files:**
- Modify: `server/server.js` (`SECURITY_HEADERS` 18-23, Log 39-45, `send`/statische Auslieferung)
- Test: `server/server.test.js`

**Interfaces:**
- Produces: `headersFor(pathname) -> object` (exportiert neben `createServer`). Für `/editor` und `/editor/…` zusätzlich
  `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.github.com; frame-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
  `X-Frame-Options: DENY`, `Cache-Control: no-store`. Sonst die heutigen Header. (`'unsafe-inline'` nur für Styles: gebaute Seiten haben einen `<style>`-Block.)

- [ ] **Step 1: Failing tests:** `editor_csp` (Temp-Root mit `editor/index.html`: CSP wie oben, `x-frame-options: DENY`); `andere_seiten_ohne_csp` (`/`: keine CSP, `SAMEORIGIN`); `log_ohne_query` (`/api/editor/callback?code=geheim&state=x` → Logzeile enthält den Pfad, nicht `geheim`; `/shop.html?a=1` loggt die Query weiter).
- [ ] **Step 2:** `node --test server/server.test.js` → FAIL.
- [ ] **Step 3: Implementieren.**
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: CSP für /editor, kein Query im Log für /api/editor`

---

### Task 6: Login-Endpunkt (`server/editor-auth.js`)

**Files:**
- Create: `server/editor-auth.js`, Test `server/editor-auth.test.js`
- Modify: `server/server.js` (Routen im `require.main`-Block neben `checkout`), `Dockerfile` (COPY in Stufe 3 + Testliste), `.env.example`

**Interfaces:**
- Produces: `createEditorAuth({ env, fetch, now = Date.now, random = crypto.randomBytes }) -> { routes }`:
  - `GET /api/editor/login` – ohne `EDITOR_GITHUB_CLIENT_ID` oder `EDITOR_GITHUB_CLIENT_SECRET`: `503 {"error":"editor_disabled"}`. Sonst `302` nach `https://github.com/login/oauth/authorize?client_id=<id>&state=<nonce>` mit `Set-Cookie: g42_state=<nonce>.<hmac>; Path=/api/editor; Max-Age=600; HttpOnly; Secure; SameSite=Lax`. `nonce` = 16 Zufallsbytes hex, `hmac` = HMAC-SHA256(Schlüssel `sha256('g42-state:' + secret)`, nonce) hex. Ohne `redirect_uri`: GitHub nutzt die in der App hinterlegte Callback-URL (kein Vertrauen in den `Host`-Header).
  - `GET /api/editor/callback?code&state` – Cookie fehlt, Signatur falsch oder `state !== nonce` (Vergleich mit `crypto.timingSafeEqual`) → `302 /editor/#fehler=state`, kein `fetch`. Sonst `POST https://github.com/login/oauth/access_token` (`Accept: application/json`, JSON `{client_id, client_secret, code}`); kein `access_token` → `302 /editor/#fehler=login`; Erfolg → `302 /editor/#token=<encodeURIComponent(access_token)>&ablauf=<expires_in>`. Cookie in beiden Fällen löschen (`Max-Age=0`). Header immer `Cache-Control: no-store`, `Referrer-Policy: no-referrer`.
  - Rate-Limit 20 Anfragen/IP/Minute über beide Routen → `429` (Muster aus `checkout.js`).
- `.env.example`: `EDITOR_GITHUB_CLIENT_ID=`, `EDITOR_GITHUB_CLIENT_SECRET=` mit Kommentar (GitHub App „Gruppe 42 Editor“, Callback `https://gruppe42.seitenschwung.com/api/editor/callback`).

- [ ] **Step 1: Failing tests** (Mock-`fetch`, feste `random`/`now`): `ohne_env_503`, `login_redirect_und_cookie`, `callback_falscher_state` (fehlendes Cookie / falsche Signatur / anderer State → `#fehler=state`, `fetch` nie aufgerufen), `callback_ok` (Body enthält `client_secret` und `code`; Location `/editor/#token=…&ablauf=28800`; Cookie gelöscht), `github_fehler` (`{error:'bad_verification_code'}` → `#fehler=login`), `rate_limit` (21. Anfrage → 429).
- [ ] **Step 2:** `node --test server/editor-auth.test.js` → FAIL.
- [ ] **Step 3: Implementieren, im Server einhängen, Dockerfile ergänzen.**
- [ ] **Step 4:** → PASS. `docker build --build-arg APP_VERSION=dev -t gruppe42 . && docker run --rm --read-only --tmpfs /tmp -p 8080:8080 gruppe42`, dann `curl -i localhost:8080/api/editor/login` → `503`.
- [ ] **Step 5: Commit** `feat: GitHub-Login für den Test-Editor (Code-Tausch)`

---

### Task 7: Editor-Logik ohne DOM

**Files:**
- Create: `site/vorlagen/beratung/src/js/editor-kern.js`, `site/vorlagen/beratung/src/js/editor-github.js`
- Test: `…/src/js/editor-kern.test.js`, `…/src/js/editor-github.test.js`

**Interfaces:**
- Consumes: Task 1 (`Testwaechter`).
- `editor-kern.js` (UMD, `window.EditorKern`):
  - `felder(daten, eintrag) -> Feld[]`; `Feld = { datei: 'test'|'eintrag', pfad, gruppe: 'start'|'skala'|'fragen'|'ergebnis'|'bereiche'|'stufen', label, hinweis?, wert, mehrzeilig, betont }`. Labels sprechend, z. B. `Frage 3 (Bereich „Sei perfekt!“)`, `Stufe ab 50 %: Überschrift`, `Bereich „Vertrauen“, Abschnitt 1: Text`. Hinweis bei `result.lead` mit `{names}`: `{names} wird durch die stärksten Bereiche ersetzt und muss stehen bleiben.`
  - `setze(obj, pfad, wert) -> object` (neue Kopie, Original unverändert).
  - `aenderungen(vorher, nachher, felder) -> {label, alt, neu}[]`.
  - `prText(testTitel, aenderungen, notiz) -> {titel, text}`: Titel `Inhalt: <Testtitel> (<n> Änderungen)`; Text = Notiz, Leerzeile, Liste `- <label>: „<alt>“ → „<neu>“`, Schluss `Erstellt mit dem Test-Editor.`
- `editor-github.js` (UMD, `window.EditorGithub`), `ctx = { token, fetch, repo: 'seitenschwung/gruppe42', basis: 'main' }`:
  - `zugriff(ctx) -> Promise<{login, darfSchreiben}>` (`GET /user`, `GET /repos/{repo}` → `permissions.push`).
  - `ladeDatei(ctx, pfad, ref) -> Promise<{text, sha}>` (Contents-API; Base64 → UTF-8 über `TextDecoder`).
  - `offenerPr(ctx, testId) -> Promise<{nummer, branch, url} | null>` (offene PRs, Head-Branch beginnt mit `inhalt/<testId>-`).
  - `sende(ctx, {testId, dateien: {pfad, text}[], titel, text, pr?}) -> Promise<{nummer, url, branch}>`: ohne `pr` Branch `inhalt/<testId>-<YYYY-MM-DD-HHmm>` von `ctx.basis` anlegen, sonst `pr.branch`; **ein** Commit über Blobs → Tree (`base_tree`) → Commit → Ref-Update; Commit-Nachricht = `titel`; ohne `pr` danach `POST /pulls` (base `ctx.basis`, body `text`).
  - `status(ctx, nummer) -> Promise<{zustand: 'offen'|'gemergt'|'geschlossen', mergeSha: string|null}>`.
  - Header immer `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`. `401` → Fehler mit `art: 'abgelaufen'`; `409`/`422` beim Ref-Update → `art: 'konflikt'`.

- [ ] **Step 1: Failing tests.** Kern: `felder_vollstaendig` (für jeden echten Test: Menge der Pfade = genau die Textfelder laut Wächter, die in der Datei vorkommen), `cta_href_fehlt`, `setze_struktur_bleibt` (`pruefeStruktur` nach `setze` = `[]`), `pr_text`. GitHub (Mock-`fetch` zeichnet Aufrufe auf): `ohne_schreibrecht`, `umlaute_dekodieren` („Führungsstil“ in Base64), `offener_pr_wird_weiterverwendet` (mit `pr`: kein `POST /git/refs`, kein `POST /pulls`), `neuer_pr` (Reihenfolge: ref lesen → blobs → tree → commit → ref anlegen → pulls), `abgelaufen_401`, `konflikt_422`.
- [ ] **Step 2:** `node --test site/vorlagen/beratung/src/js/editor-*.test.js` → FAIL.
- [ ] **Step 3: Implementieren.**
- [ ] **Step 4:** → PASS; beide Testdateien in Dockerfile.
- [ ] **Step 5: Commit** `feat: Editor-Logik und GitHub-Zugriff (ohne Oberfläche)`

---

### Task 8: Editor-Seite, Oberfläche und Vorschau

**Files:**
- Create: `site/vorlagen/beratung/src/js/editor.js`; CSS in `site/vorlagen/beratung/src/css/style.css` (Klassen mit Präfix `ed-`)
- Modify: `site/vorlagen/beratung/build.js` (Seite `editor/index.html`, Skripte kopieren, `robots.txt`)
- Test: `site/lib/testseite.test.js` (Build-Teil)

**Interfaces:**
- Consumes: Tasks 1, 3, 4, 6, 7.
- Build: Seite `{ datei: 'editor/index.html', noindex: true }` (nicht in `hauptnav()`; Sitemap filtert `noindex` schon); Ordner `dist/editor/` anlegen. Skripte nach `dist/js/` (`testwaechter.js`, `testseite.js`, `editor-kern.js`, `editor-github.js`, `editor.js`, je mit `?v=`-Hash wie `testJsUrl`), nur auf der Editor-Seite eingebunden. `robots.txt` (nicht-Demo) bekommt `Disallow: /editor/`. Ohne JS: Hinweis „Für den Editor wird JavaScript benötigt.“
- `editor.js`: Zustände `abgemeldet` → `testwahl` → `bearbeiten` → `gesendet`. Beim Laden `#token`/`#ablauf`/`#fehler` lesen, dann `history.replaceState(null, '', location.pathname)`. `#fehler=state|login` → verständliche Meldung + „Erneut anmelden“. Testliste und Daten von `main` über `EditorGithub.ladeDatei` (`gruppe42.json`, Test-JSONs, `struktur.json`). Entwurf in `localStorage` als `g42-editor-entwurf-<testId>` (nur Daten, kein Token, in `try/catch`); bei `art: 'abgelaufen'` Entwurf behalten und „Bitte erneut anmelden“ zeigen.
- Formular: Gruppen in dieser Reihenfolge mit diesen Überschriften: „Startseite des Tests“, „Antwortskala“, „Fragen“, „Ergebnis: allgemein“, „Ergebnis je Bereich“ (ranking) bzw. „Ergebnis-Stufen“ (levels, Grenze nur als Text „ab 50 %“). Geänderte Felder markiert, „Zurücksetzen“ pro Feld. Prüfung bei jeder Eingabe mit `pruefeTexte` + `pruefeStruktur` (gegen `struktur.json`); Meldung unter dem Feld (`aria-describedby`); Senden-Knopf `disabled` mit „Noch <n> Hinweise offen“.
- Vorschau: `fetch('/' + eintrag.id + '.html')`, `DOMParser`; `.seitenkopf` ← `Testseite.kopf(e)`; `#test`, `#ergebnis`, `#antreiber-daten` ← `Testseite.abschnitte(e, daten, testsCfg)`; `<base href="/">` in `<head>`; für die Ergebnisansicht `data-vorschau` am `[data-test]`; Ergebnis als `iframe.srcdoc`. Neu rendern 400 ms nach der letzten Eingabe. Steuerung unter der Vorschau: „Fragen“ / „Ergebnis“ / „Kachel“ (`Testseite.kachel(e, '#')` mit dem Seiten-CSS, für `beschreibung`/`kurz`) und je nach `result.kind` Auswahl des Bereichs bzw. der Stufe. Unter 900 px: Umschalter „Bearbeiten“ / „Vorschau“.
- Senden: Dialog mit optionaler Notiz → `EditorGithub.sende` (mit `offenerPr`, falls vorhanden) → Link zum PR. Status beim Laden und per Knopf „Status aktualisieren“ (kein Intervall): `offen` → „Wartet auf Freigabe“, `gemergt` → „Freigegeben, geht live“, `/version.txt` beginnt mit `mergeSha` → „Live“.

- [ ] **Step 1: Failing test** `editor_seite`: Build in Temp-Dir erzeugt `editor/index.html` mit `<meta name="robots" content="noindex, nofollow">`; `robots.txt` enthält `Disallow: /editor/`; `sitemap.xml` enthält kein `editor`; `index.html` enthält keinen Link auf `editor/`.
- [ ] **Step 2:** → FAIL; Build-Teil implementieren → PASS.
- [ ] **Step 3: `editor.js` + CSS implementieren.**
- [ ] **Step 4: Manuelle Prüfung** (`STATIC_ROOT=site/vorlagen/beratung/dist node server/server.js`; Token = selbst erzeugtes Fine-grained-Token nur für ein Test-Fork-Repo, per `#token=…` übergeben; in der Konsole `ctx.repo` auf den Fork setzen):
  1. Testwahl zeigt alle 4 Tests (auch versteckte).
  2. Fragetext ändern → Vorschau zeigt ihn; jeder Bereichs- bzw. Stufentext lässt sich in der Vorschau anzeigen.
  3. `{names}` aus „Einleitung des Ergebnisses“ löschen → Hinweis, Senden gesperrt.
  4. Senden → genau ein PR mit lesbarer Beschreibung; Diff nur die geänderten Zeilen; erneut ändern + senden → derselbe PR, neuer Commit.
  5. Adresszeile ohne Token; Reload → abgemeldet, Entwurf bleibt, nach Login wieder da.
  6. 375 px Breite: Umschalter funktioniert, keine horizontale Scrollleiste.
  7. Nur Tastatur: alles erreichbar, Fokus sichtbar; Browser-Konsole ohne CSP-Fehler.
- [ ] **Step 5:** Alle Tests + `docker build` grün.
- [ ] **Step 6: Commit** `feat: Test-Editor unter /editor/`

---

### Task 9: Freigabe-Regeln, Owner-Checkliste, Anleitung

**Files:**
- Create: `.github/CODEOWNERS`, `docs/anleitung-test-editor.md`, Bilder in `docs/anleitung-test-editor/`
- Modify: `CLAUDE.md` (Abschnitt Test-Editor), ggf. `.github/preview.json`

- [ ] **Step 1: `.github/CODEOWNERS`:**
```
/site/kunden/gruppe42/tests/ @Nirnberger
/site/kunden/gruppe42/gruppe42.json @Nirnberger
/.github/ @Nirnberger
```
- [ ] **Step 2: Preview prüfen:** In einem PR, der nur `site/kunden/gruppe42/tests/teamklima.json` ändert, muss der Preview-Kommentar `teamklima-check.html` mit der Variante `ergebnis` zeigen. Fehlt sie: `.github/preview.json` so ergänzen, dass Test-JSONs ihre Testseite auslösen (Format des Template-Workflows `seitenschwung/template` nachlesen).
- [ ] **Step 3: Owner-Checkliste in `CLAUDE.md`** (Reihenfolge einhalten):
  1. Settings → Environments → `production` → Deployment branches: nur `main`; ebenso `preview`, falls dort Secrets liegen.
  2. Settings → Rules → Ruleset für `main`: Pull Request nötig (0 Approvals, „Require review from Code Owners“), Status-Check Pipeline-Job nötig, Force-Push blockiert, Löschen verboten, Bypass nur Owner. Danach prüfen, dass `dev automerge` für Dependabot weiter durchläuft.
  3. GitHub App „Gruppe 42 Editor“ in der Org `seitenschwung`: Callback `https://gruppe42.seitenschwung.com/api/editor/callback`, „Expire user authorization tokens“ an, Webhook aus, Rechte Contents RW, Pull requests RW, Metadata R; nur auf `gruppe42` installieren. Client-ID/Secret in Coolify als `EDITOR_GITHUB_CLIENT_ID`/`EDITOR_GITHUB_CLIENT_SECRET`.
  4. Erst danach: Ingrids GitHub-Konto (2FA aktiv) als Collaborator „Write“.
- [ ] **Step 4: `docs/anleitung-test-editor.md`** – eine Seite für Ingrid in „Sie“-Form: Anmelden → Test wählen → Text ändern → Vorschau → „Zur Freigabe senden“ → Status. Was nicht geht (Fragen hinzufügen, Auswertung ändern) und dass sie dafür Seitenschwung schreibt. Screenshots aus Task 8.
- [ ] **Step 5: Commit** `docs: Freigabe-Regeln und Anleitung für den Test-Editor`
