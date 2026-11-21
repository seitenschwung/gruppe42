# Test-Editor: Design (Stand: Planung)

## Absicht
Mag. Ingrid Nirnberger (Inhaberin, nicht technikaffin) soll die Texte der bestehenden Selbsttests und
ihrer Auswertungen selbst ändern können: ohne JSON, ohne Git, ohne Entwickler. Die übrige Seite gilt
nach der Erstbefüllung als weitgehend statisch und ist **nicht** Teil dieses Vorhabens.
Änderungen kommen selten (einige Male im Jahr); Sicherheit und „nichts kaputt machen können“ gehen vor Komfort.

## Ziele
- Geführter Editor im Look der Website: nur die freigegebenen Textfelder sichtbar, deutsch, „Sie“-Ansprache in der Oberfläche.
- Live-Vorschau mit der echten Test-Engine (`src/js/antreiber.js`) und dem echten CSS: Fragenansicht und Ergebnisansicht.
- „Zur Freigabe senden“ erzeugt einen Pull Request; live geht er erst nach Freigabe (Review) durch Seitenschwung und grüner CI.
- Strukturänderungen sind technisch unmöglich, auch am Editor vorbei (Wächter im Build).

## Nicht-Ziele
- Fragen, Kategorien oder ganze Tests anlegen/löschen; Kategorie-Zuordnung, `reverse`, `levels[].min`, `minSpread`, IDs, `result.kind`, Skalenschlüssel ändern.
- Bearbeiten anderer Seiteninhalte (`gruppe42.json` außerhalb von `tests.eintraege`), Shop, Preise, Bilder.
- Mehrbenutzerbetrieb, Rollenverwaltung, Versionsverlauf im Editor (Git hat ihn).

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es „funktioniert“)
- Ein Text-Edit kann die Auswertung verfälschen oder die Methodik-Tabelle falsch machen.
- Eine Änderung geht ohne Freigabe live.
- Geheimnisse im Browser, im Repo oder in Logs; ein Token mit mehr Rechten als nötig.
- Tracking/Cookies auf der öffentlichen Seite (Datenschutzerklärung sagt „keine Cookies“).

## Rahmenbedingungen (aus dem Projekt)
- Pipeline (`seitenschwung/template/.../pipeline.yml@v1`) ist Owner-verwaltet und vom Bot nicht änderbar; sie baut **ein** Image,
  startet es `--read-only` **ohne Env** und prüft `/healthz`, `/version.txt`, axe, Lighthouse. Neue Routen müssen ohne Env starten (503).
- Server: `server/server.js`, keine npm-Abhängigkeiten, API-Routen per `createApi({…}).routes` (Muster: `checkout.js`).
  Security-Header sind heute global (`SECURITY_HEADERS`, keine CSP).
- Build: `ladeTest()` in `build.js` validiert Test-JSONs und bricht mit `process.exit(1)` ab → Docker-Build und damit CI rot. Das ist der Ort für den Wächter.
- Test-Engine liest die Daten aus `<script id="antreiber-daten">`; `?vorschau` / `?vorschau=N` erzeugt eine Ergebnisansicht.
  `antreiber.js` setzt kein HTML aus Daten (kein `innerHTML`); `inlineMd`/`markdown` in `site/lib/helfer.js` maskieren HTML.
- Preview-Workflow kommentiert PRs mit Screenshots (`.github/preview.json`, Variante `ergebnis` für Testseiten).
- `main` ist derzeit **nicht geschützt**.
- Die Environment `production` (Secrets `COOLIFY_TOKEN`, Tailscale) hat **keine Branch-Beschränkung**; `ci.yml` nutzt `secrets: inherit`.
  Wer im Repo Branches pushen darf, könnte auf einem Branch `ci.yml` ändern und so an die Deploy-Secrets kommen. Repo-Secrets gibt es keine.
- Collaborators heute: `Nirnberger` (admin), `Seitenschwung23` (write, Bot). Der Bot darf keine Workflow-Dateien ändern;
  `dev automerge` merged Dependabot-PRs nach grüner CI.
- Formatierung: Nur `result.title` und `motto` laufen durch `betont()` (`*Wort*` → hervorgehoben); `antreiber.js` setzt alle übrigen Texte
  per `textContent`, Markdown erscheint dort wörtlich.
- Viele Testtexte werden **beim Build** in die Seite geschrieben, nicht von `antreiber.js`: `status`, `result.kicker`, `result.title`, `result.cta`,
  `titel`, `motto`, `intro`, `kurz` (`testSeite()`), `beschreibung`/`kurz` auf `selbsttests.html`.
