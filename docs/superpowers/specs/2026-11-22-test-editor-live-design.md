# Test-Editor live: Design (ersetzt Umbau B)

Ersetzt `2026-11-22-test-editor-umbau-b-design.md` (Entwurf, nicht gebaut). Baut auf dem Editor aus PR #24 auf
(Wächter, `testseite.js`, Editor-Oberfläche, Vorschau, Suche).

## Absicht
Ingrid Nirnberger ändert Testtexte und sieht sie **nach Sekunden live**, ohne Freigabe, ohne Pipeline, **ohne GitHub-Konto**.
Entscheidungen des Owners: keine Freigabe vor Livegang; Login per **Passkey**; neuer Branch auf Basis von #24.

## Ziele
- Speichern im Editor → geprüft (Wächter) → sofort auf der öffentlichen Seite.
- Login nur mit Passkey (Face ID/Touch ID), Einrichtung per einmaligem Einladungslink.
- Jede Änderung im Verlauf, „Rückgängig“ pro Änderung, Benachrichtigung an den Owner.
- Strukturänderungen weiterhin unmöglich (Wächter serverseitig = Durchsetzungspunkt).

## Nicht-Ziele
- Freigabe-Workflow, PRs, GitHub-Login (fällt weg).
- Automatisches Zurückschreiben nach Git (siehe „Repo-Abgleich“).
- Live-Bearbeitung von `name` (Test) und `titel` (Eintrag): stehen in `<title>`, JSON-LD, Methodik-Tabelle; bleiben Entwickler-Sache.

## Anti-Ziele
- HTML/Skript aus Texten auf der öffentlichen Seite.
- Geheimnisse (Passkey-Daten, Sitzungen) in Logs oder URLs (Ausnahme: einmaliger, kurzlebiger Einladungscode im Fragment).
- Image startet ohne Env/Volume nicht mehr (Pipeline-Vertrag bricht).

## Eigene Entscheidungen (Controller, korrigierbar)
- **Overlay statt ganzer Dateien:** Live-Daten sind nur Text-Überschreibungen `{pfad: text}` pro Test/Eintrag. Wirksamer Inhalt = Inhalt im Image + Overlay. Strukturänderungen im Repo funktionieren dadurch weiter; Overlay-Einträge für Pfade, die es nicht mehr gibt oder die kein Textfeld sind, werden ignoriert und im Editor gemeldet.
- **Kein Git-Schreibzugriff vom Server** (keine GitHub-Secrets im Server): Repo-Abgleich per Skript `einpflegen`, das der Entwickler bei Bedarf lokal ausführt.
- **Benachrichtigung:** optionaler Webhook `EDITOR_MELDUNG_URL` (POST JSON `{titel, text}`, z. B. ntfy.sh), fire-and-forget.
- **Sitzungen im Speicher** (ein Container): Neustart = neu anmelden.

## Rahmenbedingungen
- Container read-only, schreibbar nur `/data` (Volume `orders-data`) und `/tmp`. Pipeline startet ohne Env und ohne Volume: dann liefert der Server den Image-Stand, Editor-API antwortet `503`.
- Keine npm-Pakete: WebAuthn mit `node:crypto` (ES256 und RS256), eigener minimaler CBOR-Decoder.
- Server: `server/server.js` mit `createApi({...}).routes`-Muster; Header-/Log-Logik aus PR #24 bleibt.

## Design

