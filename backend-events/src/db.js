const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const databasePath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'events.db');
if (databasePath !== ':memory:') {
  fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
}

const database = new DatabaseSync(databasePath);
database.exec('PRAGMA journal_mode = WAL');
database.exec('PRAGMA foreign_keys = ON');

const db = {
  exec(statement) {
    return database.exec(statement);
  },
  prepare(statement) {
    return database.prepare(statement);
  },
  transaction(callback) {
    return (...args) => {
      database.exec('BEGIN IMMEDIATE');
      try {
        const result = callback(...args);
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    };
  },
  close() {
    database.close();
  }
};

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    format TEXT NOT NULL CHECK (format IN ('Physical','Virtual','Hybrid')),
    timezone TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    venue_name TEXT NOT NULL DEFAULT '',
    meeting_url TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL,
    capacity INTEGER,
    regular_price INTEGER NOT NULL CHECK (regular_price >= 0),
    early_bird_price INTEGER,
    early_bird_ends TEXT,
    vip_price INTEGER,
    currency TEXT NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
    tags_json TEXT NOT NULL DEFAULT '[]',
    poster_url TEXT NOT NULL DEFAULT '',
    organizer_name TEXT NOT NULL,
    organizer_email TEXT NOT NULL,
    organizer_phone TEXT NOT NULL,
    organizer_account_id TEXT REFERENCES accounts(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    review_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS events_status_start ON events(status, starts_at);

  CREATE TABLE IF NOT EXISTS ad_packages (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    duration_days INTEGER NOT NULL CHECK (duration_days BETWEEN 1 AND 90),
    price_kes INTEGER NOT NULL CHECK (price_kes > 0),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ad_bookings (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id),
    package_id TEXT NOT NULL REFERENCES ad_packages(id),
    status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','active','expired','cancelled')),
    starts_at TEXT,
    ends_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS ad_bookings_schedule ON ad_bookings(status, starts_at, ends_at);

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    access_token_hash TEXT NOT NULL,
    order_type TEXT NOT NULL CHECK (order_type IN ('ticket','ad')),
    event_id TEXT REFERENCES events(id),
    ad_booking_id TEXT REFERENCES ad_bookings(id),
    account_id TEXT REFERENCES accounts(id),
    buyer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    ticket_type TEXT NOT NULL DEFAULT '',
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 10),
    amount_kes INTEGER NOT NULL CHECK (amount_kes >= 0),
    payment_method TEXT NOT NULL DEFAULT 'mpesa',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','confirmed','failed','review')),
    checkout_request_id TEXT UNIQUE,
    merchant_request_id TEXT,
    stripe_session_id TEXT,
    stripe_session_expires_at TEXT,
    mpesa_receipt TEXT,
    result_description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    paid_at TEXT
  );

  CREATE INDEX IF NOT EXISTS orders_capacity ON orders(event_id, status, created_at);

  CREATE TABLE IF NOT EXISTS wallets (
    id TEXT PRIMARY KEY,
    phone TEXT NOT NULL UNIQUE,
    account_type TEXT NOT NULL CHECK (account_type IN ('buyer','organizer','both')),
    account_id TEXT UNIQUE REFERENCES accounts(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS wallet_otps (
    phone TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS wallet_transactions (
    id TEXT PRIMARY KEY,
    wallet_id TEXT NOT NULL REFERENCES wallets(id),
    order_id TEXT UNIQUE REFERENCES orders(id),
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('deposit','ticket_purchase','ad_purchase')),
    amount_kes INTEGER NOT NULL CHECK (amount_kes != 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed','review')),
    checkout_request_id TEXT UNIQUE,
    merchant_request_id TEXT,
    receipt TEXT UNIQUE,
    description TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS wallet_transactions_history ON wallet_transactions(wallet_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL DEFAULT '',
    password_hash TEXT,
    google_sub TEXT UNIQUE,
    email_verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS account_email_codes (
    email TEXT NOT NULL COLLATE NOCASE,
    purpose TEXT NOT NULL CHECK (purpose IN ('verify','reset')),
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (email,purpose)
  );

  CREATE TABLE IF NOT EXISTS account_sessions (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS account_sessions_expiry ON account_sessions(expires_at);

  CREATE TABLE IF NOT EXISTS tickets (
    code TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id),
    event_id TEXT NOT NULL REFERENCES events(id),
    ticket_type TEXT NOT NULL,
    checked_in_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS merchandise_products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price_kes INTEGER NOT NULL CHECK (price_kes > 0),
    image_url TEXT NOT NULL DEFAULT '',
    stock INTEGER CHECK (stock IS NULL OR stock >= 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS merchandise_orders (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    wallet_id TEXT NOT NULL REFERENCES wallets(id),
    client_request_id TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    delivery_address TEXT NOT NULL,
    amount_kes INTEGER NOT NULL CHECK (amount_kes > 0),
    status TEXT NOT NULL DEFAULT 'paid' CHECK (status = 'paid'),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (account_id, client_request_id)
  );

  CREATE INDEX IF NOT EXISTS merchandise_orders_created ON merchandise_orders(created_at DESC);

  CREATE TABLE IF NOT EXISTS merchandise_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL REFERENCES merchandise_orders(id),
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10),
    unit_price_kes INTEGER NOT NULL CHECK (unit_price_kes > 0)
  );
`);

const eventColumns = db.prepare('PRAGMA table_info(events)').all();
if (!eventColumns.some((column) => column.name === 'organizer_account_id')) {
  db.exec('ALTER TABLE events ADD COLUMN organizer_account_id TEXT REFERENCES accounts(id)');
}
db.exec('CREATE INDEX IF NOT EXISTS events_organizer ON events(organizer_account_id,created_at DESC)');

const walletColumns = db.prepare('PRAGMA table_info(wallets)').all();
if (!walletColumns.some((column) => column.name === 'account_id')) {
  db.exec('ALTER TABLE wallets ADD COLUMN account_id TEXT REFERENCES accounts(id)');
}
const orderColumns = db.prepare('PRAGMA table_info(orders)').all();
if (!orderColumns.some((column) => column.name === 'account_id')) {
  db.exec('ALTER TABLE orders ADD COLUMN account_id TEXT REFERENCES accounts(id)');
}
if (!orderColumns.some((column) => column.name === 'payment_method')) {
  db.exec("ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'mpesa'");
}
if (!orderColumns.some((column) => column.name === 'stripe_session_id')) {
  db.exec('ALTER TABLE orders ADD COLUMN stripe_session_id TEXT');
}
if (!orderColumns.some((column) => column.name === 'stripe_session_expires_at')) {
  db.exec('ALTER TABLE orders ADD COLUMN stripe_session_expires_at TEXT');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS wallets_account ON wallets(account_id)');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS orders_stripe_session ON orders(stripe_session_id) WHERE stripe_session_id IS NOT NULL');
db.exec('DROP TABLE IF EXISTS wallet_sessions');

const walletTransactionSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='wallet_transactions'").get().sql;
if (!walletTransactionSchema.includes("'merchandise_purchase'")) {
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE wallet_transactions_new (
        id TEXT PRIMARY KEY,
        wallet_id TEXT NOT NULL REFERENCES wallets(id),
        order_id TEXT UNIQUE REFERENCES orders(id),
        merchandise_order_id TEXT UNIQUE REFERENCES merchandise_orders(id),
        transaction_type TEXT NOT NULL CHECK (transaction_type IN ('deposit','ticket_purchase','ad_purchase','merchandise_purchase')),
        amount_kes INTEGER NOT NULL CHECK (amount_kes != 0),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed','review')),
        checkout_request_id TEXT UNIQUE,
        merchant_request_id TEXT,
        receipt TEXT UNIQUE,
        description TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );
      INSERT INTO wallet_transactions_new (
        id,wallet_id,order_id,transaction_type,amount_kes,status,checkout_request_id,
        merchant_request_id,receipt,description,created_at,completed_at
      )
      SELECT id,wallet_id,order_id,transaction_type,amount_kes,status,checkout_request_id,
        merchant_request_id,receipt,description,created_at,completed_at
      FROM wallet_transactions;
      DROP TABLE wallet_transactions;
      ALTER TABLE wallet_transactions_new RENAME TO wallet_transactions;
      CREATE INDEX wallet_transactions_history ON wallet_transactions(wallet_id,created_at DESC);
      COMMIT;
    `);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

const starterProducts = [
  ['valor-tote', 'Valor Africa Tote Bag', 'Durable canvas tote with the Valor Africa emblem, hand-printed.', 4500, '/images/one.jpg'],
  ['community-print-tee', 'Community Print Tee', 'Soft cotton tee celebrating African entrepreneurship.', 2800, '/images/IMG_0729.jpg'],
  ['founders-notebook', 'Founder’s Notebook', 'A5 hardcover notebook for brand-building notes and sketches.', 6200, '/images/IMG_1212.jpg']
];
const insertStarterProduct = db.prepare(`
  INSERT OR IGNORE INTO merchandise_products (id,name,description,price_kes,image_url)
  VALUES (?,?,?,?,?)
`);
for (const product of starterProducts) insertStarterProduct.run(...product);

module.exports = db;