- Die CI führt Tests nur über die Docker-Stufe `test` aus (`checks` tut ohne `package-lock.json` nichts); sie kopiert nur `server/` und nennt die Testdateien einzeln.

## Ansätze
1. **Fertiges Git-CMS (Sveltia/Decap) unter `/admin`.** Wenig eigener Code; aber verschachtelte Listen sperrig,
   keine echte Ergebnisvorschau, feste Felder nur teilweise sperrbar, ebenfalls OAuth-Endpunkt nötig.
2. **Eigener Test-Editor + PR-Workflow (gewählt).** Am intuitivsten, Struktur hart gesperrt, echte Vorschau;
   mehr Eigenbau, OAuth-Endpunkt nötig.
3. **Kein Editor: Änderungswunsch per Mail/Formular, Bot erstellt PR.** Kein Code, keine Logins; aber nicht selbst, langsamer.

Gewählt: **2**, weil „intuitiv für Nicht-Techniker“ das Ziel ist und 1 bei Sperren + Vorschau kaum Aufwand spart.

## Entscheidungen (abgestimmt)
- Bearbeitbar sind nur Texte; die Struktur bleibt fest (Liste unten).
- Speichern = Branch + Pull Request, nie direkt auf `main`.
- Live erst nach **Freigabe durch Seitenschwung** (Review-Pflicht) **und** grüner CI.
- Login per GitHub App, nur für dieses Repo; Ingrid nutzt ein eigenes GitHub-Konto mit Zwei-Faktor-Pflicht.
- `main` wird per Branch-Ruleset geschützt.

### Freigegebene Felder
In `site/kunden/gruppe42/tests/<test>.json`:
- `name`, `status`
- `scale["1".."5"]` (nur die Beschriftungen, nicht die Schlüssel)
- `categories[].name`, `.headline`, `.lowContext` (falls vorhanden), `.sections[].title`, `.sections[].text`
  (`kind`, `tone` sowie Anzahl und Reihenfolge der Abschnitte fest)
- `questions[].text`
- `result`: `kicker`, `title`, `intro`, `outro`, `note`, `highlight`, `lead`, `tie`, `lowLabel`, `cta.text` (sofern vorhanden;
  `cta.href` bleibt fest, damit keine Linkziele geändert werden können)
  und `levels[].title`, `levels[].text`

In `gruppe42.json` → `tests.eintraege[]` (pro Test): `titel`, `motto`, `intro`, `kurz`, `beschreibung`.
Platzhalter wie `{names}` in `lead` müssen erhalten bleiben.

Alles andere ist fest. Felder, die es bisher nicht gibt, kann der Editor nicht anlegen.

## Design

### 1. Struktur-Wächter (zuerst bauen; schützt unabhängig vom Editor)
- Ein Skript erzeugt aus den Test-JSONs einen **Strukturabdruck** `site/kunden/gruppe42/tests/struktur.json`:
  alles außer den freigegebenen Textfeldern (IDs, Kategorie-Zuordnung, `reverse`, `levels[].min`, `minSpread`,
  `kind`, `tone`, Abschnittsarten/-anzahl, Skalenschlüssel, Fragenanzahl und -reihenfolge, vorhandene Feldnamen;
  für `gruppe42.json` die Liste der Testeinträge mit `id`, `daten`, `sichtbar`).
- `ladeTest()` vergleicht beim Build jede Test-JSON mit dem Abdruck; jede Abweichung → klare deutsche Fehlermeldung, Build bricht ab → CI rot.
- Zusätzliche Text-Regeln im Build: nur Strings, nicht leer, Längenobergrenzen pro Feldart, Platzhalter (`{names}`, der einzige heute) vollständig,
  kein `<`. Formatierung nur, was heute wirklich dargestellt wird: `*Wort*` in `result.title` und `motto`; in allen anderen Feldern
  ist es reiner Text (`*`, `[`…`](`…`)` werden abgelehnt, damit nichts wörtlich auf der Seite landet). Die Engine wird nicht um Markdown erweitert.
- Der Abdruck wird nur von Seitenschwung bewusst neu erzeugt (Strukturänderung = Entwickler-PR). Der Editor schreibt ihn nie;
  ein PR, der ihn ändert, fällt im Review auf. Optional: `CODEOWNERS` für `struktur.json`.
- Tests dafür mit `node --test`, u. a.: geänderte `reverse`/`min`/Kategorie/Fragenanzahl → Fehler; reine Textänderung → ok.
  Damit sie in CI laufen, die Docker-Stufe `test` erweitern (zusätzlich `site/` kopieren und die neue Testdatei aufrufen).
  Unabhängig davon bricht der Build selbst (Stufe 1) bei Verstößen ab.

