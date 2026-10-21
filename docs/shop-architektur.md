# Shop: Architektur-Plan (Stand: Planung, kein Livebetrieb)

Ziel: Shop mit Zahlung auf derselben Seite (`gruppe42.seitenschwung.com`). Die bestehende statische
Seite (Node-Build, `site/`) bleibt unverändert.

## Ausgangslage
- Heute: Node-Build erzeugt HTML, nginx-unprivileged liefert es aus (Port 8080, `/healthz`, `/version.txt`).
- Die Pipeline (`.github/workflows/pipeline.yml`, nicht von uns änderbar) baut **ein** Image aus `Dockerfile`,
  startet es allein (`--read-only`, tmpfs `/tmp`, **ohne Env-Variablen, ohne Volume**) und prüft
  `/healthz`, `/version.txt`, Axe/Lighthouse. Coolify deployt genau dieses eine `IMAGE`.
- Ein Shop braucht Server-Code: Checkout-Session anlegen, Stripe-Webhook, Bestellungen speichern.

## Optionen
1. **nginx + zweiter Node-Container (`/api/*`) im selben compose.** Sauber getrennt, braucht aber ein
   zweites Image. Die Pipeline baut/testet/pusht nur eins → Pipeline-Änderung nötig.
2. **Next.js.** Seite müsste umgebaut werden, widerspricht „Seite unverändert“. Verworfen.
3. **Ein Image, ein kleiner Node-Server statt nginx** (empfohlen). Er liefert das unveränderte
   statische `dist/` aus und bedient zusätzlich `/api/*`.

## Empfehlung: Option 3
- Ein Container, ein Prozess, keine Abhängigkeiten (Node-Stdlib: `http`, `crypto`, `fetch`). Stripe wird über
  die REST-API angesprochen, die Webhook-Signatur per HMAC-SHA256 selbst geprüft → keine npm-Pakete,
  kleine Angriffsfläche.
- Passt in den bestehenden Vertrag ohne Pipeline-Änderung: Port 8080, `/healthz`, `/version.txt`,
  non-root, read-only, nur `/tmp` schreibbar. Das Image startet auch ohne Stripe-Schlüssel
  (Shop-Routen antworten dann `503`), damit der Pipeline-Test grün bleibt.
- Die nginx-Header (`nosniff`, `Referrer-Policy`, `X-Frame-Options`, Cache-Header) werden im Node-Server
  nachgebaut; ein Test sichert das gegen die heutige `nginx.conf` ab.
- Spätere Trennung bleibt möglich: `/api/*` ist von den statischen Routen entkoppelt und lässt sich
  in einen eigenen Dienst herausziehen, sobald die Pipeline mehrere Images kann.
- CrowdSec-Label wechselt von `nginx` auf `http` (App-Server, laut Org-Regel); vorher mit Owner abstimmen,
  der Parser muss auf dem Server vorhanden sein.

## Bausteine (je ein PR)
1. Dieser Plan.
2. Node-Server: statisch + `/healthz` + `/version.txt` + Header-Parität; Dockerfile/compose umstellen; kein Shop.
3. `products.json` (serverseitige Preise/Produkte, Schema + Validierung) und `.env.example`
   (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`). Keine Schlüssel in Git.
4. `POST /api/checkout`: nimmt nur Produkt-ID und Menge, Preis immer aus `products.json`;
   legt Stripe-Checkout-Session an (Testmodus), liefert Redirect-URL.
5. `POST /api/stripe/webhook`: Rohbody, Signatur- und Zeitstempelprüfung, Idempotenz über Event-ID,
   Reaktion auf `checkout.session.completed`.
6. Bestellungen speichern (Datei/SQLite auf Volume `/data`, siehe offene Punkte).
7. Shop-Seiten im Template (Produktliste, Erfolg/Abbruch), erst nach Freigabe der Rechtstexte sichtbar.

## Sicherheit
- Preise und Beträge nie vom Client; Stripe-Session wird serverseitig aus `products.json` gebaut.
- Webhook: Signatur gegen `STRIPE_WEBHOOK_SECRET`, Toleranz 5 min, konstante Vergleichszeit.
- Secrets nur als Env in Coolify; `.env` bleibt außerhalb von Git. Keine Kundendaten in Logs.
- Request-Größenlimits, Rate-Limit auf `/api/*`, kein CORS.

## Rechtliches (Platzhalter, keine Texte erfunden)
Vor Livebetrieb vom Kunden/Juristen zu liefern und zu prüfen:
- Impressum (vollständig, Rechtsform, Aufsichtsbehörde; heute teils unbestätigt)
- AGB
- Widerrufsbelehrung bzw. Hinweis auf Ausnahmen (digitale Inhalte / Dienstleistungen, Konsumentenschutz AT)
- Datenschutzerklärung, ergänzt um Zahlungsabwicklung (Stripe als Auftragsverarbeiter, Bestelldaten, Speicherdauer)
- Preisangaben inkl. USt., Button-Beschriftung „zahlungspflichtig bestellen“, Bestellbestätigung per E-Mail

## Offene Punkte / Bedarf an die Pipeline und den Owner
- **Pipeline:** Option 3 braucht keine Änderung. Option 1 bräuchte Build/Test/Push für ein zweites Image.
- **Persistenz:** Bestellungen brauchen ein beschreibbares Volume (`/data`) in compose. Der Pipeline-Test läuft
  ohne Volume, der Server darf daher ohne `/data` starten (Shop dann deaktiviert).
- **Node-Version:** `node:sqlite` erst ab Node 22; sonst JSON-Lines-Datei. Entscheidung im PR 6.
- **Produkte, Preise, Steuersatz, Versand:** vom Kunden.
- **Stripe-Konto** (Testmodus zuerst), Webhook-Endpoint `https://gruppe42.seitenschwung.com/api/stripe/webhook`
  und Env-Variablen in Coolify: Owner.
- **E-Mail-Versand** (Bestellbestätigung): Anbieter offen.
