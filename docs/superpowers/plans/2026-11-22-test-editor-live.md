# Test-Editor live Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Testtexte werden im Editor gespeichert und sind sofort live (ohne Freigabe, ohne Pipeline); Login per Passkey, ohne GitHub-Konto.

**Architecture:** Overlay-Texte auf dem Volume `/data/editor/`, Server prüft mit dem Wächter und rendert Testseiten/Hub mit `site/lib/testseite.js` zur Laufzeit neu (Marker im gebauten HTML). WebAuthn ohne Abhängigkeiten. Der GitHub-Weg aus PR #24 wird entfernt.

**Tech Stack:** Node 20 Stdlib (`node:crypto`, `node:http`, `node:fs`), `node:test`, Vanilla-JS im Browser.

**Spec:** `docs/superpowers/specs/2026-11-22-test-editor-live-design.md` (bindend). Branch `feat/test-editor-live` auf Basis von `docs/test-editor-design`.

## Global Constraints

- Keine npm-Pakete; Browser-Code UMD/IIFE, `'use strict'`, keine neuen Globals außer den bestehenden (`Testwaechter`, `Testseite`, `EditorKern`) und ggf. `EditorApi`/`EditorPasskey`; CSP-sicher (keine Inline-Skripte/-Handler).
- Image startet ohne Env und ohne Volume: öffentliche Seiten = Image-Stand, alle `/api/editor/*` → `503`. `/healthz`, `/version.txt` unverändert.
- Live änderbar nur die Textfelder des Wächters **außer** Test-`name` und Eintrag-`titel`.
- Alle Datei-Schreibvorgänge unter dem Datenverzeichnis atomar (Temp + `rename`), Verzeichnis bei Bedarf anlegen; Pfad per Env `EDITOR_DATA_DIR` (Standard `/data/editor`), Basisinhalte per `EDITOR_INHALT_DIR` (Standard `/app/inhalte`).
- Env: `EDITOR_ORIGIN` (z. B. `https://gruppe42.seitenschwung.com`), `EDITOR_RP_ID` (z. B. `gruppe42.seitenschwung.com`), optional `EDITOR_MELDUNG_URL`. Fehlt `EDITOR_ORIGIN` oder `EDITOR_RP_ID` → Editor-API `503`.
- Alle Editor-Routen: Header `X-G42-Editor: 1` Pflicht; POST zusätzlich `Origin === EDITOR_ORIGIN`; sonst `403 {"error":"herkunft"}`. Antworten `Cache-Control: no-store`, `Referrer-Policy: no-referrer`. Rate-Limit pro IP (Muster `checkout.js`).
- Sitzungs-Cookie exakt: `g42_sitzung=<base64url 32 Bytes>; Path=/api/editor; HttpOnly; Secure; SameSite=Strict`; Leerlauf 2 h, absolut 12 h.
- Nie loggen: Sitzungs-IDs, Einladungscodes, Passkey-Daten, Texte.
- UI-Texte deutsch, „Sie“. JSON-Dateien als `JSON.stringify(x, null, 2) + '\n'`.
- Jede neue `*.test.js` in die Dockerfile-Stufe `test`; neue Server-Dateien in die `COPY`-Zeile der Stufe 3.
- Commits enden mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; nichts pushen.

## Review Focus

1. Zwei Sitzungen speichern dasselbe Feld kurz nacheinander → die zweite bekommt `409` mit Pfad, nichts geht verloren. (L1/L5)
2. Overlay enthält Pfad, den es nach einem Deploy nicht mehr gibt → Seite rendert ohne ihn, Editor zeigt „verwaist“. (L1/L2)
3. `/data` nicht schreibbar oder fehlt (Pipeline) → öffentliche Seiten laufen, Editor `503`, kein Absturz. (L1/L2/L4)
4. Wiederverwendete oder fremde Challenge, falsche Origin, fehlendes UV-Flag, sinkender signCount → Anmeldung abgelehnt. (L3/L4)
5. Text mit `<script>` o. ä. kommt nie auf die Seite (Wächter serverseitig + Escaping beim Rendern). (L1/L2/L5)

---

### Task 1: Live-Inhalte (`server/inhalte.js`)

**Files:** Create `server/inhalte.js`, `server/inhalte.test.js`; Modify `Dockerfile` (Stufe 3: `site/kunden/gruppe42/gruppe42.json` und `site/kunden/gruppe42/tests/` nach `/app/inhalte/`; `site/lib/testwaechter.js` an einen Ort, den der Server per `require` findet; Stufe `test`: neue Testdatei).

**Produces:** `createInhalte({ basisDir, dataDir, jetzt = () => new Date() }) -> { verfuegbar(): boolean, liste(): [{id, titel, sichtbar}], wirksam(testId) -> {daten, eintrag, eintragIndex, verwaist: string[]}, testsCfg(), speichere(testId, aenderungen, wer) -> {nr, zeit}, verlauf(testId, max=50) -> [...], rueckgaengig(nr, wer) -> {nr, zeit, testId}, export() -> {overlay, sha256}, leeren(sha256) -> boolean }`. `aenderungen = [{datei: 'test'|'eintrag', pfad, alt, neu}]`. Fehler als `Error` mit `art`: `'konflikt'` (+`pfad`), `'ungueltig'` (+`meldungen: [{pfad, meldung}]`), `'unbekannt'`, `'nicht_verfuegbar'`. `testId` = `eintrag.id` (Seiten-ID, z. B. `antreiber-test`).