### 2. GitHub-Absicherung (Owner, einmalig)
- Ruleset für `main`: Änderungen nur per PR, erforderlicher Status-Check = Pipeline-Job, Code-Owner-Review (siehe unten), kein Force-Push/Löschen.
  Bypass nur für den Owner. Vorher prüfen, dass der Ablauf des Bots damit weiter passt.
- GitHub App „Gruppe 42 Editor“: nur auf `seitenschwung/gruppe42` installiert; Rechte: Contents read/write, Pull requests read/write,
  Metadata read, sonst nichts. User-Tokens mit Ablauf (Standard 8 h) aktiv.
- Ingrid: eigenes GitHub-Konto, 2FA, Collaborator mit Rolle „Write“ (nötig für Branches im Repo; `main` bleibt durch das Ruleset zu).
- **Environment `production` auf Branch `main` beschränken** (Deployment branches: nur `main`). Erst danach Ingrid als Collaborator hinzufügen.
  Damit kommt ein geänderter Workflow auf einem Branch nicht an die Deploy-Secrets. Gleiches für `preview`, falls dort Secrets liegen.
- Freigabe über `CODEOWNERS`: `site/kunden/gruppe42/tests/` und `site/kunden/gruppe42/gruppe42.json` (sowie `struktur.json`, `.github/`) gehören
  dem freigebenden Konto `@Nirnberger` (Seitenschwung, Owner); Ruleset mit „Require review from Code Owners“, 0 allgemeine Approvals. So brauchen Editor-PRs die Freigabe,
  Dependabot-/Bot-PRs ohne diese Dateien laufen wie bisher per `dev automerge`. Ingrid und der Bot können sich nicht gegenseitig freigeben.

### 3. Login-Endpunkt im Server
- Neue Datei `server/editor-auth.js` nach dem Muster von `checkout.js`:
  - `GET /api/editor/login` → Redirect zum GitHub-Login der App mit zufälligem `state`
    (signiertes, kurzlebiges Cookie nur für Pfad `/api/editor`, `HttpOnly`, `Secure`, `SameSite=Lax`).
  - `GET /api/editor/callback` → prüft `state`, tauscht `code` serverseitig gegen das User-Token und leitet zu `/editor/#token=…` weiter
    (Fragment, damit das Token nicht in Server-Logs landet). Das Token wird serverseitig **nicht** gespeichert.
  - Ohne `EDITOR_GITHUB_CLIENT_ID`/`EDITOR_GITHUB_CLIENT_SECRET` → `503` (Pipeline-Test bleibt grün).
  - Rate-Limit wie bei `/api/checkout`; nie Tokens loggen. Das Access-Log in `server.js` (Zeile ~44, loggt heute `req.url` komplett)
    so ändern, dass für `/api/editor/*` der Query-String entfällt.
- `.env.example` um die zwei Variablen ergänzen; in Coolify als Secrets setzen.
- Datenschutz: das `state`-Cookie gibt es nur beim Editor-Login, nicht auf der öffentlichen Seite.

### 4. Editor-Seite `/editor/`
- Statisch, vom Build erzeugt (neue Funktion in `build.js`), gleiche Fonts/CSS-Tokens; `noindex`, nicht im Menü,
  nicht in `sitemap.xml`, in `robots.txt` ausgeschlossen. Eigenes Skript `src/js/editor.js`, keine Fremdbibliotheken.
- Token nur im Speicher (Variable); beim Laden aus dem Fragment lesen und das Fragment sofort per `history.replaceState` entfernen.
  Kein `localStorage` für das Token. Ungesendete Entwürfe dürfen in `localStorage` liegen (ohne Token).
