const crypto = require('crypto');
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

  CREATE TABLE IF NOT EXISTS hero_slides (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    media_type TEXT NOT NULL CHECK (media_type IN ('video','image')),
    media_url TEXT NOT NULL,
    poster_url TEXT NOT NULL DEFAULT '',
    link_url TEXT NOT NULL DEFAULT 'events.html',
    cta_label TEXT NOT NULL DEFAULT 'Learn more',
    position INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS hero_slides_position ON hero_slides(active,position);
  CREATE TABLE IF NOT EXISTS hero_slide_migrations (
    migration TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
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

  CREATE TABLE IF NOT EXISTS wallet_email_codes (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (account_id,phone)
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

  CREATE TABLE IF NOT EXISTS artist_profiles (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
    slug TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    artist_type TEXT NOT NULL CHECK (artist_type IN ('artist','dj','both')),
    bio TEXT NOT NULL,
    city TEXT NOT NULL,
    genres TEXT NOT NULL DEFAULT '',
    profile_image_url TEXT NOT NULL DEFAULT '',
    portfolio_url TEXT NOT NULL DEFAULT '',
    social_platform TEXT NOT NULL,
    social_profile_url TEXT NOT NULL,
    availability_note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS artist_profiles_listing ON artist_profiles(status,city,display_name COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS artist_services (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('DJ performance','Live music','MC / host','Dance / performance','Other')),
    price_kes INTEGER NOT NULL CHECK (price_kes > 0),
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 15 AND 1440),
    cancellation_policy TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS artist_services_listing ON artist_services(profile_id,active,created_at DESC);

  CREATE TABLE IF NOT EXISTS artist_bookings (
    id TEXT PRIMARY KEY,
    service_id TEXT NOT NULL REFERENCES artist_services(id),
    profile_id TEXT NOT NULL REFERENCES artist_profiles(id),
    organizer_account_id TEXT NOT NULL REFERENCES accounts(id),
    client_request_id TEXT NOT NULL,
    event_name TEXT NOT NULL,
    event_date TEXT NOT NULL,
    event_location TEXT NOT NULL,
    message TEXT NOT NULL,
    service_price_kes INTEGER NOT NULL CHECK (service_price_kes > 0),
    deposit_amount_kes INTEGER NOT NULL CHECK (deposit_amount_kes > 0),
    valor_fee_kes INTEGER NOT NULL CHECK (valor_fee_kes >= 0),
    artist_payout_kes INTEGER NOT NULL CHECK (artist_payout_kes >= 0),
    cancellation_policy TEXT NOT NULL,
    policy_accepted_at TEXT,
    status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN (
      'requested','accepted','declined','deposit_pending','deposit_paid','service_completed',
      'completed','cancelled','cancellation_review','refunded','payment_review'
    )),
    payment_method TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    checkout_request_id TEXT UNIQUE,
    merchant_request_id TEXT,
    mpesa_receipt TEXT UNIQUE,
    received_amount_kes INTEGER CHECK (received_amount_kes IS NULL OR received_amount_kes > 0),
    artist_completed_at TEXT,
    organizer_confirmed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    accepted_at TEXT,
    paid_at TEXT,
    cancelled_at TEXT,
    refunded_at TEXT,
    UNIQUE (organizer_account_id,client_request_id)
  );
  CREATE INDEX IF NOT EXISTS artist_bookings_profile ON artist_bookings(profile_id,status,event_date);
  CREATE INDEX IF NOT EXISTS artist_bookings_organizer ON artist_bookings(organizer_account_id,created_at DESC);
  CREATE INDEX IF NOT EXISTS artist_bookings_checkout ON artist_bookings(checkout_request_id);

  CREATE TABLE IF NOT EXISTS artist_booking_email_notifications (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    booking_id TEXT NOT NULL REFERENCES artist_bookings(id) ON DELETE CASCADE,
    recipient_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    notification_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    attempted_at TEXT,
    last_error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at TEXT,
    UNIQUE (event_id,recipient_account_id)
  );
  CREATE INDEX IF NOT EXISTS artist_booking_email_retry
    ON artist_booking_email_notifications(status,attempted_at,created_at);

  CREATE TABLE IF NOT EXISTS artist_booking_payouts (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL UNIQUE REFERENCES artist_bookings(id),
    profile_id TEXT NOT NULL REFERENCES artist_profiles(id),
    amount_kes INTEGER NOT NULL CHECK (amount_kes > 0),
    reference TEXT NOT NULL COLLATE NOCASE,
    note TEXT NOT NULL DEFAULT '',
    admin_id INTEGER NOT NULL REFERENCES admins(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (profile_id,reference)
  );

  CREATE TABLE IF NOT EXISTS artist_booking_refunds (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL UNIQUE REFERENCES artist_bookings(id),
    amount_kes INTEGER NOT NULL CHECK (amount_kes > 0),
    reference TEXT NOT NULL COLLATE NOCASE,
    note TEXT NOT NULL DEFAULT '',
    admin_id INTEGER NOT NULL REFERENCES admins(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (reference)
  );

  CREATE TABLE IF NOT EXISTS partnership_applications (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    application_type TEXT NOT NULL CHECK (application_type IN ('organizer','sponsor','artist','branding','investment')),
    organization_name TEXT NOT NULL,
    website_url TEXT NOT NULL DEFAULT '',
    application_details TEXT NOT NULL,
    requested_support TEXT NOT NULL DEFAULT '',
    sponsorship_tier TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','received','contacted','approved','rejected','closed')),
    admin_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_at TEXT,
    UNIQUE (account_id,application_type)
  );

  CREATE INDEX IF NOT EXISTS partnership_applications_status_created
    ON partnership_applications(application_type,status,created_at DESC);

  CREATE TABLE IF NOT EXISTS partner_terms_acknowledgements (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    terms_version TEXT NOT NULL,
    signer_name TEXT NOT NULL,
    account_email TEXT NOT NULL,
    acknowledged_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (account_id,terms_version)
  );

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

  CREATE TABLE IF NOT EXISTS event_views (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    first_viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
    view_reminder_status TEXT NOT NULL DEFAULT 'not_sent' CHECK (view_reminder_status IN ('not_sent','sent','failed','skipped')),
    view_reminder_attempted_at TEXT,
    view_reminder_error TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (account_id,event_id)
  );

  CREATE TABLE IF NOT EXISTS event_view_daily (
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    view_date TEXT NOT NULL,
    view_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (event_id, view_date)
  );

  CREATE TABLE IF NOT EXISTS ticket_reminder_log (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    days_before INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('sent','failed')),
    error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (account_id,event_id,days_before)
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

  CREATE TABLE IF NOT EXISTS sponsorship_purchases (
    id TEXT PRIMARY KEY,
    access_token_hash TEXT NOT NULL,
    account_id TEXT REFERENCES accounts(id),
    tier TEXT NOT NULL CHECK (tier IN ('community','city','premium')),
    brand_name TEXT NOT NULL,
    website_url TEXT NOT NULL DEFAULT '',
    logo_url TEXT NOT NULL DEFAULT '',
    buyer_name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    amount_kes INTEGER NOT NULL CHECK (amount_kes > 0),
    payment_method TEXT NOT NULL DEFAULT 'mpesa',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','expired','failed','review','cancelled')),
    checkout_request_id TEXT UNIQUE,
    merchant_request_id TEXT,
    nowpayments_invoice_id TEXT,
    nowpayments_price_amount_usd REAL,
    paypal_order_id TEXT,
    paypal_amount_usd REAL,
    result_description TEXT NOT NULL DEFAULT '',
    starts_at TEXT,
    ends_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    paid_at TEXT
  );
  CREATE INDEX IF NOT EXISTS sponsorship_purchases_active ON sponsorship_purchases(status,ends_at);
  CREATE UNIQUE INDEX IF NOT EXISTS sponsorship_purchases_nowpayments_invoice
    ON sponsorship_purchases(nowpayments_invoice_id) WHERE nowpayments_invoice_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS sponsorship_purchases_paypal_order
    ON sponsorship_purchases(paypal_order_id) WHERE paypal_order_id IS NOT NULL;
`);

if (db.prepare('SELECT COUNT(*) AS count FROM hero_slides').get().count === 0) {
  const insertHeroSlide = db.prepare(`
    INSERT INTO hero_slides (
      id,title,category,description,media_type,media_url,poster_url,link_url,cta_label,position
    ) VALUES (?,?,?,?,?,?,?,?,?,?)
  `);
  [
    ['valor-sponsored-video-promo', 'Valor Events and Tickets', 'Featured on Valor Africa',
      'Explore experiences and find your next event.', 'video', 'videos/valor-sponsored-video.mp4',
      'images/events/video-ad-poster.svg', 'events.html', 'Get tickets now'],
    ['valor-ticket-buyer-promo', 'Your next great experience starts here.', 'For ticket buyers',
      'Discover concerts, festivals and experiences across Africa.', 'video', 'videos/valor-ticket-buyer.mp4',
      'images/events/valor-ticket-buyer-cover.jpg', 'events.html', 'Explore events'],
    ['valor-organizer-promo', 'Grow your event with Valor Africa', 'For organizers',
      'Turn your next event into a full house. Create your event listing, choose ticket types and prices, and promote your event with Valor Ads.',
      'video', 'videos/valor-ads-organizer-intro.mp4', 'images/events/valor-ads-promo-poster.svg',
      'host.html', 'Host with Valor']
  ].forEach((slide, position) => insertHeroSlide.run(...slide.slice(0, 9), position));
}

const insertFeaturedClip = db.prepare(`
  INSERT OR IGNORE INTO hero_slides (
    id,title,category,description,media_type,media_url,poster_url,link_url,cta_label,position
  ) VALUES (?,?,?,?,?,?,'','events.html','Explore events',?)
`);
[
  ['valor-featured-clip-002', 'Discover Valor Africa',
    'Featured on Valor Africa', 'Explore events and experiences across Africa.',
    'video', 'videos/valor-featured-clip-002.mp4'],
  ['valor-featured-clip-001', 'Discover Valor Africa',
    'Featured on Valor Africa', 'Explore events and experiences across Africa.',
    'video', 'videos/valor-featured-clip-001.mp4']
].forEach((slide) => {
  const exists = db.prepare('SELECT 1 FROM hero_slides WHERE id=?').get(slide[0]);
  if (exists) return;
  const position = db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS position FROM hero_slides').get().position;
  insertFeaturedClip.run(...slide, position);
});

if (!db.prepare('SELECT 1 FROM hero_slide_migrations WHERE migration=?').get('ticket-buyer-cover-jpg')) {
  db.prepare("UPDATE hero_slides SET poster_url='images/events/valor-ticket-buyer-cover.jpg' WHERE poster_url='images/events/valor-ticket-buyer-cover.png'").run();
  db.prepare('INSERT INTO hero_slide_migrations (migration) VALUES (?)').run('ticket-buyer-cover-jpg');
}

const artistBookingColumns = db.prepare('PRAGMA table_info(artist_bookings)').all();
if (!artistBookingColumns.some((column) => column.name === 'received_amount_kes')) {
  db.exec('ALTER TABLE artist_bookings ADD COLUMN received_amount_kes INTEGER');
}

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
if (!orderColumns.some((column) => column.name === 'gift_recipient_name')) {
  db.exec("ALTER TABLE orders ADD COLUMN gift_recipient_name TEXT NOT NULL DEFAULT ''");
}
if (!orderColumns.some((column) => column.name === 'gift_recipient_contact')) {
  db.exec("ALTER TABLE orders ADD COLUMN gift_recipient_contact TEXT NOT NULL DEFAULT ''");
}
if (!orderColumns.some((column) => column.name === 'gift_message')) {
  db.exec("ALTER TABLE orders ADD COLUMN gift_message TEXT NOT NULL DEFAULT ''");
}
if (!orderColumns.some((column) => column.name === 'paypal_order_id')) {
  db.exec('ALTER TABLE orders ADD COLUMN paypal_order_id TEXT');
}
if (!orderColumns.some((column) => column.name === 'paypal_amount_usd')) {
  db.exec('ALTER TABLE orders ADD COLUMN paypal_amount_usd REAL');
}
if (!orderColumns.some((column) => column.name === 'braintree_amount_usd')) {
  db.exec('ALTER TABLE orders ADD COLUMN braintree_amount_usd REAL');
}
if (!orderColumns.some((column) => column.name === 'braintree_transaction_id')) {
  db.exec('ALTER TABLE orders ADD COLUMN braintree_transaction_id TEXT');
}
if (!orderColumns.some((column) => column.name === 'braintree_capture_started_at')) {
  db.exec('ALTER TABLE orders ADD COLUMN braintree_capture_started_at TEXT');
}
db.exec('CREATE INDEX IF NOT EXISTS orders_affiliate_partner ON orders(affiliate_partner_id, status, paid_at)');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS wallets_account ON wallets(account_id)');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS orders_stripe_session ON orders(stripe_session_id) WHERE stripe_session_id IS NOT NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS orders_nowpayments_invoice ON orders(nowpayments_invoice_id) WHERE nowpayments_invoice_id IS NOT NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS orders_paypal_order ON orders(paypal_order_id) WHERE paypal_order_id IS NOT NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS orders_braintree_transaction ON orders(braintree_transaction_id) WHERE braintree_transaction_id IS NOT NULL');
const ticketColumns = db.prepare('PRAGMA table_info(tickets)').all();
if (!ticketColumns.some((column) => column.name === 'seat_label')) {
  db.exec("ALTER TABLE tickets ADD COLUMN seat_label TEXT NOT NULL DEFAULT ''");
}
if (!ticketColumns.some((column) => column.name === 'showtime_at')) {
  db.exec("ALTER TABLE tickets ADD COLUMN showtime_at TEXT NOT NULL DEFAULT ''");
}
const accountColumns = db.prepare('PRAGMA table_info(accounts)').all();
if (!accountColumns.some((column) => column.name === 'marketing_emails_opt_out')) {
  db.exec('ALTER TABLE accounts ADD COLUMN marketing_emails_opt_out INTEGER NOT NULL DEFAULT 0 CHECK (marketing_emails_opt_out IN (0,1))');
}
db.exec('CREATE INDEX IF NOT EXISTS event_views_reminder ON event_views(view_reminder_status,last_viewed_at)');
db.exec('DROP TABLE IF EXISTS wallet_sessions');

const partnershipApplicationColumns = db.prepare('PRAGMA table_info(partnership_applications)').all();
if (!partnershipApplicationColumns.some((column) => column.name === 'sponsorship_tier')) {
  db.exec("ALTER TABLE partnership_applications ADD COLUMN sponsorship_tier TEXT NOT NULL DEFAULT ''");
}
const partnershipApplicationsSchema = db.prepare(`
  SELECT sql FROM sqlite_master WHERE type='table' AND name='partnership_applications'
`).get().sql;
if (!partnershipApplicationsSchema.includes("'investment'") || !partnershipApplicationsSchema.includes("'received'")) {
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE partnership_applications_new (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        application_type TEXT NOT NULL CHECK (application_type IN ('organizer','sponsor','artist','branding','investment')),
        organization_name TEXT NOT NULL,
        website_url TEXT NOT NULL DEFAULT '',
        application_details TEXT NOT NULL,
        requested_support TEXT NOT NULL DEFAULT '',
        sponsorship_tier TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','received','contacted','approved','rejected','closed')),
        admin_note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        reviewed_at TEXT,
        UNIQUE (account_id,application_type)
      );
      INSERT INTO partnership_applications_new (
        id,account_id,application_type,organization_name,website_url,application_details,
        requested_support,sponsorship_tier,status,admin_note,created_at,updated_at,reviewed_at
      )
      SELECT id,account_id,application_type,organization_name,website_url,application_details,
        requested_support,sponsorship_tier,
        CASE
          WHEN application_type='investment' AND status='pending' THEN 'received'
          WHEN application_type!='investment' AND status IN ('pending','contacted') THEN 'approved'
          ELSE status
        END,
        admin_note,created_at,updated_at,reviewed_at
      FROM partnership_applications;
      DROP TABLE partnership_applications;
      ALTER TABLE partnership_applications_new RENAME TO partnership_applications;
      CREATE INDEX partnership_applications_status_created
        ON partnership_applications(application_type,status,created_at DESC);
      COMMIT;
    `);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

const adPackageColumns = db.prepare('PRAGMA table_info(ad_packages)').all();
if (!adPackageColumns.some((column) => column.name === 'price_per_day_kes')) {
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE ad_packages_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        placement TEXT NOT NULL DEFAULT 'homepage' CHECK (placement IN ('listing','category','homepage','premium')),
        price_per_day_kes INTEGER NOT NULL CHECK (price_per_day_kes > 0),
        min_days INTEGER NOT NULL DEFAULT 1 CHECK (min_days >= 1),
        max_days INTEGER NOT NULL DEFAULT 30 CHECK (max_days >= min_days),
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO ad_packages_new (id,name,description,placement,price_per_day_kes,min_days,max_days,active,created_at)
      SELECT id,name,description,'homepage',
        MAX(1, CAST(ROUND(CAST(price_kes AS REAL) / duration_days) AS INTEGER)),
        duration_days, duration_days, active, created_at
      FROM ad_packages;
      DROP TABLE ad_packages;
      ALTER TABLE ad_packages_new RENAME TO ad_packages;
      COMMIT;
    `);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}
if (db.prepare('SELECT COUNT(*) AS count FROM ad_packages').get().count === 0) {
  const insertTier = db.prepare(`
    INSERT INTO ad_packages (id,name,description,placement,price_per_day_kes,min_days,max_days)
    VALUES (?,?,?,?,?,?,?)
  `);
  [
    ['listing', 'Listing Spotlight', 'A SPONSORED badge on your event card in the main events grid and the sponsored-events rail.', 100],
    ['category', 'Category Boost', 'Everything in Listing Spotlight, plus top placement whenever your event’s category is filtered.', 350],
    ['homepage', 'Homepage Carousel', 'Everything in Category Boost, plus rotation in the homepage featured video carousel — the site’s highest-traffic spot.', 900],
    ['premium', 'Premium Placement', 'Everything in Homepage Carousel, plus guaranteed first position in the carousel and a PREMIUM badge.', 1500]
  ].forEach(([placement, name, description, pricePerDayKes]) => {
    insertTier.run(crypto.randomUUID(), name, description, placement, pricePerDayKes, 1, 30);
  });
}

const adBookingColumns = db.prepare('PRAGMA table_info(ad_bookings)').all();
if (!adBookingColumns.some((column) => column.name === 'days')) {
  db.exec('ALTER TABLE ad_bookings ADD COLUMN days INTEGER');
}
if (!adBookingColumns.some((column) => column.name === 'placement')) {
  db.exec('ALTER TABLE ad_bookings ADD COLUMN placement TEXT');
}
if (!adBookingColumns.some((column) => column.name === 'total_price_kes')) {
  db.exec('ALTER TABLE ad_bookings ADD COLUMN total_price_kes INTEGER');
}
db.exec(`
  UPDATE ad_bookings SET
    days = (SELECT max_days FROM ad_packages WHERE ad_packages.id = ad_bookings.package_id),
    placement = (SELECT placement FROM ad_packages WHERE ad_packages.id = ad_bookings.package_id),
    total_price_kes = (SELECT price_per_day_kes * max_days FROM ad_packages WHERE ad_packages.id = ad_bookings.package_id)
  WHERE days IS NULL
`);

const walletTransactionSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='wallet_transactions'").get().sql;
const walletTransactionColumns = db.prepare('PRAGMA table_info(wallet_transactions)').all();
const walletTransactionColumnNames = new Set(walletTransactionColumns.map((column) => column.name));
if (!walletTransactionSchema.includes("'sponsorship_purchase'")) {
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    const oldMerchandiseOrderId = walletTransactionColumnNames.has('merchandise_order_id')
      ? 'merchandise_order_id'
      : 'NULL';
    const oldReferenceType = walletTransactionColumnNames.has('reference_type')
      ? 'reference_type'
      : "''";
    const oldReferenceId = walletTransactionColumnNames.has('reference_id')
      ? 'reference_id'
      : "''";
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
          'gift_card_purchase','gift_card_redemption','gift_card_refund','merchant_voucher_purchase',
          'sponsorship_purchase'
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
const walletTransactionColumnsFinal = db.prepare('PRAGMA table_info(wallet_transactions)').all();
if (!walletTransactionColumnsFinal.some((column) => column.name === 'nowpayments_invoice_id')) {
  db.exec('ALTER TABLE wallet_transactions ADD COLUMN nowpayments_invoice_id TEXT');
}
if (!walletTransactionColumnsFinal.some((column) => column.name === 'nowpayments_price_amount_usd')) {
  db.exec('ALTER TABLE wallet_transactions ADD COLUMN nowpayments_price_amount_usd REAL');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_nowpayments_invoice ON wallet_transactions(nowpayments_invoice_id) WHERE nowpayments_invoice_id IS NOT NULL');
if (!walletTransactionColumnsFinal.some((column) => column.name === 'paypal_order_id')) {
  db.exec('ALTER TABLE wallet_transactions ADD COLUMN paypal_order_id TEXT');
}
if (!walletTransactionColumnsFinal.some((column) => column.name === 'paypal_amount_usd')) {
  db.exec('ALTER TABLE wallet_transactions ADD COLUMN paypal_amount_usd REAL');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_paypal_order ON wallet_transactions(paypal_order_id) WHERE paypal_order_id IS NOT NULL');
db.exec(`
  INSERT OR IGNORE INTO merchant_voucher_ledger (id,merchant_id,order_id,transaction_type,amount_kes,reference_id,description,created_at)
  SELECT 'sale-' || o.id,o.merchant_id,o.id,'sale',o.amount_kes,o.id,'Confirmed merchant voucher sale.',COALESCE(o.paid_at,o.created_at)
  FROM merchant_voucher_orders o WHERE o.status IN ('paid','refunded');
  INSERT OR IGNORE INTO merchant_voucher_ledger (id,merchant_id,order_id,transaction_type,amount_kes,reference_id,description,created_at)
  SELECT 'refund-' || o.id,o.merchant_id,o.id,'refund',-o.amount_kes,o.refund_reference,'Merchant voucher refund recorded.',COALESCE(o.refunded_at,o.created_at)
  FROM merchant_voucher_orders o WHERE o.status='refunded';
`);

const starterProducts = [
  ['valor-tote', 'Valor Africa Tote Bag', 'Durable canvas tote with the Valor Africa emblem, hand-printed.', 4500, '/images/Valor%20Shop/52D62502-C0A7-4EDD-AEE3-370A48668A0E.jpg'],
  ['community-print-tee', 'Community Print Tee', 'Soft cotton tee celebrating African entrepreneurship.', 2800, '/images/Valor%20Shop/IMG_0729.jpg'],
  ['founders-notebook', 'Founder’s Notebook', 'A5 hardcover notebook for brand-building notes and sketches.', 6200, '/images/Valor%20Shop/IMG_1212.jpg']
];
const insertStarterProduct = db.prepare(`
  INSERT OR IGNORE INTO merchandise_products (id,name,description,price_kes,image_url)
  VALUES (?,?,?,?,?)
`);
for (const product of starterProducts) insertStarterProduct.run(...product);
db.prepare(`
  UPDATE merchandise_products
  SET image_url = CASE id
    WHEN 'valor-tote' THEN '/images/Valor%20Shop/52D62502-C0A7-4EDD-AEE3-370A48668A0E.jpg'
    WHEN 'community-print-tee' THEN '/images/Valor%20Shop/IMG_0729.jpg'
    WHEN 'founders-notebook' THEN '/images/Valor%20Shop/IMG_1212.jpg'
  END,
  updated_at = datetime('now')
  WHERE (id='valor-tote' AND image_url='/images/one.jpg')
    OR (id='community-print-tee' AND image_url='/images/IMG_0729.jpg')
    OR (id='founders-notebook' AND image_url='/images/IMG_1212.jpg')
`).run();

module.exports = db;
