# Test-Editor Umbau B: Design (Stand: Entwurf)

Baut auf `docs/superpowers/specs/2026-11-21-test-editor-design.md` (bindend, soweit hier nichts anderes steht) und
`docs/superpowers/plans/2026-11-22-test-editor-paket-a.md` auf. Mit **[Eigene Festlegung]** markierte Punkte hat der Entwurf
selbst entschieden; sie gelten, solange der Owner nichts anderes sagt.

## Absicht
Ingrid Nirnberger soll **keine Rolle im GitHub-Repo** mehr brauchen. Heute ist sie Collaborator mit „Write“, weil der Browser
mit ihrem User-Token der GitHub App Branches, Commits und PRs anlegt. Das Sicherheits-Audit hat gezeigt: Mit einem
übernommenen Write-Konto kann man auf einem Branch Workflows ändern, Images nach GHCR pushen (der Deploy nutzt einen
veränderlichen Tag), Labels setzen und ungeschützte Branches löschen, also an der Freigabe des Owners vorbei.
Umbau B: Der Node-Server schreibt selbst nach GitHub, mit dem **Installation-Token** der App. Ihr Login dient nur noch dazu,
sie zu **erkennen** (Prüfung gegen eine Allowlist).

## Ziele
- Ingrid wird aus den Collaborators entfernt; der Editor funktioniert für sie unverändert (gleiche Oberfläche, gleicher Ablauf).
- Im Browser liegt kein GitHub-Token mehr, weder im Speicher noch in Cookies, die JavaScript lesen kann.
- Der Server ist die Stelle, an der alles durchgesetzt wird: Er liest frisch, wendet nur erlaubte Feldänderungen an, lässt den
  Wächter (`site/lib/testwaechter.js`) auf dem zusammengeführten Inhalt laufen und schreibt nur die zwei erlaubten Dateien.
- Das Installation-Token kann keine Workflows ändern und hat keinen Zugriff auf Packages (GHCR).

## Nicht-Ziele
- Neue Editor-Funktionen, andere bearbeitbare Felder, Mehrbenutzer-Rollen.
- Änderungen an Pipeline, Ruleset-Logik, `CODEOWNERS` oder dem Freigabeweg (Freigabe durch Seitenschwung bleibt Pflicht).
- Persistente Sitzungen über einen Neustart hinweg.

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es „funktioniert“)
- Eine übernommene Editor-Sitzung kann etwas anderes als Text-PRs auf die zwei Dateien erzeugen.
- Privater Schlüssel, JWT, Installation-Token, Sitzungs-ID oder OAuth-Code erscheinen in Logs, URLs, Antworten oder im Repo.
- Der Server-Schreibweg umgeht den Wächter oder den Strukturabdruck (z. B. Abdruck vom PR-Branch statt von `main`).
- Das Image startet ohne Env nicht mehr oder antwortet ohne Env anders als `503` auf `/api/editor/*`.
- Ein Cookie auf der öffentlichen Seite (außerhalb von `/api/editor`).

## Rahmenbedingungen
- Pipeline startet das Image `--read-only` **ohne Env**: alle `/api/editor/*` → `503 {"error":"editor_disabled"}`, `/healthz` grün.
- Read-only-Dateisystem: Sitzungen und Token-Cache nur im Arbeitsspeicher. Ein Neustart (Deploy) meldet ab; Entwürfe in
  `localStorage` bleiben erhalten.
- Keine npm-Abhängigkeiten: JWT (RS256) mit `node:crypto` (`crypto.createPrivateKey(pem)`, `crypto.sign('sha256', daten, key)`,
  base64url). Kein `jsonwebtoken`, kein Octokit.
- Rate-Limits wie bei `checkout.js` (Map pro Schlüssel, 60-s-Fenster) **[Eigene Festlegung]**: Login/Callback 20/min pro IP
  (wie heute); Lese-Routen 60/min pro Sitzung; `senden` 5/min und 30/Tag pro GitHub-Nutzer-ID.
