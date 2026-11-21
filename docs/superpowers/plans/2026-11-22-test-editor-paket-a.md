# Test-Editor Paket A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Befunde der zweiten Prüfung beheben, bevor Ingrid den Editor nutzt: CI-Blocker, Token-Übergabe ohne URL, Prüfung fremder PRs, Bedienbarkeit, Doku.

**Architecture:** Baut auf dem bestehenden Editor auf (`docs/superpowers/plans/2026-11-21-test-editor.md`). Keine neuen Abhängigkeiten. Umbau B (Ingrid ohne Schreibrechte) ist **nicht** Teil dieses Pakets.

**Spec:** `docs/superpowers/specs/2026-11-21-test-editor-design.md` (bindend) + Abschnitt „Entscheidungen Paket A“ unten.

## Global Constraints

- Alle Constraints aus dem ersten Plan gelten weiter (keine npm-Pakete; Image startet ohne Env; nur Textfelder editierbar; JSON als `JSON.stringify(obj, null, 2) + '\n'`; UI deutsch, „Sie“; CSP-sicher; jede neue Testdatei in die Dockerfile-Stufe `test`).
- Token erscheint **nie** in einer URL (auch nicht im Fragment), nie in `localStorage`/`sessionStorage`, nie in Logs.
- Commits enden mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; nichts pushen.

## Entscheidungen Paket A

- Token-Übergabe: Callback setzt Cookie `g42_token=<token>.<ablauf>`; `Path=/api/editor/token; Max-Age=60; HttpOnly; Secure; SameSite=Strict` und leitet auf `/editor/#angemeldet` weiter. Die Seite holt das Token einmal per `POST /api/editor/token` (Header `X-G42-Editor: 1` Pflicht, `Origin` muss fehlen oder gleich dem eigenen Origin sein), Antwort `{token, ablauf}` mit `no-store`, Cookie wird dabei gelöscht. Ohne Cookie → `401 {"error":"kein_token"}`. Damit ist auch Login-CSRF über `#token=` erledigt: ein Token aus der URL wird nicht mehr angenommen.
- Abmelden: `POST /api/editor/abmelden` mit JSON `{token}` (gleiche Header-Pflicht) → Server ruft `DELETE https://api.github.com/applications/<client_id>/token` mit Basic-Auth `client_id:client_secret` und Body `{access_token}`; Antwort `204` auch wenn GitHub fehlschlägt, ohne Env `503`.
- `fetch` wird im Editor einmal beim Laden festgehalten (`window.fetch.bind(window)`), nicht pro Aufruf.
- Offener PR wird nur weiterverwendet, wenn `GET /pulls/{n}/files` ausschließlich die Test-JSON des Tests und `site/kunden/gruppe42/gruppe42.json` enthält; sonst Meldung „Es gibt einen offenen Vorschlag mit weiteren Änderungen. Seitenschwung kümmert sich darum.“ und kein Senden.
- Neue PRs bekommen das Label `manual-review` (`POST /repos/{repo}/issues/{n}/labels`); schlägt das fehl, gilt das Senden trotzdem als erfolgreich.
- Wächter zusätzlich: `status` darf nicht mit `.` enden; in allen Textfeldern verboten: U+202A–U+202E, U+2066–U+2069, U+200B–U+200F, U+FEFF.
- Editor-Felder: immer `<textarea>`, Zeilenzahl nach Länge (min 2); Suchfeld „Text suchen“ filtert nach Label und Wert und öffnet passende Gruppen; Hinweis „Erscheint: …“ bei mehrdeutigen Feldern; „Teaser:“ → „Kachel und Seitenkopf:“; `motto` heißt „Überschrift der Testseite“.
- Ranking-Tests: Ergebnis-Auswahl bekommt „Gleichstand“ (`data-vorschau="3"`), damit `result.tie` sichtbar wird.
- Server: Editor-Pfad-Erkennung ohne Groß-/Kleinschreibung (`/EDITOR/`).
- Snapshot-Test prüft eine feste Beispielkopie unter `site/lib/__fixtures__/`, nicht die echten Inhalte; ein einziger Build pro Testlauf.

## Review Focus

1. Ingrid ändert eine Frage → `docker build --target test` bleibt grün. (A1)
2. `POST /api/editor/token` aus einer fremden Seite → abgelehnt (Header/Origin). (A2)
3. Zweiter `POST /api/editor/token` nach dem ersten → `401`. (A2)
4. Offener `inhalt/…`-PR, der auch `build.js` ändert → kein Weiterarbeiten, verständliche Meldung. (A3)
5. Suche „Perfektion“ findet Frage und Bereichstext und öffnet beide Gruppen. (A4)

---

### Task 1: Snapshot-Test auf Beispieldaten

**Files:** Create `site/lib/__fixtures__/` (Kopie von `site/kunden/gruppe42/` ohne `static/`, gekürzte Texte erlaubt), Modify `site/lib/testseite.test.js`, Snapshots neu erzeugen, `Dockerfile` (Stufe `test` nur so viel wie nötig).

