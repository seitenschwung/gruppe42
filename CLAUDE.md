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
- `/editor/`: client edits test texts live in the browser (passkey login, preview, "Speichern und veröffentlichen" = live immediately, no approval). Client guide `docs/anleitung-test-editor.md`; design `docs/superpowers/specs/2026-11-22-test-editor-live-design.md`. Only guard text fields, not test `name` / entry `titel`
- Parts: guard `site/lib/testwaechter.js` + `struktur.json` (regenerate command above); server `inhalte.js` (base + overlay + history, the enforcement point), `seiten.js` (re-renders test pages), `passkey.js`, `editor-sitzung.js` (invitation, login, session cookie `g42_sitzung`), `editor-api.js`/`editor-http.js` (routes, `X-G42-Editor: 1` + Origin checks, rate limit), `datei-sperre.js`; CLIs `editor-einladung.js`, `editor-export.js`; UI `src/js/editor*.js` (kern, api, passkey, vorschau, editor), page `editorSeite()` in build.js (noindex, not in menu/sitemap, `Disallow: /editor/`, CSP `connect-src 'self'`). `/api/editor/*` log lines carry no query
- Env (Coolify): `EDITOR_ORIGIN` (`https://gruppe42.seitenschwung.com`), `EDITOR_RP_ID` (`gruppe42.seitenschwung.com`), optional `EDITOR_DATA_DIR` (default `/data/editor`), `EDITOR_INHALT_DIR` (default `/app/inhalte`), `EDITOR_MELDUNG_URL` (notification after publishing). Without ORIGIN/RP_ID or content/volume: public site = image state, `/api/editor/*` -> 503
- Coolify setup: set the env above; data lives on the existing `orders-data` volume (`/data/editor` next to `orders.jsonl`: `passkeys`, `inhalte.json` overlay, `verlauf.jsonl` history). Include that volume in the Coolify backup. Image rebuilds keep the overlay; losing the volume = site falls back to image state
- Invite (first device or new device): `docker exec <container> node server/editor-einladung.js "Ingrid Nirnberger"` prints a single-use link (7 days, code in the URL fragment). `--liste` shows invitations/passkeys, `--entfernen <id>` removes one (e.g. lost device)
- Sync back to the repo (live texts are only an overlay until then): `docker exec <container> node server/editor-export.js > overlay.json` -> locally `node site/lib/einpflegen.js overlay.json` (guard check, writes `site/kunden/gruppe42/**`, prints sha256; exit != 0 writes nothing) -> commit/PR/deploy -> after the deploy `docker exec <container> node server/editor-export.js --leeren <sha256>` (only if the state is unchanged) -> restart the container (a save re-renders only that test page and the hub)
- Residual risks: stolen/unlocked device with passkey can change test texts (guard limits, history, undo, notification, `--entfernen`); volume loss (backup, export regularly); invitation link in browser history (single-use, 7 days); sessions are in memory (one container; restart = log in again)
- Before changing test texts in the repo: export → einpflegen → deploy → leeren (overlay entries shadow repo changes; einpflegen overwrites repo edits of those fields)
- Editor rate limit trusts the last `X-Forwarded-For` entry (correct behind Traefik/Coolify; never expose port 8080 directly)
- Known limits: meta description/og and JSON-LD WebPage.description of test pages not live; `name`/`titel` not live; Overlay paths whose field was removed in the repo are ignored (listed by `einpflegen.js`)
- Snapshots: `site/lib/testseite.test.js` compares build output of the fixture `site/lib/__fixtures__/` with `site/lib/__snapshots__/`. After an intended template change: `G42_SNAPSHOTS_SCHREIBEN=1 node --test site/lib/testseite.test.js`, review the diff. Fixture fingerprint: `node site/lib/struktur-erzeugen.js site/lib/__fixtures__/gruppe42.json`. Full suite: `node --test site/lib/*.test.js server/*.test.js site/vorlagen/beratung/src/js/*.test.js`
- `.github/CODEOWNERS`: `* @Nirnberger` (whole repo), so every PR into `main` needs the owner's approval; the editor no longer uses GitHub at all (no client account, no App)
- Repo security (code changes): Settings -> Environments -> `production` (and `preview` if it holds secrets) deployment branches only `main`; ruleset for `main` (PR required, "Require review from Code Owners", required status checks `pipeline / Lint, tests, build` and `pipeline / Docker image + browser tests`, force-push blocked, bypass only owner; with `* @Nirnberger` Dependabot PRs need an owner approval unless the automerge actor gets a bypass); Settings -> Actions -> General: default workflow token read-only, no "create and approve pull requests"; template (`seitenschwung/template`): deploy by image digest, restrict GHCR package access to Actions
