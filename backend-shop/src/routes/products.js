const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { getActiveOffers, applyOffers } = require('../utils/pricing');

const router = express.Router();

// ---- PUBLIC: paginated product listing (only active products), offers applied ----
router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 6));
  const offset = (page - 1) * limit;

  const total = db.prepare('SELECT COUNT(*) as c FROM products WHERE active = 1').get().c;
  const rows = db
    .prepare('SELECT * FROM products WHERE active = 1 ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset);

  const activeOffers = getActiveOffers();
  const products = rows.map((p) => applyOffers(p, activeOffers));

  res.json({
    products,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    }
  });
});

// ---- PUBLIC: single product ----
router.get('/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  const activeOffers = getActiveOffers();
  res.json(applyOffers(product, activeOffers));
});

// ---- ADMIN: list all products, including hidden/inactive ----
router.get('/admin/all', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
  res.json({ products: rows });
});

// ---- ADMIN: create product ----
router.post('/', requireAdmin, (req, res) => {
  const { name, description = '', price_cents, currency = 'KES', image_url = '', active = 1, stock = null } = req.body || {};

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required.' });
  }
  if (!Number.isFinite(price_cents) || price_cents < 0) {
    return res.status(400).json({ error: 'price_cents must be a non-negative number (price in cents).' });
  }

  const info = db
    .prepare(`
      INSERT INTO products (name, description, price_cents, currency, image_url, active, stock, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `)
    .run(name, description, price_cents, currency, image_url, active ? 1 : 0, stock);

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(product);
});

// ---- ADMIN: update product ----
router.put('/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found.' });

  const {
    name = existing.name,
    description = existing.description,
    price_cents = existing.price_cents,
    currency = existing.currency,
    image_url = existing.image_url,
    active = existing.active,
    stock = existing.stock
  } = req.body || {};

  if (!Number.isFinite(price_cents) || price_cents < 0) {
    return res.status(400).json({ error: 'price_cents must be a non-negative number.' });
  }

  db.prepare(`
    UPDATE products
    SET name = ?, description = ?, price_cents = ?, currency = ?, image_url = ?, active = ?, stock = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(name, description, price_cents, currency, image_url, active ? 1 : 0, stock, req.params.id);

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  res.json(product);
});

// ---- ADMIN: delete product ----
router.delete('/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found.' });

  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

module.exports = router;