- Alle GitHub-Zugriffe direkt aus dem Browser gegen `api.github.com`: Dateien von `main` lesen, Branch anlegen, Commit, PR.
- Ablauf für Ingrid:
  1. „Anmelden“ → GitHub-Login → zurück im Editor.
  2. Test auswählen (Kachel je Test mit Titel aus `tests.eintraege`).
  3. Formular in verständlichen Gruppen: „Startseite des Tests“, „Antwortskala“, „Fragen“ (nummeriert, Kategorie als Hinweis, nur Text),
     „Ergebnis: allgemein“, „Ergebnis je Bereich“ bzw. „Ergebnis-Stufen“ (Grenze als Info, nicht editierbar, z. B. „ab 50 %“).
     Geänderte Felder markiert; „Zurücksetzen“ pro Feld. Formatierungshilfe nur bei `result.title`/`motto` (`*Wort*` = hervorgehoben).
  4. Vorschau rechts (auf schmalen Bildschirmen per Umschalter): die vollständige Testseite in einem `iframe` mit den bearbeiteten Daten,
     inklusive der beim Build geschriebenen Texte. Dafür wird das Seiten-Markup von `testSeite()` (samt `esc`/`betont`) in ein gemeinsames
     Modul unter `site/lib/` verschoben, das Build (Node) und Editor (Browser) gleich nutzen; keine nachgebaute Näherung.
     Zusätzlich eine kleine Vorschau der Kachel auf `selbsttests.html` (`beschreibung`, `kurz`).
     umschaltbar „Fragen“ / „Ergebnis“; bei `ranking` wählbar, welcher Bereich vorne liegt, bei `levels` welche Stufe,
     damit jeder Text einmal sichtbar wird.
  5. Dieselben Text-Regeln wie der Wächter laufen schon im Editor (sofortige, freundliche Hinweise; Senden gesperrt, bis alles passt).
     Die Regeln stehen in einer gemeinsamen Datei, die Build und Editor nutzen.
  6. „Zur Freigabe senden“ (+ optional kurze Notiz) → Branch `inhalt/<test>-<datum>`, ein Commit mit den geänderten Dateien
     (JSON mit 2 Leerzeichen Einrückung und abschließendem Zeilenumbruch, wie heute), PR mit Titel und Beschreibung in einfachem Deutsch
     (welche Felder geändert, alt → neu). Danach Statusanzeige: „Wartet auf Freigabe“ (PR offen) / „Freigegeben, geht live“ (PR gemergt) / „Live“
     (`/version.txt` der eigenen Seite zeigt den Merge-Commit). Kein Lesen von Checks nötig, die App-Rechte bleiben klein.
- Gibt es schon einen offenen Editor-PR für den Test, arbeitet der Editor auf diesem Branch weiter, statt einen zweiten zu öffnen.
  Konflikt mit neuerem `main` → verständliche Meldung; Seitenschwung löst ihn.
- Header für `/editor/`: strenge CSP (`default-src 'self'; connect-src 'self' https://api.github.com; frame-src 'self'; img-src 'self' data:`),
  `X-Frame-Options: DENY` für die Editor-Seite selbst. Dafür Header pro Pfad in `server.js` ergänzen.

### 5. Freigabe
- Seitenschwung bekommt die PR-Benachrichtigung, sieht Diff und Screenshot-Kommentar des Preview-Workflows, gibt frei und mergt → bestehender Deploy.
- Prüfen, ob `.github/preview.json` Änderungen an `site/kunden/gruppe42/tests/*.json` als betroffene Testseiten erkennt; sonst ergänzen.

## Reihenfolge (je ein PR)
1. Struktur-Wächter + Abdruck + Tests (wirkt sofort, auch für Bot-PRs).
2. Owner-Schritte: Ruleset, GitHub App, Ingrids Konto (Checkliste in `CLAUDE.md`).
3. `server/editor-auth.js` + Header pro Pfad + Tests.
4. Editor-Seite: Lesen, Formular, Vorschau (noch ohne Senden).
5. Senden als PR + Statusanzeige.
6. Kurze bebilderte Anleitung für Ingrid (eine Seite).

## Dem Bauenden überlassen
- Genaues Format von `struktur.json` und die Längengrenzen pro Feldart.
- Technik der Vorschau (z. B. `iframe` mit `srcdoc` aus dem gebauten Test-HTML plus ersetztem `antreiber-daten`, oder eigene Vorschau-Seite mit `postMessage`),
  solange echte `antreiber.js` und echtes CSS genutzt werden.
- Wie eine gezielte Ergebnisvorschau („Bereich X vorne“, „Stufe Y“) erzeugt wird; ggf. kleine Erweiterung von `?vorschau`.
- Signatur des `state`-Cookies.

## Restrisiken
- Übernahme von Ingrids GitHub-Konto: Über die Weboberfläche kann ein Angreifer mehr als Text-PRs, nämlich beliebige Branches und PRs
  (auch mit Workflow-Änderungen) anlegen. Er kommt aber weder an `main` (Ruleset + Code-Owner) noch an die Deploy-Secrets
  (Environment nur für `main`). Ein Branch-Workflow hat höchstens das `GITHUB_TOKEN` des PR-Laufs. 2FA senkt das Risiko.
- Inhaltliche Fehler in Texten: die Freigabe durch Seitenschwung ist die Kontrolle.
