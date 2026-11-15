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
- Result preview without taking a test: append `?vorschau` (random answers) or `?vorschau=3` (all answers 3) to any test page URL
- Tests quality: `tests.methodik` in gruppe42.json -> `methodik.html` (how tests are built, limits; table generated from test JSONs). Engine: ranking shows no leader when spread < `result.minSpread` (default 0.1 of max); hint if >=90% identical answers. Teamklima 20 items, Employer-Branding 16 (4 per area, some `reverse`). Still NOT scientifically validated
