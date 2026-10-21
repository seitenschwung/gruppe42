# Stages: build the static site from site/ (template + content), unit-test the server, serve with a small Node server (server/, no deps).
# Contract (CLAUDE.md): port 8080, GET /healthz, GET /version.txt (= APP_VERSION), non-root USER.

# --- 1) Build: node + cwebp (WebP image variants) ---
FROM node:20-alpine AS build
RUN apk add --no-cache libwebp-tools
WORKDIR /app
COPY site/ site/
RUN node site/vorlagen/beratung/build.js site/kunden/gruppe42/gruppe42.json \
 && cp -r site/vorlagen/beratung/dist /out \
 && cp -r site/kunden/gruppe42/static/. /out/

# --- 2) Test: server unit tests (pipeline runs this stage; it is not in the final image) ---
FROM node:20-alpine AS test
WORKDIR /app
COPY server/ server/
RUN node --test server/server.test.js

# --- 3) Serve: Node server for static files and later /api/* ---
FROM node:20-alpine
ARG APP_VERSION=dev
ENV NODE_ENV=production APP_VERSION=$APP_VERSION STATIC_ROOT=/app/html
WORKDIR /app
COPY server/server.js server/server.js
COPY --from=build /out/ /app/html/
USER node
EXPOSE 8080
CMD ["node", "server/server.js"]
