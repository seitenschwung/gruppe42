'use strict';
// POST /api/checkout { id, menge } -> { url } (Stripe Checkout page). The client never sends a price:
// name and amount come from products.json. No STRIPE_SECRET_KEY -> 503, so the image runs without secrets.
const MAX_BODY = 2048;
const RATE_LIMIT = 10; // requests per IP per minute

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return reject(Object.assign(new Error('type'), { status: 415 }));
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { if (size - c.length <= MAX_BODY) reject(Object.assign(new Error('size'), { status: 413 })); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Object.assign(new Error('json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function createApi({ products, env, fetch: doFetch, now = Date.now }) {
  const hits = new Map(); // ip -> [timestamps]
  const limited = (ip) => {
    const t = now();
    const list = (hits.get(ip) || []).filter((x) => t - x < 60_000);
    list.push(t);
    hits.set(ip, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (t - v[v.length - 1] > 60_000) hits.delete(k);
    return list.length > RATE_LIMIT;
  };

  async function checkout(req, res, send) {
    const reply = (status, obj) => send(res, status, status === 413 ? { ...JSON_HEADERS, Connection: 'close' } : JSON_HEADERS, JSON.stringify(obj) + '\n');
    const key = env.STRIPE_SECRET_KEY;
    if (!key || !key.startsWith('sk_')) return reply(503, { error: 'shop_disabled' });
    // Behind the reverse proxy the last X-Forwarded-For entry is the one the proxy added.
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '-').split(',').pop().trim();
    if (limited(ip)) return reply(429, { error: 'rate_limited' });

    let body;
    try { body = await readJson(req); } catch (e) { return reply(e.status || 400, { error: 'bad_request' }); }
    if (!body || typeof body !== 'object') return reply(400, { error: 'bad_request' });
    const menge = body.menge === undefined ? 1 : body.menge;
    const p = typeof body.id === 'string' ? products.buyable(body.id) : undefined;
    if (!p) return reply(404, { error: 'unknown_product' });
    if (!Number.isInteger(menge) || menge < 1 || menge > p.max_menge) return reply(400, { error: 'bad_quantity' });

    const base = (env.PUBLIC_URL || 'https://gruppe42.seitenschwung.com').replace(/\/+$/, '');
    const form = new URLSearchParams({
      mode: 'payment',
      success_url: `${base}/shop.html?status=erfolg`,
      cancel_url: `${base}/shop.html?status=abbruch`,
      'line_items[0][quantity]': String(menge),
      'line_items[0][price_data][currency]': products.waehrung,
      'line_items[0][price_data][unit_amount]': String(p.preis_cent),
      'line_items[0][price_data][product_data][name]': p.titel,
      'metadata[product_id]': p.id,
      'metadata[menge]': String(menge),
    });
    let r;
    try {
      r = await doFetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
        signal: AbortSignal.timeout(10_000),
      });
    } catch { return reply(502, { error: 'payment_unavailable' }); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok || typeof data.url !== 'string') return reply(502, { error: 'payment_unavailable' });
    return reply(200, { url: data.url });
  }

  return { routes: { '/api/checkout': { method: 'POST', handler: checkout } } };
}

module.exports = { createApi };