- Logs: Access-Log ohne Query für `/api/editor/*` (besteht). Zusätzlich nur Audit-Zeilen ohne Geheimnisse:
  `editor: login ok id=<id> login=<login>`, `editor: login abgelehnt id=<id>`, `editor: senden id=<id> test=<test> pr=<n>`.
  Fehler von GitHub nur mit Status und Route, nie mit Header oder Body.
- Ein Container, ein Prozess (Coolify). Mehrere Instanzen sind nicht vorgesehen; In-Memory-Sitzungen sind daher zulässig.
- Server-Code läuft auf Node 20 (`btoa`, `atob`, `TextEncoder`, `fetch` vorhanden).

## Ansätze
1. **GitHub-Login nur zur Erkennung + Server schreibt mit Installation-Token.** Die bestehende OAuth-Strecke der App bleibt;
   der Callback ruft mit dem User-Token einmal `GET /user`, prüft die **numerische** Nutzer-ID gegen die Allowlist und widerruft
   das Token sofort (`DELETE /applications/{client_id}/token`). Danach nur eine Server-Sitzung.
   Plus: wenig neuer Sicherheitscode, 2FA/Passkey und Kontowiederherstellung erledigt GitHub, Ingrid kennt den Login schon.
   Minus: Ingrid braucht weiter ein GitHub-Konto (aber ohne Repo-Rolle); englische GitHub-Dialoge bleiben.
2. **Eigener Login ohne GitHub + Server schreibt.**
   a) Passkey/WebAuthn: kein Passwort, phishing-resistent. Aber eigener Code für CBOR/COSE-Auswertung und ES256-Prüfung
      ohne Bibliothek, Registrierung per Einmal-Einladung, Speicherung des öffentlichen Schlüssels (Env oder Volume `/data`),
      Wiederherstellung bei verlorenem Gerät nur über Seitenschwung.
   b) Magic Link per E-Mail: einfach für Ingrid, aber neuer Mail-Dienst samt Secret, Sicherheit = ihr Postfach,
      Link-Token in der URL (Log-Schwärzung nötig).
   Plus: kein GitHub-Konto mehr. Minus: deutlich mehr selbstgebauter Sicherheitscode, den niemand sonst prüft.
3. **Heutiges Modell, nur gehärtet.** Write-Rolle bleibt; dazu Deploy per Digest, GHCR-Paketzugriff nur für Actions,
   Rulesets für alle Branches (Löschen sperren, Anlegen nur `inhalt/**`), Push-Ruleset gegen `.github/**`, falls der Plan es kann.
   Plus: kein Umbau. Minus: Restrisiko bleibt (Labels, Branches, PRs mit beliebigem Inhalt), hängt an mehreren Owner-Einstellungen.

**Empfehlung [Eigene Festlegung]: Ansatz 1.** Er entfernt die Repo-Rolle, also den Kern des Audit-Befunds, mit dem
kleinsten Anteil eigener Kryptografie. Die Schnittstelle unten ist so geschnitten, dass sich der Login später gegen 2a tauschen
lässt (nur `login`/`callback` ändern sich, alles ab „Sitzung“ bleibt). Die Härtungen aus 3, die nichts kosten (Deploy per Digest,
GHCR nur Actions), sollte der Owner trotzdem umsetzen.

## Design (Ansatz 1)

### 1. GitHub App (Owner, einmalig)
- Dieselbe App „Gruppe 42 Editor“ weiterverwenden **[Eigene Festlegung]**, Installation nur auf `seitenschwung/gruppe42`
  („Only select repositories“).
