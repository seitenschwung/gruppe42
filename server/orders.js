'use strict';
// Paid orders as an append-only JSON Lines file (DATA_DIR/orders.jsonl), no dependencies. One order per
// Stripe Checkout session; a repeated session id is not stored twice. No customer data is kept here:
// names, addresses and e-mails stay in Stripe. If the directory is not writable, add() throws, the
// webhook answers 500 and Stripe retries, so a paid order is never silently lost.
const fs = require('node:fs');
const path = require('node:path');

function createOrderStore({ dir }) {
  const file = path.join(dir, 'orders.jsonl');
  let known = null; // session ids already stored
  let chain = Promise.resolve(); // serialises writes

  function load() {
    if (known) return;
    known = new Set();
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try { known.add(JSON.parse(line).id); } catch { /* skip a torn last line */ }
    }
  }

  async function write(order) {
    load();
    if (known.has(order.id)) return { created: false };
    fs.mkdirSync(dir, { recursive: true });
    const fd = fs.openSync(file, 'a', 0o600);
    try {
      fs.writeSync(fd, JSON.stringify(order) + '\n');
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    known.add(order.id);
    return { created: true };
  }

  return {
    // o: { event_id, session_id, product_id, menge, amount_total, currency }
    add(o, now = () => new Date()) {
      if (!o || typeof o.session_id !== 'string' || !o.session_id) return Promise.reject(new Error('session_id missing'));
      const order = {
        id: o.session_id, event_id: o.event_id, product_id: o.product_id, menge: o.menge,
        amount_total: o.amount_total, currency: o.currency, paid_at: now().toISOString(),
      };
      const result = chain.then(() => write(order));
      chain = result.catch(() => {}); // a failed write must not block later ones
      return result;
    },
    list() {
      let text = '';
      try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      return text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    },
  };
}

module.exports = { createOrderStore };