- [ ] Failing Tests (Temp-Dirs, Basis = Kopie von `site/lib/__fixtures__`): ohne Overlay = Basis; speichern → Overlay-Datei + Verlaufzeile; falsches `alt` → konflikt; `name`/`titel`/`reverse`/unbekannter Pfad → ungueltig; Wächterverstoß (`<b>`, Steuerzeichen, `{names}` entfernt) → ungueltig mit Pfad; verwaister Overlay-Pfad ignoriert und gemeldet; rueckgaengig stellt alt wieder her, konflikt wenn das Feld inzwischen anders ist; Datenverzeichnis nicht schreibbar → `verfuegbar() === false`, speichere wirft `nicht_verfuegbar`; keine `.tmp`-Reste; leeren mit falschem sha256 → false.
- [ ] Implementieren (Wächter per `require` des gemeinsamen Moduls, `struktur.json` aus `basisDir/tests/`).
- [ ] Commit `feat: Live-Inhalte als Overlay mit Verlauf und Wächter`.

### Task 2: Testseiten live ausliefern

**Files:** Modify `site/vorlagen/beratung/build.js` (Marker), ggf. `site/lib/testseite.js`, Snapshots neu (`G42_SNAPSHOTS_SCHREIBEN=1`); Create `server/seiten.js`, `server/seiten.test.js`; Modify `server/server.js`, `Dockerfile` (`site/lib/testseite.js` ins Image).

