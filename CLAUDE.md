# Gruppe 42 website

Static website for Gruppe 42 (Personalentwicklung, Wien; Mag. Ingrid Nirnberger), prod
`gruppe42.seitenschwung.com`. Extracted from `Nirnberger/sample_sites` (template `beratung`);
nothing else from that repo is kept. UI language: German.

## Stack
Plain Node (no npm deps) static-site generator, output served by unprivileged nginx. Image build
needs `cwebp` (libwebp-tools) for WebP variants; AVIF is skipped when `avifenc` is missing.

## Layout
- `site/kunden/gruppe42/gruppe42.json`: all page content (texts, workshops, references, logo paths)
- `site/kunden/gruppe42/static/img/`: logo + partner logos, copied into the output as-is
- `site/vorlagen/beratung/`: template (`build.js`, `src/css`, `src/js`, `fonts`, `images`, `schema.json`)
- `site/lib/`: helpers used by `build.js` (`helfer.js`, `bilder.js`)
- `Dockerfile`: stage 1 builds `site/` to HTML, stage 2 is nginx; `nginx.conf` has `/healthz`, `/version.txt`

## Commands
- Build: `cd site && node vorlagen/beratung/build.js kunden/gruppe42/gruppe42.json && cp -r kunden/gruppe42/static/. vorlagen/beratung/dist/`
- Preview: `python3 -m http.server 8080 -d site/vorlagen/beratung/dist` (dist is git-ignored)
- Docker: `docker build --build-arg APP_VERSION=dev -t gruppe42 .`; CI does build + hardened run + axe/Lighthouse
- No tests/lint scripts; CI browser tests are the check

## Pitfalls
- `demo_modus: false` + `website_url` set on purpose: demo mode adds noindex and fails Lighthouse SEO (<90)
- Portrait `ingring_nirnberger.png` is missing (was in S3); the template shows a placeholder
- Logo usage rights, Impressum details and open client questions are unconfirmed
- Build writes to `vorlagen/beratung/dist` and `.bildcache`; both git-ignored (`dist/`; add `.bildcache/` if needed)