- Repository-Rechte minimal: **Contents: Read and write**, **Pull requests: Read and write**, **Metadata: Read**. Sonst nichts:
  insbesondere **kein „Workflows“** (GitHub lehnt dann Commits ab, die `.github/workflows/` berühren), kein Packages, kein
  Administration, kein Issues, kein Checks. Account-Rechte: keine (`GET /user` geht mit jedem User-Token).
  Das Label `manual-review` auf einem PR geht über die Issues-Labels-API; ob „Pull requests: write“ dafür reicht, beim Bau
  prüfen. Reicht es nicht, Label weglassen statt „Issues: write“ zu vergeben **[Eigene Festlegung]**.
- Webhook der App aus. Neuen privaten Schlüssel erzeugen, in Coolify als Secret hinterlegen, lokale Kopie löschen.
- Die App steht **nicht** in der Bypass-Liste des Rulesets; `main` bleibt nur per PR mit Code-Owner-Freigabe erreichbar.
  PR-Autor ist künftig `<app>[bot]`, daher gibt es auch keine Selbstfreigabe.

### 2. Env (Coolify; alle in `.env.example` mit Leerwert)
`EDITOR_GITHUB_CLIENT_ID`, `EDITOR_GITHUB_CLIENT_SECRET` (bestehen), neu: `EDITOR_APP_ID`, `EDITOR_APP_INSTALLATION_ID`,
`EDITOR_APP_PRIVATE_KEY` (PEM; `\n` als Text wird in Zeilenumbrüche gewandelt), `EDITOR_ERLAUBT` (kommagetrennte numerische
GitHub-Nutzer-IDs), `EDITOR_SITZUNG_SECRET` (≥ 32 Zeichen, für das `state`-HMAC; bisher wurde das Client-Secret genutzt).
Fehlt eine Variable oder ist der Schlüssel nicht lesbar → alle Editor-Routen `503`; einmalige Logzeile ohne Inhalt.
Repo fest im Code: `seitenschwung/gruppe42`, Basis `main`.

### 3. Neue Server-Module
- `server/github-app.js`: `jwt()` (Header `{alg:'RS256',typ:'JWT'}`, Claims `iat = jetzt−60`, `exp = jetzt+540`, `iss = APP_ID`),
  `installationToken()` (`POST /app/installations/{id}/access_tokens` mit Body
  `{repositories:['gruppe42'], permissions:{contents:'write', pull_requests:'write', metadata:'read'}}`, damit das Token nie mehr
  kann als nötig; Cache bis 5 min vor `expires_at`; parallele Anfragen teilen sich ein Promise), `fetch` und `jetzt` injizierbar.
- `server/editor-api.js`: Sitzungen, CSRF-Prüfung, Routen unten. Nutzt `editor-github.js` (läuft unverändert in Node, `ctx.token` =
  Installation-Token, `ctx.fetch` = Server-`fetch`), `editor-kern.js` (`felder`, `setze`, `prText`) und `testwaechter.js`.
- `server/editor-auth.js`: `callback` setzt statt Token-Übergabe die Sitzung (siehe 4). `login` bleibt.
- Image (Stufe 3) braucht zusätzlich `site/lib/testwaechter.js`, `site/vorlagen/beratung/src/js/editor-kern.js` und
  `editor-github.js` mit **gleichen relativen Pfaden** (wegen `require('../../../../lib/testwaechter')`) **[Eigene Festlegung]**.
  Der Dockerfile wird gerade von anderer Seite bearbeitet: die COPY-Zeilen und die neuen Testdateien in Stufe `test` im selben PR
  wie der Server-Code ergänzen, auf dem dann aktuellen Stand.

### 4. Sitzung, CSRF, Lebensdauer
- Callback: `state` prüfen (wie heute) → Code tauschen → `GET /user` → `id` in `EDITOR_ERLAUBT`? Sonst `302 /editor/#fehler=zugriff`.
  User-Token in jedem Fall sofort widerrufen (Fehler beim Widerruf nur loggen). Neue Sitzung anlegen,
  `302 /editor/#angemeldet`.