### 1. Live-Inhalte (`server/inhalte.js`)
- Basis: beim Image-Build werden `site/kunden/gruppe42/gruppe42.json` und `tests/*.json` (inkl. `struktur.json`) nach `/app/inhalte/` kopiert.
- Overlay: `/data/editor/inhalte.json` = `{ "version": 1, "tests": { "<daten.id>": { "<pfad>": "<text>" } }, "eintraege": { "<eintrag.id>": { "<feld>": "<text>" } } }`. Schreiben atomar (Temp-Datei + `rename`).
- Verlauf: `/data/editor/verlauf.jsonl`, je Speichern eine Zeile `{nr, zeit, wer, testId, aenderungen: [{datei, pfad, alt, neu}]}`.
- `wirksam(testId)` → `{daten, eintrag}` = Basis + Overlay (nur erlaubte, existierende Textpfade); `verwaist` = ignorierte Overlay-Pfade.
- `speichere(testId, aenderungen, wer)`: prüft je Änderung `alt === aktueller wirksamer Wert` (sonst Konflikt mit Pfad), wendet an, führt `pruefeTexte` + `pruefeStruktur` (gegen `struktur.json` aus dem Image) auf dem Ergebnis aus, schreibt Overlay + Verlauf, gibt `nr` zurück. `name`/`titel` werden abgelehnt.
- `rueckgaengig(nr, wer)`: setzt die Werte einer Verlaufszeile zurück, nur wenn die betroffenen Felder noch `neu` enthalten (sonst Konflikt); schreibt eine neue Verlaufszeile.

### 2. Testseiten live ausliefern
- Build setzt unsichtbare Marker (HTML-Kommentare) um die live änderbaren Bereiche: Seitenkopf, Test-/Ergebnis-Abschnitte, Datenskript auf jeder Testseite; Kachelliste auf `selbsttests.html`. Öffentliche Seiten ändern sich nur um diese Kommentare.
- Server rendert beim Start und nach jedem Speichern/Rückgängig die betroffenen Seiten neu: gebaute Seite aus `STATIC_ROOT` als Vorlage, Bereiche zwischen den Markern mit `testseite.js` und dem wirksamen Inhalt ersetzt; Ergebnis im Speicher. Die statische Auslieferung nimmt für diese Pfade die gerenderte Fassung (gleiche Header/ETag-Logik, ETag aus Inhalt).
- Fehlen Marker oder Overlay, wird die gebaute Seite unverändert ausgeliefert.

### 3. Passkey (`server/passkey.js`)
- Registrierung (`navigator.credentials.create`): `attestation: "none"`, `userVerification: "required"`, `residentKey: "required"` (`requireResidentKey: true`; Anmeldung ist nur discoverable, `allowCredentials: []`), Algorithmen ES256 (-7) und RS256 (-257). Server prüft `clientDataJSON` (`type`, `challenge`, `origin === EDITOR_ORIGIN`), `authData` (rpIdHash = SHA-256 von `EDITOR_RP_ID`, Flags UP und UV), liest Credential-ID und COSE-Schlüssel und speichert ihn als JWK.
- Anmeldung (`navigator.credentials.get`): gleiche Prüfungen plus Signatur über `authData || SHA-256(clientDataJSON)` mit dem gespeicherten Schlüssel; `signCount` muss steigen, wenn er nicht 0 ist.
- Challenges: 32 Zufallsbytes, einmalig, 5 Minuten gültig, im Speicher.
- Passkeys: `/data/editor/passkeys.json` = `[{id, name, jwk, alg, signCount, erstellt}]`.

### 4. Einladung, Anmeldung, Sitzung (`server/editor-sitzung.js`)
- Einladung per CLI im Container: `docker exec <container> node server/editor-einladung.js "Ingrid Nirnberger"` → schreibt `{hash(code), name, ablauf: +7 Tage}` nach `/data/editor/einladungen.json`, gibt `https://<EDITOR_ORIGIN-Host>/editor/#einladung=<code>` aus. Einmalig verwendbar.
- Routen (alle `POST`, Header `X-G42-Editor: 1` und Origin = `EDITOR_ORIGIN`, sonst `403`; ohne `EDITOR_ORIGIN`/`EDITOR_RP_ID` oder ohne schreibbares `/data` → `503`; Rate-Limit pro IP):
  `/api/editor/registrieren/start {einladung}` → Optionen; `/api/editor/registrieren/ende {einladung, antwort}` → Passkey gespeichert, Einladung verbraucht, Sitzung gesetzt;
  `/api/editor/anmelden/start` → Optionen (ohne `allowCredentials`, discoverable); `/api/editor/anmelden/ende {antwort}` → Sitzung;
  `/api/editor/abmelden` → Sitzung gelöscht.
