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
- Portrait `ingring_nirnberger.png` is missing (was in S3); the template shows a placeholder
- Logo usage rights, Impressum details and open client questions are unconfirmed
- Build writes to `vorlagen/beratung/dist` and `.bildcache`; both git-ignored
- Deploy: only the CI job `Deploy (Coolify)` on push to `main` (needs repo var `COOLIFY_APP_UUID`, which sets `IMAGE`).
  Coolify "Auto Deploy" must stay off, else compose fails with "required variable IMAGE is missing"
- Shop plan: `docs/shop-architektur.md`
- Shop data: `server/products.json` (only source of prices, cents; `entwurf:true` = placeholder, not buyable), `server/products.js` validates; `.env.example` lists Stripe vars
- Shop images in `site/kunden/gruppe42/static/img/shop/` (Unsplash, credit in products.json); `images.unsplash.com` needs `dev allow`
- Shop page `shop.html`: built by `shopSeite()` in build.js from `shop` in gruppe42.json (reads `server/products.json`). Visible (menu, sitemap, indexable) since `shop.sichtbar: true`; false = hidden (noindex, no menu, not in sitemap); buy button disabled until checkout exists
- Checkout: `server/checkout.js` (POST /api/checkout {id,menge}; 503 without STRIPE_SECRET_KEY; rate limit; tests mock Stripe). Webhook: `server/webhook.js` (POST /api/stripe/webhook, signature verified, idempotent by event id in memory). Orders: `server/orders.js` appends to `$DATA_DIR/orders.jsonl` (default `/data`, compose volume `orders-data`; no customer data, one line per Checkout session). Read: `docker exec <container> cat /data/orders.jsonl`. Unwritable /data -> webhook 500 -> Stripe retries
