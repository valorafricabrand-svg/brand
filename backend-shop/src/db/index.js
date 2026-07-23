const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'shop.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    price_cents INTEGER NOT NULL,      -- base price in cents (e.g. KES 4500 -> 450000)
    currency TEXT NOT NULL DEFAULT 'KES',
    image_url TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1, -- 1 = visible in shop, 0 = hidden
    stock INTEGER DEFAULT NULL,        -- NULL = unlimited
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,                 -- e.g. "Spring Sale"
    type TEXT NOT NULL CHECK(type IN ('percent','fixed')), -- percent off or fixed amount off
    value REAL NOT NULL,                -- 10 (=10%) or fixed cents amount
    applies_to TEXT NOT NULL DEFAULT 'all', -- 'all' or a specific product id
    active INTEGER NOT NULL DEFAULT 1,
    starts_at TEXT DEFAULT NULL,
    ends_at TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  );
`);

module.exports = db;