- Sitzung: Cookie `g42_sitzung=<32 Zufallsbytes base64url>; Path=/api/editor; HttpOnly; Secure; SameSite=Strict`, serverseitig `{wer, erstellt, zuletzt}`, Leerlauf 2 h, absolut 12 h.

### 5. Editor-API (`server/editor-api.js`)
Mit gültiger Sitzung, Header und Origin wie oben:
- `GET /api/editor/stand` → `{wer, tests: [{id, titel, daten (wirksam), eintrag (wirksam), verwaist}], testsCfg}` (alles, was die Oberfläche für Felder und Vorschau braucht).
- `POST /api/editor/speichern {testId, aenderungen}` → `200 {nr, zeit, live}` | `409 {error:'konflikt', pfad}` | `422 {error:'ungueltig', meldungen: [{pfad, meldung}]}`; danach Neu-Rendern und Benachrichtigung. `live:false` heißt: gespeichert, aber die öffentliche Seite konnte nicht neu gerendert werden (zeigt noch den alten Text); die Oberfläche darf dann nicht „Ist live.“ melden.
- `GET /api/editor/verlauf?testId=` → letzte 50 Einträge; `POST /api/editor/rueckgaengig {nr}` → wie speichern.
- GET-Routen mit Header-Pflicht, ohne Origin-Pflicht (Browser senden bei GET kein Origin).

### 6. Oberfläche
- Anmelden: Knopf „Mit Passkey anmelden“; bei `#einladung=` → „Passkey einrichten“ (Fragment sofort entfernen). Abmelden.
- Formular, Suche, Hinweise, Vorschau wie bisher, Daten aus `/stand`. `name` und Eintrag-`titel` nur als Info, nicht bearbeitbar.
- „Speichern und veröffentlichen“ (Bestätigungsdialog mit Liste alt → neu) → Meldung „Ist live.“ mit Link zur Testseite. Konflikt → Meldung, Entwurf bleibt.
- Verlauf je Test mit „Rückgängig“.
- CSP für `/editor/`: `connect-src 'self'`.

### 7. Entfällt aus PR #24
`server/editor-auth.js` (OAuth, Token-Übergabe), `editor-github.js`, PR-/Label-/GitHub-Konflikt-Logik, `EDITOR_GITHUB_*`-Env, GitHub-App-Teile der Checkliste, „Einmalig einrichten“ mit GitHub-Konto in der Anleitung. Bleiben: Wächter, Fingerprint, `testseite.js`, Engine-Vorschau, Editor-Kern (Felder, Labels), Suche, CSP-/Log-Logik, CODEOWNERS (für Code-Änderungen).

### 8. Repo-Abgleich
- `node server/editor-export.js` im Container gibt das Overlay als JSON aus.
- `node site/lib/einpflegen.js <overlay.json>` lokal: schreibt die Texte in `site/kunden/gruppe42/**` (nur erlaubte Felder, Wächter prüft); danach Commit/PR durch den Entwickler; anschließend Overlay im Container leeren (`node server/editor-export.js --leeren <sha256 des exportierten Stands>`, nur wenn der Stand unverändert ist). Leeren nach dem Deploy; danach Server neu starten oder erneut speichern, damit gerenderte Seiten neu entstehen.

## Restrisiken
- Gestohlenes/entsperrtes Gerät mit Passkey: Angreifer kann Testtexte ändern (nur Text, Wächter-Grenzen). Gegenmittel: Benachrichtigung, Verlauf, Rückgängig, Passkey entfernen (`editor-einladung.js --entfernen <id>`).
- Volume-Verlust: Overlay weg → Seite zeigt Image-Stand. Gegenmittel: Volume-Backup in Coolify, regelmäßig exportieren/einpflegen.
- Einladungslink im Fragment landet in der Browser-Historie: einmalig, 7 Tage, nach Nutzung wertlos.
