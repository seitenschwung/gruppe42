'use strict';
// HTTP-Hilfen, die editor-sitzung.js und editor-api.js gemeinsam nutzen: JSON-Header, Body lesen,
// Client-IP und Rate-Limit pro IP.
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

// Hinter dem Reverse-Proxy ist der letzte X-Forwarded-For-Eintrag der vom Proxy ergänzte.
function ipVon(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '-').split(',').pop().trim();
}

// JSON-Objekt aus dem Body; Fehler tragen .status (415 Typ, 413 Größe, 400 JSON).
function leseJson(req, max) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return reject(Object.assign(new Error('type'), { status: 415 }));
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { if (size - c.length <= max) reject(Object.assign(new Error('size'), { status: 413 })); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (size > max) return;
      if (size === 0) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      } catch { reject(Object.assign(new Error('json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

// limited(ip) zählt einen Zugriff und sagt, ob das Limit pro Minute überschritten ist.
function createLimiter(limit, now) {
  const hits = new Map(); // ip -> [timestamps]
  return function limited(ip) {
    const t = now();
    const list = (hits.get(ip) || []).filter((x) => t - x < 60_000);
    list.push(t);
    hits.set(ip, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (t - v[v.length - 1] > 60_000) hits.delete(k);
    return list.length > limit;
  };
}

module.exports = { JSON_HEADERS, ipVon, leseJson, createLimiter };
