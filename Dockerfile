# Stages: build the static site from site/ (template + content), unit-test the server, serve with a small Node server (server/, no deps).
# Contract (CLAUDE.md): port 8080, GET /healthz, GET /version.txt (= APP_VERSION), non-root USER.

# --- 1) Build: node + cwebp (WebP image variants) ---
FROM node:20-alpine AS build
RUN apk add --no-cache libwebp-tools
WORKDIR /app
COPY site/ site/
COPY server/products.json server/products.json
RUN node site/vorlagen/beratung/build.js site/kunden/gruppe42/gruppe42.json \
 && cp -r site/vorlagen/beratung/dist /out \
 && cp -r site/kunden/gruppe42/static/. /out/

# --- 2) Test: server unit tests (pipeline runs this stage; it is not in the final image) ---
FROM node:20-alpine AS test
WORKDIR /app
COPY server/ server/
COPY site/ site/
RUN node --test site/lib/testwaechter.test.js site/lib/struktur.test.js site/lib/testseite.test.js server/server.test.js server/products.test.js server/checkout.test.js server/editor-auth.test.js server/webhook.test.js server/orders.test.js server/inhalte.test.js site/vorlagen/beratung/src/js/antreiber.test.js site/vorlagen/beratung/src/js/editor-kern.test.js site/vorlagen/beratung/src/js/editor-github.test.js

# --- 3) Serve: Node server for static files and later /api/* ---
FROM node:20-alpine
ARG APP_VERSION=dev
ENV NODE_ENV=production APP_VERSION=$APP_VERSION STATIC_ROOT=/app/html
WORKDIR /app
COPY server/server.js server/products.js server/products.json server/checkout.js server/editor-auth.js server/webhook.js server/orders.js server/inhalte.js server/
COPY site/lib/testwaechter.js site/lib/
COPY site/kunden/gruppe42/gruppe42.json /app/inhalte/gruppe42.json
COPY site/kunden/gruppe42/tests/ /app/inhalte/tests/
COPY --from=build /out/ /app/html/
# /data is the volume for orders.jsonl (compose mounts it; the root fs is read-only)
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node", "server/server.js"]
