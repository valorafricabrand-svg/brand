const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

// Basic rate limiting for login attempts (in-memory, per IP)
const attempts = new Map();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes

function isRateLimited(ip) {
  const now = Date.now();
  const record = attempts.get(ip) || { count: 0, first: now };
  if (now - record.first > WINDOW_MS) {
    attempts.set(ip, { count: 1, first: now });
    return false;
  }
  record.count += 1;
  attempts.set(ip, record);
  return record.count > MAX_ATTEMPTS;
}

router.post('/login', (req, res) => {
  const ip = req.ip;
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const token = jwt.sign(
    { sub: admin.id, username: admin.username, role: 'admin' },
    JWT_SECRET,
    { expiresIn: '12h' }
  );

  res.json({ token, expiresIn: '12h' });
});

module.exports = router;
