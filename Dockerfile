# Two stages: build the static site from site/ (template + content), serve it with unprivileged nginx.
# Contract (CLAUDE.md): port 8080, GET /healthz, GET /version.txt (= APP_VERSION), non-root USER.

# --- 1) Build: node + cwebp (WebP image variants) ---
FROM node:20-alpine AS build
RUN apk add --no-cache libwebp-tools
WORKDIR /app
COPY site/ site/
RUN node site/vorlagen/beratung/build.js site/kunden/gruppe42/gruppe42.json \
 && cp -r site/vorlagen/beratung/dist /out \
 && cp -r site/kunden/gruppe42/static/. /out/

# --- 2) Serve ---
FROM nginxinc/nginx-unprivileged:1.29-alpine
ARG APP_VERSION=dev
USER root
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /out/ /usr/share/nginx/html/
RUN printf '%s' "$APP_VERSION" > /usr/share/nginx/html/version.txt
USER 101
