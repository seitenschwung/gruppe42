'use strict';
// POST /api/stripe/webhook: verifies the Stripe signature (HMAC-SHA256 over "<t>.<raw body>", 5 min
// tolerance, constant-time compare) before looking at the payload. Events are handled once per event id.
// No STRIPE_WEBHOOK_SECRET -> 503. Orders are not stored yet: onPaid only receives a minimal record.
const crypto = require('node:crypto');

const MAX_BODY = 64 * 1024;
const TOLERANCE_S = 300;
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

function verifySignature(raw, header, secret, nowMs) {
  if (typeof header !== 'string') return false;
  let t = null;
  const sigs = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') t = v; else if (k === 'v1') sigs.push(v);
  }
  if (!/^\d{1,12}$/.test(t || '') || sigs.length === 0) return false;
  if (Math.abs(nowMs / 1000 - Number(t)) > TOLERANCE_S) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.`).update(raw).digest();
  return sigs.some((s) => {
    if (!/^[0-9a-f]{64}$/i.test(s)) return false;
    return crypto.timingSafeEqual(expected, Buffer.from(s, 'hex'));
  });
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { if (size - c.length <= MAX_BODY) reject(Object.assign(new Error('size'), { status: 413 })); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function createWebhook({ env, onPaid = () => {}, log = () => {}, now = Date.now }) {
  const seen = new Set(); // event ids already handled (insertion ordered, bounded); a DB replaces this with the orders step

  async function handler(req, res, send) {
    const reply = (status, obj, extra) => send(res, status, { ...JSON_HEADERS, ...extra }, JSON.stringify(obj) + '\n');
    const secret = env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return reply(503, { error: 'webhook_disabled' });

    let raw;
    try { raw = await readRaw(req); } catch (e) { return reply(e.status || 400, { error: 'bad_request' }, e.status === 413 ? { Connection: 'close' } : undefined); }
    if (!verifySignature(raw, req.headers['stripe-signature'], secret, now())) return reply(400, { error: 'bad_signature' });

    let event;
    try { event = JSON.parse(raw.toString('utf8')); } catch { return reply(400, { error: 'bad_request' }); }
    if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') return reply(400, { error: 'bad_request' });
    if (seen.has(event.id)) return reply(200, { received: true, duplicate: true });

    if (event.type === 'checkout.session.completed') {
      const s = (event.data && event.data.object) || {};
      // Only paid sessions count (delayed payment methods complete the session as "unpaid" first).
      if (s.payment_status === 'paid') {
        try {
          await onPaid({
            event_id: event.id,
            session_id: s.id,
            product_id: s.metadata && s.metadata.product_id,
            menge: Number(s.metadata && s.metadata.menge) || 1,
            amount_total: s.amount_total,
            currency: s.currency,
          });
        } catch (e) {
          log(`webhook: handling ${event.id} failed`);
          return reply(500, { error: 'handler_failed' }); // Stripe retries; id is not marked as seen
        }
      }
    }
    seen.add(event.id);
    if (seen.size > 10_000) seen.delete(seen.values().next().value);
    return reply(200, { received: true });
  }

  return { routes: { '/api/stripe/webhook': { method: 'POST', handler } } };
}

module.exports = { createWebhook, verifySignature };
