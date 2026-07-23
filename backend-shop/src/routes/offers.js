const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { getActiveOffers } = require('../utils/pricing');

const router = express.Router();

// ---- PUBLIC: currently active offers (e.g. to show a banner: "10% off everything") ----
router.get('/active', (req, res) => {
  res.json({ offers: getActiveOffers() });
});

// ---- ADMIN: list all offers ----
router.get('/', requireAdmin, (req, res) => {
  const offers = db.prepare('SELECT * FROM offers ORDER BY created_at DESC').all();
  res.json({ offers });
});

// ---- ADMIN: create offer ----
router.post('/', requireAdmin, (req, res) => {
  const {
    name,
    type,
    value,
    applies_to = 'all',
    active = 1,
    starts_at = null,
    ends_at = null
  } = req.body || {};

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required.' });
  }
  if (!['percent', 'fixed'].includes(type)) {
    return res.status(400).json({ error: "type must be 'percent' or 'fixed'." });
  }
  if (!Number.isFinite(value) || value <= 0) {
    return res.status(400).json({ error: 'value must be a positive number.' });
  }
  if (type === 'percent' && value > 100) {
    return res.status(400).json({ error: 'percent value cannot exceed 100.' });
  }
  if (applies_to !== 'all') {
    const product = db.prepare('SELECT id FROM products WHERE id = ?').get(applies_to);
    if (!product) return res.status(400).json({ error: 'applies_to must be "all" or a valid product id.' });
  }

  const info = db
    .prepare(`
      INSERT INTO offers (name, type, value, applies_to, active, starts_at, ends_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(name, type, value, String(applies_to), active ? 1 : 0, starts_at, ends_at);

  const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(offer);
});

// ---- ADMIN: update offer ----
router.put('/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM offers WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Offer not found.' });

  const {
    name = existing.name,
    type = existing.type,
    value = existing.value,
    applies_to = existing.applies_to,
    active = existing.active,
    starts_at = existing.starts_at,
    ends_at = existing.ends_at
  } = req.body || {};

  if (!['percent', 'fixed'].includes(type)) {
    return res.status(400).json({ error: "type must be 'percent' or 'fixed'." });
  }
  if (!Number.isFinite(value) || value <= 0) {
    return res.status(400).json({ error: 'value must be a positive number.' });
  }

  db.prepare(`
    UPDATE offers
    SET name = ?, type = ?, value = ?, applies_to = ?, active = ?, starts_at = ?, ends_at = ?
    WHERE id = ?
  `).run(name, type, value, String(applies_to), active ? 1 : 0, starts_at, ends_at, req.params.id);

  const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(req.params.id);
  res.json(offer);
});

// ---- ADMIN: delete offer ----
router.delete('/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM offers WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Offer not found.' });

  db.prepare('DELETE FROM offers WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

module.exports = router;
