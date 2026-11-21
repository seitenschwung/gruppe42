# Gruppe 42 website

Static website for Gruppe 42 (Personalentwicklung, Wien; Mag. Ingrid Nirnberger), prod
`gruppe42.seitenschwung.com`. Extracted from `Nirnberger/sample_sites` (template `beratung`);
nothing else from that repo is kept. UI language: German.

## Stack
Plain Node (no npm deps) static-site generator, output served by a small dependency-free Node server (`server/`). Image build
needs `cwebp` (libwebp-tools) for WebP variants; AVIF is skipped when `avifenc` is missing.

## Layout
- `site/kunden/gruppe42/gruppe42.json`: all page content (texts, workshops, references, logo paths)
- `site/kunden/gruppe42/static/img/`: logo + partner logos, copied into the output as-is
- `site/vorlagen/beratung/`: template (`build.js`, `src/css`, `src/js`, `fonts`, `images`, `schema.json`)
- `site/lib/`: helpers used by `build.js` (`helfer.js`, `bilder.js`)
- `Dockerfile`: stage 1 builds `site/` to HTML, stage 2 runs `server/*.test.js` (pipeline test stage), stage 3 is `server/server.js` (`/healthz`, `/version.txt`, `/api/checkout`; Stripe session via REST, no SDK)

## Commands
- Build: `cd site && node vorlagen/beratung/build.js kunden/gruppe42/gruppe42.json && cp -r kunden/gruppe42/static/. vorlagen/beratung/dist/`
- Preview: `python3 -m http.server 8080 -d site/vorlagen/beratung/dist` (dist is git-ignored)
- Docker: `docker build --build-arg APP_VERSION=dev -t gruppe42 .`; CI does build + hardened run + axe/Lighthouse
- No tests/lint scripts; CI browser tests are the check

## Pitfalls
- `demo_modus: false` + `website_url` set on purpose: demo mode adds noindex and fails Lighthouse SEO (<90)
- Portrait: `site/vorlagen/beratung/images/ingrid-nirnberger.jpg` (from client inbox, `person.bild`); images in `images/` get WebP size variants at build, `static/img/` is copied as-is (SVG, small logos)
- Logo usage rights, Impressum details and open client questions are unconfirmed
- Build writes to `vorlagen/beratung/dist` and `.bildcache`; both git-ignored
- Deploy: only the CI job `Deploy (Coolify)` on push to `main` (needs repo var `COOLIFY_APP_UUID`, which sets `IMAGE`).
  Coolify "Auto Deploy" must stay off, else compose fails with "required variable IMAGE is missing"
