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
    ticket_email_status TEXT NOT NULL DEFAULT 'not_applicable',
    ticket_email_attempts INTEGER NOT NULL DEFAULT 0,
    ticket_email_attempted_at TEXT,
    ticket_email_error TEXT NOT NULL DEFAULT '',
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

  CREATE TABLE IF NOT EXISTS affiliate_partners (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
    social_platform TEXT NOT NULL,
    profile_url TEXT NOT NULL,
    audience_description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','suspended')),
    referral_code TEXT UNIQUE,
    commission_percent REAL CHECK (commission_percent IS NULL OR commission_percent BETWEEN 0.01 AND 100),
    admin_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS affiliate_referral_visits (
    token_hash TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL REFERENCES affiliate_partners(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS affiliate_referral_visits_partner ON affiliate_referral_visits(partner_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS affiliate_payouts (
    id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL REFERENCES affiliate_partners(id),
    amount_kes INTEGER NOT NULL CHECK (amount_kes > 0),
    reference TEXT NOT NULL COLLATE NOCASE,
    note TEXT NOT NULL DEFAULT '',
    admin_id INTEGER NOT NULL REFERENCES admins(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (partner_id,reference)
  );

  CREATE TABLE IF NOT EXISTS partnership_applications (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    application_type TEXT NOT NULL CHECK (application_type IN ('organizer','sponsor')),
    organization_name TEXT NOT NULL,
    website_url TEXT NOT NULL DEFAULT '',
    application_details TEXT NOT NULL,
    requested_support TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','contacted','approved','rejected','closed')),
    admin_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_at TEXT,
    UNIQUE (account_id,application_type)
  );

  CREATE INDEX IF NOT EXISTS partnership_applications_status_created
    ON partnership_applications(application_type,status,created_at DESC);

  CREATE TABLE IF NOT EXISTS tickets (
    code TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id),
    event_id TEXT NOT NULL REFERENCES events(id),
    ticket_type TEXT NOT NULL,
    checked_in_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS event_feedback (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    loved INTEGER NOT NULL DEFAULT 0 CHECK (loved IN (0,1)),
    rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
    review TEXT NOT NULL DEFAULT '' CHECK (length(review) <= 1200),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (account_id,event_id)
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

  CREATE TABLE IF NOT EXISTS gift_card_purchases (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    amount_kes INTEGER NOT NULL CHECK (amount_kes BETWEEN 500 AND 150000),
    payment_method TEXT NOT NULL CHECK (payment_method IN ('wallet','mpesa')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','review','refunded')),
    client_request_id TEXT NOT NULL,
    recipient_name TEXT NOT NULL,
    recipient_contact TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL,
    checkout_request_id TEXT UNIQUE,
    merchant_request_id TEXT,
    mpesa_receipt TEXT UNIQUE,
    refund_reference TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    paid_at TEXT,
    refunded_at TEXT,
    UNIQUE (account_id,client_request_id)
  );
  CREATE INDEX IF NOT EXISTS gift_card_purchases_account ON gift_card_purchases(account_id,created_at DESC);

  CREATE TABLE IF NOT EXISTS gift_cards (
    id TEXT PRIMARY KEY,
    purchase_id TEXT NOT NULL UNIQUE REFERENCES gift_card_purchases(id),
    purchaser_account_id TEXT NOT NULL REFERENCES accounts(id),
    code_hash TEXT NOT NULL UNIQUE,
    code_ciphertext TEXT NOT NULL,
    code_nonce TEXT NOT NULL,
    code_auth_tag TEXT NOT NULL,
    amount_kes INTEGER NOT NULL CHECK (amount_kes BETWEEN 500 AND 150000),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','issued','redeemed','revoked','refunded')),
    redeemed_by_account_id TEXT REFERENCES accounts(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    issued_at TEXT,
    redeemed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS gift_cards_purchaser ON gift_cards(purchaser_account_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS gift_card_ledger (
    id TEXT PRIMARY KEY,
    gift_card_id TEXT NOT NULL REFERENCES gift_cards(id),
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('issued','redeemed','refunded','revoked')),
    amount_kes INTEGER NOT NULL CHECK (amount_kes != 0),
    account_id TEXT REFERENCES accounts(id),
    reference_id TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS gift_card_ledger_card ON gift_card_ledger(gift_card_id,created_at,id);

  CREATE TABLE IF NOT EXISTS gift_merchants (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id),
    business_name TEXT NOT NULL,
    website_url TEXT NOT NULL DEFAULT '',
    contact_name TEXT NOT NULL,
    contact_phone TEXT NOT NULL,
    application_details TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','suspended')),
    admin_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS gift_merchants_status_created ON gift_merchants(status,created_at DESC);

  CREATE TABLE IF NOT EXISTS merchant_vouchers (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES gift_merchants(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    face_value_kes INTEGER NOT NULL CHECK (face_value_kes > 0),
    sale_price_kes INTEGER NOT NULL CHECK (sale_price_kes > 0),
    redemption_instructions TEXT NOT NULL,
    terms TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS merchant_vouchers_listing ON merchant_vouchers(active,merchant_id,created_at DESC);

  CREATE TABLE IF NOT EXISTS merchant_voucher_orders (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    merchant_id TEXT NOT NULL REFERENCES gift_merchants(id),
    voucher_id TEXT NOT NULL REFERENCES merchant_vouchers(id),
    code_id TEXT NOT NULL REFERENCES merchant_voucher_codes(id),
    amount_kes INTEGER NOT NULL CHECK (amount_kes > 0),
    face_value_kes INTEGER NOT NULL CHECK (face_value_kes > 0),
    voucher_title TEXT NOT NULL,
    redemption_instructions TEXT NOT NULL,
    voucher_terms TEXT NOT NULL DEFAULT '',
    payment_method TEXT NOT NULL CHECK (payment_method IN ('wallet','mpesa')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','review','refunded')),
    client_request_id TEXT NOT NULL,
    buyer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    checkout_request_id TEXT UNIQUE,
    merchant_request_id TEXT,
    mpesa_receipt TEXT UNIQUE,
    unused_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (unused_confirmed IN (0,1)),
    refund_reference TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    paid_at TEXT,
    refunded_at TEXT,
    UNIQUE (account_id,client_request_id)
  );
  CREATE INDEX IF NOT EXISTS merchant_voucher_orders_merchant ON merchant_voucher_orders(merchant_id,status,created_at DESC);
  CREATE INDEX IF NOT EXISTS merchant_voucher_orders_buyer ON merchant_voucher_orders(account_id,created_at DESC);

  CREATE TABLE IF NOT EXISTS merchant_voucher_codes (
    id TEXT PRIMARY KEY,
    voucher_id TEXT NOT NULL REFERENCES merchant_vouchers(id),
    code_hash TEXT NOT NULL,
    code_ciphertext TEXT NOT NULL,
    code_nonce TEXT NOT NULL,
    code_auth_tag TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','reserved','sold','retired')),
    order_id TEXT UNIQUE REFERENCES merchant_voucher_orders(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (voucher_id,code_hash)
  );
  CREATE INDEX IF NOT EXISTS merchant_voucher_codes_inventory ON merchant_voucher_codes(voucher_id,status);
  CREATE UNIQUE INDEX IF NOT EXISTS merchant_voucher_codes_unique_code ON merchant_voucher_codes(code_hash);
  CREATE TABLE IF NOT EXISTS merchant_voucher_ledger (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES gift_merchants(id),
    order_id TEXT NOT NULL REFERENCES merchant_voucher_orders(id),
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('sale','refund','payout')),
    amount_kes INTEGER NOT NULL CHECK (amount_kes != 0),
    reference_id TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS merchant_voucher_ledger_merchant ON merchant_voucher_ledger(merchant_id,created_at,id);

  CREATE TABLE IF NOT EXISTS merchant_payouts (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES gift_merchants(id),
    amount_kes INTEGER NOT NULL CHECK (amount_kes > 0),
    reference TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    admin_id INTEGER NOT NULL REFERENCES admins(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (merchant_id,reference)
  );

  CREATE TABLE IF NOT EXISTS gift_refund_requests (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    instrument_type TEXT NOT NULL CHECK (instrument_type IN ('gift_card','merchant_voucher')),
    instrument_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    admin_note TEXT NOT NULL DEFAULT '',
    refund_reference TEXT NOT NULL DEFAULT '',
    reviewed_by INTEGER REFERENCES admins(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_at TEXT,
    UNIQUE (account_id,instrument_type,instrument_id)
  );
  CREATE INDEX IF NOT EXISTS gift_refund_requests_review ON gift_refund_requests(status,created_at);
`);

const eventColumns = db.prepare('PRAGMA table_info(events)').all();
if (!eventColumns.some((column) => column.name === 'organizer_account_id')) {
  db.exec('ALTER TABLE events ADD COLUMN organizer_account_id TEXT REFERENCES accounts(id)');
}
if (!eventColumns.some((column) => column.name === 'deleted_at')) {
  db.exec('ALTER TABLE events ADD COLUMN deleted_at TEXT');
}
if (!eventColumns.some((column) => column.name === 'updated_at')) {
  db.exec('ALTER TABLE events ADD COLUMN updated_at TEXT');
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
if (!orderColumns.some((column) => column.name === 'nowpayments_invoice_id')) {
  db.exec('ALTER TABLE orders ADD COLUMN nowpayments_invoice_id TEXT');
}
if (!orderColumns.some((column) => column.name === 'nowpayments_price_amount_usd')) {
  db.exec('ALTER TABLE orders ADD COLUMN nowpayments_price_amount_usd REAL');
}
if (!orderColumns.some((column) => column.name === 'ticket_email_status')) {
  db.exec("ALTER TABLE orders ADD COLUMN ticket_email_status TEXT NOT NULL DEFAULT 'not_applicable'");
}
if (!orderColumns.some((column) => column.name === 'ticket_email_attempts')) {
  db.exec('ALTER TABLE orders ADD COLUMN ticket_email_attempts INTEGER NOT NULL DEFAULT 0');
}
if (!orderColumns.some((column) => column.name === 'ticket_email_attempted_at')) {
  db.exec('ALTER TABLE orders ADD COLUMN ticket_email_attempted_at TEXT');
}
if (!orderColumns.some((column) => column.name === 'ticket_email_error')) {
  db.exec("ALTER TABLE orders ADD COLUMN ticket_email_error TEXT NOT NULL DEFAULT ''");
}
if (!orderColumns.some((column) => column.name === 'affiliate_partner_id')) {
  db.exec('ALTER TABLE orders ADD COLUMN affiliate_partner_id TEXT');
}
if (!orderColumns.some((column) => column.name === 'affiliate_commission_percent')) {
  db.exec('ALTER TABLE orders ADD COLUMN affiliate_commission_percent REAL');
}
if (!orderColumns.some((column) => column.name === 'affiliate_referral_token_hash')) {
  db.exec('ALTER TABLE orders ADD COLUMN affiliate_referral_token_hash TEXT');
}
db.exec('CREATE INDEX IF NOT EXISTS orders_affiliate_partner ON orders(affiliate_partner_id, status, paid_at)');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS wallets_account ON wallets(account_id)');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS orders_stripe_session ON orders(stripe_session_id) WHERE stripe_session_id IS NOT NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS orders_nowpayments_invoice ON orders(nowpayments_invoice_id) WHERE nowpayments_invoice_id IS NOT NULL');
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
        reference_type TEXT NOT NULL DEFAULT '',
        reference_id TEXT NOT NULL DEFAULT '',
        transaction_type TEXT NOT NULL CHECK (transaction_type IN (
          'deposit','ticket_purchase','ad_purchase','merchandise_purchase',
          'gift_card_purchase','gift_card_redemption','gift_card_refund','merchant_voucher_purchase'
        )),
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
        id,wallet_id,order_id,merchandise_order_id,reference_type,reference_id,
        transaction_type,amount_kes,status,checkout_request_id,
        merchant_request_id,receipt,description,created_at,completed_at
      )
      SELECT id,wallet_id,order_id,${oldMerchandiseOrderId},${oldReferenceType},${oldReferenceId},
        transaction_type,amount_kes,status,checkout_request_id,
        merchant_request_id,receipt,description,created_at,completed_at
      FROM wallet_transactions;
      DROP TABLE wallet_transactions;
      ALTER TABLE wallet_transactions_new RENAME TO wallet_transactions;
      CREATE INDEX wallet_transactions_history ON wallet_transactions(wallet_id,created_at DESC);
      CREATE INDEX wallet_transactions_reference ON wallet_transactions(reference_type,reference_id);
      COMMIT;
    `);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}
db.exec('CREATE INDEX IF NOT EXISTS wallet_transactions_reference ON wallet_transactions(reference_type,reference_id)');
db.exec(`
  INSERT OR IGNORE INTO merchant_voucher_ledger (id,merchant_id,order_id,transaction_type,amount_kes,reference_id,description,created_at)
  SELECT 'sale-' || o.id,o.merchant_id,o.id,'sale',o.amount_kes,o.id,'Confirmed merchant voucher sale.',COALESCE(o.paid_at,o.created_at)
  FROM merchant_voucher_orders o WHERE o.status IN ('paid','refunded');
  INSERT OR IGNORE INTO merchant_voucher_ledger (id,merchant_id,order_id,transaction_type,amount_kes,reference_id,description,created_at)
  SELECT 'refund-' || o.id,o.merchant_id,o.id,'refund',-o.amount_kes,o.refund_reference,'Merchant voucher refund recorded.',COALESCE(o.refunded_at,o.created_at)
  FROM merchant_voucher_orders o WHERE o.status='refunded';
`);

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
