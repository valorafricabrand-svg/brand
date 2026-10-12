const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;

function initializeAdmin() {
  const username = (process.env.ADMIN_USERNAME || '').trim();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!username || password.length < 16) {
    throw new Error('Set ADMIN_USERNAME and a unique ADMIN_PASSWORD of at least 16 characters before starting the API.');
  }
  const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
  const passwordHash = bcrypt.hashSync(password, 12);
  if (existing) {
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(passwordHash, existing.id);
    return;
  }
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(username, passwordHash);
}

function createLoginLimiter() {
  const attempts = new Map();
  const windowMs = 10 * 60 * 1000;
  return function loginLimiter(req, res, next) {
    const now = Date.now();
    const key = req.ip;
    let entry = attempts.get(key);
    if (!entry || now - entry.startedAt > windowMs) {
      entry = { startedAt: now, count: 0 };
      attempts.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > 8) {
      return res.status(429).json({ error: 'Too many login attempts. Try again in 10 minutes.' });
    }
    next();
  };
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Admin sign-in is required.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Admin access is required.' });
    req.admin = payload;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Your admin session has expired. Sign in again.' });
  }
}

function login(username, password) {
  const admin = db.prepare('SELECT id, username, password_hash FROM admins WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) return null;
  return jwt.sign(
    { sub: admin.id, username: admin.username, role: 'admin' },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
}

module.exports = { createLoginLimiter, initializeAdmin, login, requireAdmin };