- Shop plan: `docs/shop-architektur.md`
- Shop data: `server/products.json` (only source of prices, cents; `entwurf:true` = placeholder, not buyable), `server/products.js` validates; `.env.example` lists Stripe vars
- Shop images in `site/vorlagen/beratung/images/shop/` (`bild.datei: shop/x.jpg` in products.json) (Unsplash, credit in products.json); `images.unsplash.com` needs `dev allow`
- Shop page `shop.html`: built by `shopSeite()` in build.js from `shop` in gruppe42.json (reads `server/products.json`). Visible (menu, sitemap, indexable) since `shop.sichtbar: true`; false = hidden (noindex, no menu, not in sitemap); buy button disabled until checkout exists
- Checkout: `server/checkout.js` (POST /api/checkout {id,menge}; 503 without STRIPE_SECRET_KEY; rate limit; tests mock Stripe). Webhook: `server/webhook.js` (POST /api/stripe/webhook, signature verified, idempotent by event id in memory). Orders: `server/orders.js` appends to `$DATA_DIR/orders.jsonl` (default `/data`, compose volume `orders-data`; no customer data, one line per Checkout session). Read: `docker exec <container> cat /data/orders.jsonl`. Unwritable /data -> webhook 500 -> Stripe retries
- Gesprächskarten: optional `karten` in gruppe42.json (`sichtbar`, `titel`, `motto`, `intro`, `kartensaetze[]{id,titel,karten[]}`) -> `gespraechskarten.html` (`kartenSeite()`, client `src/js/karten.js`, random draw without repeats, fullscreen, no-JS = list). Hidden (noindex, no menu) unless `sichtbar: true`; then a card appears in the hub `selbsttests.html`
- Tests (Selbsttests): `tests` in gruppe42.json lists tests (`eintraege[]`: id = page `<id>.html`, `daten` = JSON in `site/kunden/gruppe42/tests/`, `sichtbar`). One visible test -> menu/teaser link straight to it, 2+ -> hub `selbsttests.html`. Build: `testSeite()`/`ladeTest()` (validates data) in build.js; client engine `src/js/antreiber.js` (scoring, results, mailto, print; nothing stored or sent; loaded only on test pages). Test JSON: `scale`, `categories[]` (`sections[]` kinds text/labeled/column/quote), `questions[]` (`reverse: true` flips), `result.kind` = `ranking` or `levels` (`levels[].min` = percent). Test copy uses "du", rest of site "Sie"
- Test guard: `site/lib/testwaechter.js` (only text fields editable; limits, no `<`/links/`*` except `*Wort*` in `result.title`/`motto`, `{names}` kept) + fingerprint `site/kunden/gruppe42/tests/struktur.json`. `pruefeTests()` in build.js runs before any image work and aborts with the concrete path (e.g. `questions[0].reverse`). After a deliberate structure change (new question/field, `reverse`, categories) regenerate: `node site/lib/struktur-erzeugen.js site/kunden/gruppe42/gruppe42.json`
- Result preview without taking a test: append `?vorschau` (random answers) or `?vorschau=3` (all answers 3) to any test page URL
- Tests quality: `tests.methodik` in gruppe42.json -> `methodik.html` (how tests are built, limits; table generated from test JSONs). Engine: ranking shows no leader when spread < `result.minSpread` (default 0.1 of max); hint if >=90% identical answers. Teamklima 20 items, Employer-Branding 16 (4 per area, some `reverse`). Still NOT scientifically validated
- Header menu: `hauptnav()` in build.js. "Angebot" = <details> dropdown (Workshops per Zielgruppe, Leistungen with own page, Seminare); main.js closes it on Esc/outside click and handles the mobile menu button (without JS everything stays visible). One CTA "Kontakt aufnehmen" (kontaktZiel).

## Test-Editor
- `/editor/`: client edits test texts in the browser (login with GitHub, preview, "Zur Freigabe senden" opens a PR). Nothing goes live without owner review. Client guide: `docs/anleitung-test-editor.md`; design: `docs/superpowers/specs/2026-11-21-test-editor-design.md`
- Parts: guard `site/lib/testwaechter.js` + `struktur.json` (regenerate command above), login `server/editor-auth.js` (GitHub code exchange; 503 without env), UI `src/js/editor*.js` (kern, github, vorschau, editor), page `editorSeite()` in build.js (noindex, not in menu/sitemap, `Disallow: /editor/`)
- Env (Coolify): `EDITOR_GITHUB_CLIENT_ID`, `EDITOR_GITHUB_CLIENT_SECRET`. Token only in memory, never stored or logged
- `.github/CODEOWNERS`: tests/, `gruppe42.json`, `.github/` -> `@Nirnberger`
- Preview comment: a PR touching `tests/*.json` changes that test page's fingerprint, so it is shot incl. variant `ergebnis` (no `preview.json` change needed). The comment only appears on PRs labelled `manual-review` (editor does not set it; owner/box adds it)
- Owner checklist, in this order (once, before the client gets access):
  1. Settings -> Environments -> `production` -> Deployment branches: only `main`; same for `preview` if it holds secrets
  2. Settings -> Rules -> ruleset for `main`: PR required (0 approvals, "Require review from Code Owners"), status check pipeline job required, force-push blocked, deletion forbidden, bypass only owner. Then check that `dev automerge` for Dependabot still passes
  3. GitHub App "Gruppe 42 Editor" in org `seitenschwung`: callback `https://gruppe42.seitenschwung.com/api/editor/callback`, "Expire user authorization tokens" on, webhook off, permissions Contents RW, Pull requests RW, Metadata R; install only on `gruppe42`. Client ID/secret into Coolify as `EDITOR_GITHUB_CLIENT_ID`/`EDITOR_GITHUB_CLIENT_SECRET`
  4. Only then: Ingrid's GitHub account (2FA on) as collaborator "Write"
- Still open: the real end-to-end test against GitHub (login, PR, status) until the App exists; so far only mocked tests
