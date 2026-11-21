'use strict';
// Serves the built static site and (later) /api/*. No dependencies.
// Deploy contract: port 8080, GET /healthz, GET /version.txt (= APP_VERSION), non-root, read-only fs.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.pdf': 'application/pdf', '.webmanifest': 'application/manifest+json',
};

// Same headers as the former nginx.conf.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
};

const EDITOR_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
// Case-insensitive: the CSP must not depend on how the URL is spelled (file lookup itself stays case-sensitive).
const isEditorPath = (p) => /^\/editor(\/|$)/i.test(p);
const isEditorApi = (u) => /^\/api\/editor(\/|$)/i.test(u);

// Headers for every response of a path; /editor gets a strict CSP and no caching.
function headersFor(pathname) {
  if (!isEditorPath(pathname)) return SECURITY_HEADERS;
  return { ...SECURITY_HEADERS, 'Content-Security-Policy': EDITOR_CSP, 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store' };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const clfDate = (d) => `${pad(d.getUTCDate())}/${MONTHS[d.getUTCMonth()]}/${d.getUTCFullYear()}:${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;

// Path-specific headers (res.pathHeaders) win over the per-response ones, so /editor stays no-store.
function allHeaders(res, headers) {
  const ph = res.pathHeaders;
  return ph && ph !== SECURITY_HEADERS ? { ...SECURITY_HEADERS, ...headers, ...ph } : { ...SECURITY_HEADERS, ...headers };
}

function send(res, status, headers, body) {
  res.writeHead(status, allHeaders(res, headers));
  res.end(body);
}

// api: optional { routes: { '/api/x': { method, handler(req, res, send) } } } (see checkout.js)
// seiten: optional { seite(pathname) -> {html, etag} | null } (see seiten.js): Live-Fassung statt Datei.
function createServer({ root, version, log, api, seiten }) {
  const rootDir = path.resolve(root);

  return http.createServer((req, res) => {
    // Decode and normalize once: headers, routing, log redaction and file lookup all see the same path
    // (no "//editor/" or "/x/..%2feditor/" bypass).
    let pathname = null;
    try {
      const decoded = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      pathname = path.posix.normalize(decoded);
      if (!pathname.startsWith('/')) pathname = '/' + pathname;
    } catch { /* bad percent escape: answered with 400 below */ }
    if (log && req.url !== '/healthz') {
      // Combined log format, the one CrowdSec's http/nginx parsers expect.
      // Editor URLs (invitation codes etc.) must never reach the log: no query for /api/editor, nor when the path can't be parsed.
      const logUrl = pathname === null || isEditorApi(pathname) ? req.url.split('?')[0] : req.url;
      res.on('finish', () => {
        const h = req.headers;
        const ip = (h['x-forwarded-for'] || req.socket.remoteAddress || '-').split(',')[0].trim();
        log(`${ip} - - [${clfDate(new Date())}] "${req.method} ${logUrl}" ${res.statusCode} ${res.getHeader('content-length') || '-'} "${h.referer || '-'}" "${h['user-agent'] || '-'}"`);
      });
    }
    if (pathname === null) {
      return send(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Bad Request\n');
    }
    res.pathHeaders = headersFor(pathname);
    if (api && api.routes[pathname]) {
      const route = api.routes[pathname];
      if (req.method !== route.method) {
        return send(res, 405, { Allow: route.method, 'Content-Type': 'application/json; charset=utf-8' }, '{"error":"method_not_allowed"}\n');
      }
      return route.handler(req, res, send);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }, 'Method Not Allowed\n');
    }
    const head = req.method === 'HEAD';

    if (pathname === '/healthz') {
      return send(res, 200, { 'Content-Type': 'text/plain; charset=utf-8' }, head ? undefined : 'ok\n');
    }
    if (pathname === '/version.txt') {
      return send(res, 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, head ? undefined : version);
    }
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return send(res, 404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, '{"error":"not_found"}\n');
    }

    const live = seiten && seiten.seite(pathname);
    if (live) return serveHtml(req, res, live, head);

    if (pathname.includes('\0')) return send(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Bad Request\n');
    let file = path.join(rootDir, pathname);
    if (file !== rootDir && !file.startsWith(rootDir + path.sep)) {
      return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found\n');
    }

    fs.stat(file, (err, st) => {
      if (!err && st.isDirectory()) {
        if (!pathname.endsWith('/')) {
          return send(res, 301, { Location: pathname + '/' + new URL(req.url, 'http://localhost').search }, undefined);
        }
        file = path.join(file, 'index.html');
        return fs.stat(file, (err2, st2) => (err2 || !st2.isFile() ? notFound(res) : serve(req, res, file, st2, head)));
      }
      if (err || !st.isFile()) return notFound(res);
      serve(req, res, file, st, head);
    });
  });
}

function notFound(res) {
  send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found\n');
}

function serveHtml(req, res, { html, etag }, head) {
  const headers = { 'Content-Type': MIME['.html'], ETag: etag, 'Cache-Control': 'no-cache' };
  if (req.headers['if-none-match'] === etag) return send(res, 304, headers, undefined);
  const body = Buffer.from(html, 'utf8');
  headers['Content-Length'] = body.length;
  res.writeHead(200, allHeaders(res, headers));
  res.end(head ? undefined : body);
}

function serve(req, res, file, st, head) {
  const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Last-Modified': st.mtime.toUTCString(),
    ETag: etag,
  };
  // HTML immer revalidieren (ETag/304), damit Live-Texte sofort sichtbar sind; andere Dateien unverändert.
  if (path.extname(file).toLowerCase() === '.html') headers['Cache-Control'] = 'no-cache';
  if (req.headers['if-none-match'] === etag) return send(res, 304, headers, undefined);
  headers['Content-Length'] = st.size;
  res.writeHead(200, allHeaders(res, headers));
  if (head) return res.end();
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

module.exports = { createServer, headersFor };

if (require.main === module) {
  const orders = require('./orders').createOrderStore({ dir: process.env.DATA_DIR || '/data' });
  // Live-Inhalte: scheitert das Laden der Basis, bleibt die öffentliche Seite Image-Stand und die Editor-API antwortet 503.
  const { pfadeAusEnv, createEditorApi } = require('./editor-api');
  const root = process.env.STATIC_ROOT || path.join(__dirname, '..', 'html');
  let inhalte = null;
  let seiten = null;
  try {
    inhalte = require('./inhalte').createInhalte(pfadeAusEnv(process.env));
    seiten = require('./seiten').createSeiten({ root, inhalte, Testseite: require('../site/lib/testseite.js'), log: console.log });
  } catch (e) {
    console.log('editor: Inhalte nicht geladen, Editor aus');
    inhalte = null;
    seiten = null;
  }
  // Editor login (invitation, passkey, session) and the editor API behind it.
  const sitzung = require('./editor-sitzung').createSitzung({ env: process.env });
  const editorApi = createEditorApi({ env: process.env, inhalte, seiten, sitzung, fetch, log: console.log });
  const server = createServer({
    root,
    version: process.env.APP_VERSION || 'dev',
    log: console.log,
    seiten,
    api: {
      routes: {
        ...require('./checkout').createApi({ products: require('./products').loadProducts(), env: process.env, fetch }).routes,
        ...sitzung.routes,
        ...editorApi.routes,
        ...require('./webhook').createWebhook({
          env: process.env,
          log: console.log,
          // Throws if /data is not writable: the webhook then answers 500 and Stripe retries.
          onPaid: async (o) => {
            const { created } = await orders.add(o);
            if (created) console.log(`order stored: session=${o.session_id} product=${o.product_id} menge=${o.menge}`);
          },
        }).routes,
      },
    },
  });
  server.keepAliveTimeout = 65_000;
  server.listen(8080, '0.0.0.0', () => console.log('listening on :8080'));
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
}
