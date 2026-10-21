'use strict';
// Products and prices live on the server only (products.json). The client sends a product id and a
// quantity, never a price. Draft products ("entwurf": true, placeholder text and price) cannot be bought.
const fs = require('node:fs');
const path = require('node:path');

const TYPES = ['online', 'praesenz'];

function validate(data) {
  const fail = (m) => { throw new Error(`products.json: ${m}`); };
  if (!data || typeof data !== 'object') fail('object expected');
  if (!/^[a-z]{3}$/.test(data.waehrung)) fail('waehrung must be a lowercase ISO code, e.g. "eur"');
  if (!Array.isArray(data.produkte) || data.produkte.length === 0) fail('produkte must be a non-empty array');
  const ids = new Set();
  for (const p of data.produkte) {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(p.id)) fail(`bad id ${JSON.stringify(p.id)}`);
    if (ids.has(p.id)) fail(`duplicate id ${p.id}`);
    ids.add(p.id);
    if (!TYPES.includes(p.typ)) fail(`${p.id}: typ must be one of ${TYPES.join(', ')}`);
    if (typeof p.titel !== 'string' || !p.titel.trim()) fail(`${p.id}: titel missing`);
    if (typeof p.beschreibung !== 'string' || !p.beschreibung.trim()) fail(`${p.id}: beschreibung missing`);
    if (!Number.isInteger(p.max_menge) || p.max_menge < 1 || p.max_menge > 50) fail(`${p.id}: max_menge must be an integer 1..50`);
    if (typeof p.entwurf !== 'boolean') fail(`${p.id}: entwurf must be true or false`);
    // Draft: price may be null. Live: price must be a positive integer in cents.
    const priceOk = Number.isInteger(p.preis_cent) && p.preis_cent > 0;
    if (!p.entwurf && !priceOk) fail(`${p.id}: preis_cent must be a positive integer (cents) unless entwurf is true`);
    if (p.entwurf && p.preis_cent !== null && !priceOk) fail(`${p.id}: preis_cent must be null or a positive integer`);
  }
  return data;
}

function loadProducts(file = path.join(__dirname, 'products.json')) {
  const data = validate(JSON.parse(fs.readFileSync(file, 'utf8')));
  const byId = new Map(data.produkte.map((p) => [p.id, Object.freeze(p)]));
  return {
    waehrung: data.waehrung,
    all: () => [...byId.values()],
    get: (id) => byId.get(id),
    // Only live products with a price can go to checkout.
    buyable: (id) => { const p = byId.get(id); return p && !p.entwurf ? p : undefined; },
  };
}

module.exports = { loadProducts, validate };
