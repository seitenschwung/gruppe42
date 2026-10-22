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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const clfDate = (d) => `${pad(d.getUTCDate())}/${MONTHS[d.getUTCMonth()]}/${d.getUTCFullYear()}:${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;

function send(res, status, headers, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

// api: optional { routes: { '/api/x': { method, handler(req, res, send) } } } (see checkout.js)
function createServer({ root, version, log, api }) {
  const rootDir = path.resolve(root);

  return http.createServer((req, res) => {
    if (log && req.url !== '/healthz') {
      // Combined log format, the one CrowdSec's http/nginx parsers expect.
      res.on('finish', () => {
        const h = req.headers;
        const ip = (h['x-forwarded-for'] || req.socket.remoteAddress || '-').split(',')[0].trim();
        log(`${ip} - - [${clfDate(new Date())}] "${req.method} ${req.url}" ${res.statusCode} ${res.getHeader('content-length') || '-'} "${h.referer || '-'}" "${h['user-agent'] || '-'}"`);
      });
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return send(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Bad Request\n');
    }
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

function serve(req, res, file, st, head) {
  const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Last-Modified': st.mtime.toUTCString(),
    ETag: etag,
  };
  if (req.headers['if-none-match'] === etag) return send(res, 304, headers, undefined);
  headers['Content-Length'] = st.size;
  res.writeHead(200, { ...SECURITY_HEADERS, ...headers });
  if (head) return res.end();
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

module.exports = { createServer };

if (require.main === module) {
  const server = createServer({
    root: process.env.STATIC_ROOT || path.join(__dirname, '..', 'html'),
    version: process.env.APP_VERSION || 'dev',
    log: console.log,
    api: {
      routes: {
        ...require('./checkout').createApi({ products: require('./products').loadProducts(), env: process.env, fetch }).routes,
        ...require('./webhook').createWebhook({
          env: process.env,
          log: console.log,
          // Orders are stored in a later step; for now only a PII-free line goes to the log.
          onPaid: (o) => console.log(`order paid: session=${o.session_id} product=${o.product_id} menge=${o.menge}`),
        }).routes,
      },
    },
  });
  server.keepAliveTimeout = 65_000;
  server.listen(8080, '0.0.0.0', () => console.log('listening on :8080'));
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
}