- Sitzungs-ID: 32 Zufallsbytes (base64url). Der Server speichert nur `sha256(id)` → `{nutzerId, login, erstellt, zuletzt}`.
- Cookie `g42_sitzung=<id>; Path=/api/editor; HttpOnly; Secure; SameSite=Strict` ohne `Max-Age` (endet mit dem Browser).
- Lebensdauer **[Eigene Festlegung]**: 30 min Leerlauf, 8 h absolut; höchstens 3 Sitzungen pro Nutzer (älteste fällt weg);
  abgelaufene werden bei jedem Zugriff aufgeräumt. Abmelden löscht Eintrag und Cookie.
- CSRF für **alle** Routen außer `login`/`callback`: Header `X-G42-Editor: 1` Pflicht; `Origin` fehlt oder ist gleich dem eigenen
  Origin (aus fester Konfiguration, nicht aus `Host`); bei `POST` zusätzlich `Content-Type: application/json`, Body ≤ 64 KB.
  Verstoß → `403 {"error":"herkunft"}`. Zusammen mit `SameSite=Strict` reicht das; kein eigenes CSRF-Token **[Eigene Festlegung]**.
- Keine gültige Sitzung → `401 {"error":"abgemeldet"}`; der Editor zeigt dann „Anmelden“ (Entwurf bleibt).

### 5. API zwischen Browser und Server
Alle Antworten JSON, `Cache-Control: no-store`. Fehlerform `{"error": "<code>", "pfad"?: "...", "text"?: "..."}`.

| Route | Zweck |
|---|---|
| `GET /api/editor/login`, `GET /api/editor/callback` | wie oben |
| `GET /api/editor/sitzung` | `{login, ablauf}` oder `401` |
| `POST /api/editor/abmelden` | `204` |
| `GET /api/editor/tests` | `{kopf, tests:[{index, id, titel, offen:{nummer}\|null}]}` aus `gruppe42.json` auf `main` |
| `GET /api/editor/test?id=<id>` | `{kopf, quelle:'main'\|'pr', pr:{nummer}\|null, test, eintrag, index}`; liest vom offenen `inhalt/<id>-…`-Branch, wenn es ihn gibt. Enthält dessen PR andere Dateien als die zwei erlaubten (`prDateien`) → `409 {"error":"fremd"}` |
| `POST /api/editor/senden` | Body `{id, kopf, aenderungen:[{datei:'test'\|'eintrag', pfad, alt, neu}], notiz}` → `{nummer, zustand:'offen'}` |
| `GET /api/editor/status?nummer=<n>` | `{zustand:'offen'\|'gemergt'\|'geschlossen', mergeSha}`; nur für PRs mit Head `inhalt/…` aus dem eigenen Repo, sonst `404` |

Ablauf von `senden` auf dem Server (der Server ist die Durchsetzungsstelle):
1. Sitzung, CSRF, Rate-Limit. Offenen PR für `id` neu ermitteln; Ziel = PR-Branch oder `main`; dessen Kopf muss `kopf` sein,
   sonst `409 {"error":"konflikt"}`. Fremd-Dateien-Prüfung wie bei `GET test`.
2. `gruppe42.json` und die Test-JSON vom Ziel-Kopf lesen, `tests/struktur.json` **immer vom aktuellen `main`**.
   Den Pfad der Test-JSON nur aus `eintraege[index].daten` von `main` ableiten und auf `site/kunden/gruppe42/tests/<name>.json`
   (kein `..`) prüfen.
3. Jede Änderung: `pfad` muss in `K.felder(test, eintrag)` der jeweiligen Datei vorkommen (sonst `400 {"error":"feld", pfad}`);
   aktueller Wert muss `alt` sein (sonst `409 {"error":"konflikt", pfad}`); dann `K.setze`. Leere Liste → `400`.