- [ ] Test gegen die Beispielkopie bauen (ein Build; Bildverarbeitung im Test vermeiden, ohne `build.js` aufzuweichen); Snapshots aus aktuellem Code neu erzeugen.
- [ ] Nachweis: temporäre Textänderung in `site/kunden/gruppe42/tests/teamklima.json` → alle Tests grün; temporäre Markup-Änderung in `testseite.js` → `ausgabe_unveraendert` rot. Beides rückgängig.
- [ ] Wenn möglich `apk add libwebp-tools` aus Stufe `test` entfernen; Laufzeit vorher/nachher berichten.
- [ ] Commit `test: Snapshot gegen Beispieldaten statt echter Inhalte`.

### Task 2: Token-Übergabe ohne URL, Abmelden widerruft, Pfad ohne Groß/Klein

**Files:** Modify `server/editor-auth.js`, `server/editor-auth.test.js`, `server/server.js` (`isEditorPath`), `server/server.test.js`.

**Produces:** `POST /api/editor/token` → `200 {token, ablauf}` | `401 {"error":"kein_token"}` | `403 {"error":"herkunft"}` | `503`; `POST /api/editor/abmelden` → `204` | `403` | `503`; Callback-Erfolg → `302 /editor/#angemeldet` + Token-Cookie; Fehler wie bisher `#fehler=state|login`.

- [ ] Failing Tests: Callback setzt Token-Cookie, Location ohne Token; `/token` mit Cookie + Header → Token, Cookie gelöscht; zweiter Aufruf → 401; ohne Header oder fremder `Origin` → 403; `/abmelden` ruft GitHub-DELETE mit Basic-Auth, 204 auch bei GitHub-Fehler; Rate-Limit für alle vier Routen; `/EDITOR/` bekommt Editor-Header.
- [ ] Implementieren; Log enthält weder Query noch Token.
- [ ] Commit `feat: Token-Übergabe per Cookie und POST, Abmelden widerruft Token`.

### Task 3: Editor – Token holen, fetch fixieren, fremde PRs, Label

**Files:** Modify `site/vorlagen/beratung/src/js/editor.js`, `editor-github.js`, `editor-github.test.js`.

**Consumes:** Task 2. **Produces:** `EditorGithub.prDateien(ctx, nummer) -> Promise<string[]>`; `EditorGithub.setzeLabel(ctx, nummer, label) -> Promise<void>`; `sende` ruft nach `POST /pulls` `setzeLabel(…, 'manual-review')` und ignoriert dessen Fehler.

- [ ] Failing Tests: `prDateien` (per_page=100); `sende` setzt Label, Label-Fehler bricht nicht ab.
- [ ] editor.js: bei `#angemeldet` → `POST /api/editor/token` mit Header, Fragment sofort entfernen; `#token=` ignorieren; „Abmelden“ ruft `/api/editor/abmelden`; `fetch` einmal festhalten; offenen PR nur nach `prDateien`-Prüfung weiterverwenden, sonst Meldung.
- [ ] Browser-Check gegen Seiten-Stub (vor den Editor-Skripten eingehängt, nur im git-ignorierten dist; nichts davon committen): Login mit Cookie, Abmelden, fremder PR.
- [ ] Commit `feat: Editor holt Token per POST, prüft offene PRs, setzt Label`.

### Task 4: Bedienbarkeit und Wächter-Regeln

**Files:** Modify `site/lib/testwaechter.js` (+Test), `site/vorlagen/beratung/src/js/editor-kern.js` (+Test), `editor.js`, `editor-vorschau.js`, `src/css/style.css` (`ed-`).

- [ ] Wächter: `status` ohne Schlusspunkt, Bidi/Nullbreite verboten (Tests; echte Dateien bleiben gültig).
- [ ] Labels/Hinweise laut Entscheidungen (Test in editor-kern).
- [ ] Immer `<textarea>`; Suchfeld; Gleichstand-Option für Ranking-Tests.
- [ ] Browser-Check (Stub): Suche, Textareas, Gleichstand zeigt `tie`-Text, 375 px.
- [ ] Commit `feat: Editor mit Suche, mehrzeiligen Feldern, klareren Beschriftungen`.

### Task 5: Doku

**Files:** Modify `docs/anleitung-test-editor.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-11-21-test-editor-design.md`.

- [ ] Anleitung: „Einmalig einrichten“ (Konto, Passkey, Einladung per E-Mail annehmen, englischer Dialog „Authorize“, englische Mails: „merged“ = freigegeben); Suche, neue Beschriftungen, Abmelden.
- [ ] CLAUDE.md-Checkliste ergänzen: Actions-Token nur lesend; „Allow GitHub Actions to create and approve pull requests“ aus; Secrets prüfen; Pflicht-Check namentlich (Job `pipeline` aus `ci.yml` bzw. dessen Check-Namen); `@Nirnberger` = Owner-Konto von Seitenschwung, nie das der Kundin; bei Editor-PRs immer den ganzen Diff prüfen; Template: Deploy per Digest, GHCR-Paketzugriff nur Actions. Token-Übergabe kurz beschreiben.
- [ ] Spec: Abschnitte 3/4 an Token-Übergabe anpassen; Restrisiken um Schreibrolle (Workflows/GHCR) und Verweis auf Umbau B.
- [ ] Commit `docs: Einrichtung für Ingrid, Checkliste und Spec zu Paket A`.