**Consumes:** Task 1. **Produces:** Marker exakt `<!--g42:kopf-->…<!--/g42:kopf-->`, `<!--g42:test-->…<!--/g42:test-->` (#test und #ergebnis), `<!--g42:daten-->…<!--/g42:daten-->`, `<!--g42:kacheln-->…<!--/g42:kacheln-->` (Testkacheln auf `selbsttests.html`). `createSeiten({ root, inhalte, Testseite }) -> { aktualisiere(testId?), seite(pathname) -> {html, etag} | null }`. `createServer` bekommt optional `seiten` und liefert für bekannte Pfade dessen HTML (gleiche Security-Header, Content-Type, ETag/304, Cache-Control wie bisher für HTML).

- [ ] Failing Tests: Fixture-Build enthält alle Marker je Testseite/Hub; nach `speichere` ersetzt `seiten` den Text (Frage, Ergebnis, Kachel) und escaped `<`; fehlender Marker → Originalseite; Server liefert gerenderte Fassung mit neuem ETag; ohne Overlay byte-gleich zur gebauten Datei.
- [ ] Implementieren; Snapshots neu (nur Marker-Kommentare dürfen sich ändern — Diff im Report zeigen).
- [ ] Commit `feat: Testseiten und Übersicht werden mit Live-Texten ausgeliefert`.

### Task 3: Passkey-Prüfung (`server/passkey.js`)

**Files:** Create `server/passkey.js`, `server/passkey.test.js` (Testhilfe für simulierten Authenticator als eigene Datei `server/passkey-testhilfe.js`, nur von Tests genutzt, nicht ins Image).

**Produces:** `cbor(buf)`; `registrierungOptionen({rpId, rpName, userId, userName, challenge})`, `anmeldungOptionen({rpId, challenge})`; `pruefeRegistrierung({antwort, challenge, origin, rpId}) -> {id, jwk, alg, signCount}`; `pruefeAnmeldung({antwort, challenge, origin, rpId, passkey}) -> {signCount}`. `antwort` = JSON-Form aus dem Browser (base64url). Fehler als `Error` mit `art: 'passkey'`.

- [ ] Failing Tests mit simuliertem Authenticator (EC P-256 und RSA): gültige Registrierung ES256/RS256; gültige Anmeldung; falsche challenge/type/origin/rpIdHash, UP oder UV fehlt, manipulierte Signatur, sinkender signCount (≠0), unbekannter alg, kaputtes CBOR → abgelehnt.
- [ ] Implementieren (ES256 DER-Signatur, `crypto.verify` mit JWK).
- [ ] Commit `feat: Passkey-Prüfung (WebAuthn) ohne Abhängigkeiten`.

### Task 4: Einladung, Anmeldung, Sitzung

**Files:** Create `server/editor-sitzung.js`, `server/editor-sitzung.test.js`, `server/editor-einladung.js` (CLI); Modify `server/server.js`, `Dockerfile`, `.env.example`.

**Consumes:** Task 3. **Produces:** `createSitzung({ env, dataDir, jetzt, random }) -> { routes, pruefe(req) -> {wer} | null }` mit den Routen aus Spec §4; CLI `node server/editor-einladung.js "<Name>"`, `--liste`, `--entfernen <passkey-id>`.

- [ ] Failing Tests über `createServer` mit simuliertem Authenticator: ohne Env → 503; Header/Origin fehlen → 403; gültige Einladung → Registrierung, Cookie exakt, Einladung verbraucht; abgelaufene/unbekannte Einladung → 400 ohne Details; Anmeldung → Cookie; Challenge doppelt → abgelehnt; Leerlauf/absolut abgelaufen → `pruefe` null; abmelden löscht; Rate-Limit; Logzeilen ohne Code/Cookie.
- [ ] Implementieren; CLI schreibt atomar; Einladungscode nur als SHA-256 gespeichert.
- [ ] Commit `feat: Einladung, Passkey-Anmeldung und Sitzung für den Editor`.

### Task 5: Editor-API

**Files:** Create `server/editor-api.js`, `server/editor-api.test.js`, `server/editor-export.js` (CLI); Modify `server/server.js`, `Dockerfile`.

**Consumes:** Tasks 1, 2, 4. **Produces:** Routen aus Spec §5; nach Speichern/Rückgängig `seiten.aktualisiere(testId)` und Meldung an `EDITOR_MELDUNG_URL` (`POST` JSON `{titel: 'Test-Editor: <Testtitel>', text: '<wer> hat <n> Text(e) geändert'}`, 5 s Timeout, Fehler ignoriert, keine Texte im Body); CLI `editor-export.js` (Overlay + sha256), `--leeren <sha256>`.

- [ ] Failing Tests: ohne Sitzung → 401; `stand` liefert wirksame Daten; speichern 200/409/422; danach liefert `GET /<test>.html` den neuen Text; rueckgaengig; Meldung mit erwartetem Body, ihr Fehler bricht nichts; verlauf max 50.
- [ ] Implementieren.
- [ ] Commit `feat: Editor-API zum Speichern, Verlauf und Rückgängig`.

### Task 6: Editor-Oberfläche umstellen

**Files:** Modify `site/vorlagen/beratung/src/js/editor.js`, `editor-vorschau.js`, `editor-kern.js` (+Test); Create `src/js/editor-api.js` (+Test), `src/js/editor-passkey.js` (+Test); Modify `build.js` (Skriptliste), `src/css/style.css`.

**Consumes:** Tasks 4, 5. **Produces:** Oberfläche laut Spec §6.

- [ ] Failing Tests: `editor-api.js` (Header, Fehler-Mapping 401/403/409/422/503/netz), `editor-passkey.js` (base64url ↔ ArrayBuffer, Optionen/Antwort-Umwandlung), `editor-kern.js` (`name`/`titel` nicht editierbar).
- [ ] Implementieren; GitHub-Aufrufe aus der Oberfläche entfernen.
- [ ] Browser-Check: echter Server mit Temp-`EDITOR_DATA_DIR`, `EDITOR_ORIGIN=http://localhost:8080`, `EDITOR_RP_ID=localhost`; Passkey per Stub von `navigator.credentials` (nur im git-ignorierten dist, Testschlüssel aus `server/passkey-testhilfe.js`) — prüfen: einrichten, anmelden, ändern, Vorschau, speichern → öffentliche Testseite zeigt neuen Text, Verlauf, Rückgängig, abmelden, 375 px, keine CSP-Fehler. Nichts Stub-bezogenes committen.
- [ ] Commit `feat: Editor speichert live und meldet sich per Passkey an`.

### Task 7: GitHub-Weg entfernen, Repo-Abgleich, Doku

**Files:** Delete `server/editor-auth.js` (+Test), `src/js/editor-github.js` (+Test); Modify `server/server.js`, `Dockerfile`, `.env.example`, `CLAUDE.md`, `docs/anleitung-test-editor.md` (+Screenshots), `docs/superpowers/specs/2026-11-21-test-editor-design.md` (Verweis), Umbau-B-Entwurf als „ersetzt“ markieren; Create `site/lib/einpflegen.js` (+Test).

- [ ] `einpflegen.js <overlay.json>`: Overlay auf `site/kunden/gruppe42/**` anwenden (nur erlaubte Felder), Wächter prüft, JSON-Format wie gehabt; Test auf Fixture-Kopie.
- [ ] Alte Routen/Env/Tests entfernen; CSP `connect-src 'self'`; Header-Tests anpassen.
- [ ] `CLAUDE.md` Test-Editor neu: Ablauf, Env, Volume/Backup, Einladung per `docker exec`, Export/Einpflegen, Restrisiken; GitHub-App-Checkliste entfernen (Ruleset/CODEOWNERS/Environment für Code-Änderungen bleiben).
- [ ] Anleitung für Ingrid neu: Passkey einrichten, anmelden, ändern, Vorschau, „Speichern und veröffentlichen“, Verlauf/Rückgängig; Screenshots aus Task 6.
- [ ] Commit `feat: GitHub-Weg entfernt, Repo-Abgleich und Doku für den Live-Editor`.