4. `pruefeTexte` und `pruefeStruktur` (Test und Eintrag) auf dem Ergebnis; jede Meldung → `422 {"error":"waechter", pfad, text}`.
5. Nur geänderte Dateien schreiben (`JSON.stringify(obj, null, 2) + '\n'`), nur diese zwei Pfade. PR-Titel und -Text erzeugt der
   **Server** mit `K.prText`; `notiz` ist reiner Text (≤ 500 Zeichen, gleiche Zeichenverbote wie der Wächter, `@` → `@​`
   gegen Erwähnungen, kein Link-Markdown). Zeile „Geändert von: <login>“ anhängen.
6. `EditorGithub.sende(...)` mit `erwartet = kopf`; neuer PR bekommt das Label `manual-review` (Fehler ignorieren).

### 6. Änderungen an den Browser-Modulen
- `editor-github.js`: wird **nicht mehr im Browser geladen**; das Modul läuft serverseitig weiter (Tests bleiben, laufen in Stufe `test`).
  `zugriff` und das Lesen von `repo.permissions.push` entfallen.
- Neues kleines `src/js/editor-api.js` (Thin Client): `sitzung()`, `tests()`, `test(id)`, `senden(eingabe)`, `status(n)`,
  `abmelden()`; setzt immer `X-G42-Editor: 1`, `credentials: 'same-origin'`; bildet Fehlercodes auf die bestehenden Meldungen ab
  (`abgemeldet` → Anmelden, `konflikt` → „Stand hat sich geändert“, `fremd` → Meldung aus Paket A, `waechter` → Feld markieren).
- `editor.js`: kein `sitzung.token` mehr; beim Laden `GET sitzung`; `oeffneTest` nutzt `GET test`; `sende` schickt nur die
  Änderungsliste (`K.aenderungen` liefert `alt`/`neu` je Feld; falls nicht, dort ergänzen). Der Wächter läuft im Browser weiter,
  aber nur noch für freundliche Hinweise. Live-Status wie heute über `status` + `/version.txt`. PR-Links für Ingrid ausblenden,
  falls das Repo privat ist (siehe Offene Fragen).
- `editor-kern.js`, `editor-vorschau.js`: unverändert (außer ggf. `alt`/`neu` in `aenderungen`).
- CSP für `/editor/`: `connect-src 'self'` (ohne `https://api.github.com`).

### 7. Was von Paket A bleibt
- Bleibt: `state`-Cookie und Login-CSRF-Schutz, Weiterleitung `#angemeldet` ohne Token, Pflicht-Header + Origin-Prüfung,
  Fremd-PR-Prüfung (`prDateien`, jetzt serverseitig), Label, Wächter-Regeln, Bedienbarkeit, Pfadprüfung ohne Groß/Klein.
- Entfällt: Cookie `g42_token`, `POST /api/editor/token`, Token-Weitergabe an den Browser, `abmelden` mit `{token}`
  (wird zum Löschen der Sitzung; der Widerruf passiert schon im Callback). Ist Paket A Task 2/3 noch nicht gebaut,
  diese Teile nicht mehr bauen.

## Migration (je ein PR, außer Owner-Schritte)
1. Owner: App-Rechte wie in Design 1 setzen, privaten Schlüssel erzeugen, Installation-ID und Ingrids numerische Nutzer-ID
   notieren (`GET https://api.github.com/users/<login>`), Env in Coolify setzen. Alter Editor läuft weiter.
2. Server: `github-app.js`, `editor-api.js`, Callback auf Sitzung, Image-COPY, Tests. Der Browser nutzt noch den alten Weg.
3. Browser: `editor-api.js`, `editor.js` umstellen, CSP verschärfen, `editor-github.js` aus dem Editor-HTML entfernen;
   alte Token-Routen löschen. Owner-Test: Ingrids Konto sendet einen Text-PR, der PR-Autor ist der App-Bot.
4. Owner: Ingrid aus den Collaborators entfernen (Einladung ggf. zurückziehen); ihre alten App-Autorisierungen widerrufen.
   Prüfen, dass ihr Konto keinen Fork-/Branch-Zugriff mehr hat.
5. Doku: `CLAUDE.md` (Env, Abschnitt Editor), Anleitung (kein „Einladung annehmen“ mehr), Spec-Restrisiken aktualisieren.

## Teststrategie
- `node --test`, GitHub per injiziertem `fetch`-Mock (Tabelle Methode+Pfad → Antwort; unerwartete Aufrufe lassen den Test scheitern).
- `github-app.test.js`: JWT mit Schlüsselpaar aus `crypto.generateKeyPairSync('rsa')` erzeugen und mit dem öffentlichen
  Schlüssel prüfen (Header, `iss`, `exp − iat ≤ 600`); Token-Cache, Erneuerung vor Ablauf, ein Aufruf bei parallelen Anfragen;
  angefragte `permissions` exakt wie oben.
- `editor-api.test.js` über `createServer` (echte HTTP-Anfragen): ohne Env → `503` auf jeder Route; nicht erlaubte ID → kein Cookie,
  `#fehler=zugriff`, User-Token widerrufen; Cookie-Attribute; fehlender Header / fremder `Origin` → `403`; Leerlauf- und
  Absolutablauf mit verstelltem `jetzt`; `senden` mit Pfad außerhalb der Felder → `400`, falschem `alt` → `409`,
  Wächterverstoß (`*` in `questions[0].text`, geänderte Struktur) → `422` mit `pfad`; Struktur wird von `main` gelesen, auch
  wenn der PR-Branch eine andere hat; nur die zwei Pfade landen in `POST /git/trees`; Fremd-PR → `409 fremd`;
  `notiz` mit `@nutzer` wird entschärft; Rate-Limits.
- Log-Test: alle Logzeilen eines kompletten Ablaufs sammeln; darin dürfen Test-Token, JWT, Code, Sitzungs-ID und Schlüssel nicht vorkommen.
- Browser: Seiten-Stub wie in Paket A (nur im git-ignorierten `dist`), jetzt gegen gemockte `/api/editor/*` statt `api.github.com`.
- Alle neuen Testdateien in Stufe `test` des Dockerfile aufnehmen.

## Offene Fragen an den Owner (die Antwort ändert den Bau)
1. **Login-Methode:** Ansatz 1 (GitHub-Konto nur zur Erkennung) oder 2a (Passkey ohne GitHub)? Ohne Antwort: Ansatz 1.
2. **Allowlist-Ablage:** Env `EDITOR_ERLAUBT` in Coolify (Änderung ohne PR, nur Owner) oder Datei im Repo (Änderung per PR,
   im Verlauf sichtbar)? Ohne Antwort: Env.
3. **Wie viele Personen bearbeiten?** Nur Ingrid, oder auch der Owner bzw. weitere? Bei mehreren: Darf eine Person auf dem offenen
   PR einer anderen weiterarbeiten (heute ja), und sollen die Limits pro Person oder gesamt gelten? Ohne Antwort: wie heute, pro Person.
4. **Ist das Repo privat?** Dann sieht Ingrid ohne Rolle die PR-Seite nicht; der Editor zeigt keinen PR-Link, nur den Status.
   Ohne Antwort: Link ausblenden.

## Restrisiken
- Übernahme von Ingrids GitHub-Konto (Ansatz 1) oder Sitzung: Angreifer kann nur Text-PRs auf die zwei Dateien erzeugen, die
  der Wächter durchlässt; live geht nichts ohne Freigabe.
- Übernahme des Servers oder des Coolify-Secrets: Das Installation-Token kann beliebige Dateien außer Workflows auf Branches
  schreiben und PRs öffnen; `main` bleibt durch Ruleset + `CODEOWNERS` geschützt. Schlüssel bei Verdacht in der App widerrufen.
- In-Memory-Sitzungen: Neustart meldet ab (gewollt einfach).
