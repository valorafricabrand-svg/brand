const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const { OAuth2Client } = require('google-auth-library');
const db = require('./db');
const { createLoginLimiter, initializeAdmin, login, requireAdmin } = require('./auth');
const mpesa = require('./mpesa');
const stripe = require('./stripe');
const walletSms = require('./wallet-sms');
const accountEmail = require('./account-email');

const allowedCategories = new Set(['Concerts','Festivals','Community','Food & Drink','Arts & Culture','Sports','Business','Other']);
const allowedTimezones = new Set(['Africa/Nairobi','UTC','Africa/Lagos','Africa/Accra']);
const allowedFormats = new Set(['Physical','Virtual','Hybrid']);
const uploadDirectory = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads', 'events'));
fs.mkdirSync(uploadDirectory, { recursive: true });

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function publicEvent(row) {
  const regular = { name: 'Regular', price: row.regular_price, currency: 'KES' };
  const tickets = [];
  if (row.early_bird_price !== null && row.early_bird_ends && Date.parse(row.early_bird_ends) > Date.now()) {
    tickets.push({
      name: 'Early bird',
      price: row.early_bird_price,
      regularPrice: row.regular_price,
      saleEnds: row.early_bird_ends,
      currency: 'KES'
    });
  } else {
    tickets.push(regular);
  }
  if (row.vip_price !== null) tickets.push({ name: 'VIP', price: row.vip_price, currency: 'KES' });
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    category: row.category,
    format: row.format,
    timezone: row.timezone,
    location: [row.venue_name, row.city].filter(Boolean).join(', ') || row.city,
    city: row.city,
    venueName: row.venue_name,
    meetingUrl: row.meeting_url,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    capacity: row.capacity,
    poster: row.poster_url,
    tags: JSON.parse(row.tags_json || '[]'),
    tickets,
    status: row.status,
    createdAt: row.created_at
  };
}

function publicMerchandiseProduct(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    priceKes: row.price_kes,
    currency: 'KES',
    imageUrl: row.image_url,
    stock: row.stock,
    active: Boolean(row.active)
  };
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^(?:254)[17]\d{8}$/.test(digits)) return digits;
  return null;
}

function validImage(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (buffer.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/)) return 'gif';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

function validateEvent(body) {
  const required = ['title','description','category','format','timezone','startsAt','endsAt','city','organizerName','organizerEmail','organizerPhone'];
  for (const field of required) {
    if (typeof body[field] !== 'string' || !body[field].trim()) return `${field} is required.`;
  }
  for (const field of ['venueName','meetingUrl','capacity','regularPrice','earlyBirdPrice','earlyBirdEnds','vipPrice','slug','tags']) {
    if (body[field] !== undefined && body[field] !== null && typeof body[field] !== 'string') {
      return `${field} must be text.`;
    }
  }
  if (body.title.trim().length > 120) return 'Event title must be 120 characters or fewer.';
  if (body.description.trim().length > 5000) return 'Event description must be 5,000 characters or fewer.';
  if (body.city.trim().length > 100) return 'City must be 100 characters or fewer.';
  if (body.organizerName.trim().length > 120) return 'Organizer name must be 120 characters or fewer.';
  if (body.organizerEmail.trim().length > 254) return 'Organizer email must be 254 characters or fewer.';
  if (body.organizerPhone.length > 24) return 'Organizer phone must be 24 characters or fewer.';
  if ((body.venueName || '').length > 180) return 'Venue name must be 180 characters or fewer.';
  if ((body.meetingUrl || '').length > 2048) return 'Meeting URL must be 2,048 characters or fewer.';
  if ((body.tags || '').length > 250) return 'Event tags must be 250 characters or fewer.';
  if (!allowedCategories.has(body.category)) return 'Choose a valid event category.';
  if (!allowedFormats.has(body.format)) return 'Choose a valid event format.';
  if (!allowedTimezones.has(body.timezone)) return 'Choose a supported event timezone.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.organizerEmail.trim())) return 'Enter a valid organizer email.';
  if (!normalizePhone(body.organizerPhone)) return 'Enter a valid Kenyan WhatsApp phone number.';
  const starts = Date.parse(body.startsAt);
  const ends = Date.parse(body.endsAt);
  if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts) return 'The event end must be after its start.';
  if (starts <= Date.now()) return 'Choose an event start time in the future.';
  const regular = Number(body.regularPrice);
  if (!Number.isSafeInteger(regular) || regular < 0) return 'Ticket prices must be whole KES amounts of zero or more.';
  if (body.capacity && (!Number.isSafeInteger(Number(body.capacity)) || Number(body.capacity) < 1)) return 'Capacity must be a positive whole number.';
  if (body.earlyBirdPrice) {
    const early = Number(body.earlyBirdPrice);
    const earlyEnd = Date.parse(body.earlyBirdEnds);
    if (!Number.isSafeInteger(early) || early < 0 || early >= regular || !Number.isFinite(earlyEnd) || earlyEnd >= starts || earlyEnd <= Date.now()) {
      return 'Early-bird price must be below the regular price and end in the future before the event starts.';
    }
  }
  if (body.vipPrice) {
    const vip = Number(body.vipPrice);
    if (!Number.isSafeInteger(vip) || vip <= regular) return 'VIP ticket price must be a whole KES amount above the regular price.';
  }
  if (body.meetingUrl) {
    try {
      const url = new URL(body.meetingUrl);
      if (url.protocol !== 'https:') return 'Virtual meeting links must use HTTPS.';
    } catch (error) {
      return 'Enter a valid virtual meeting URL.';
    }
  }
  if (body.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.slug)) return 'The event URL slug may use lowercase letters, numbers, and hyphens.';
  return null;
}

function slugify(value) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || 'event';
}

function createSubmissionLimiter() {
  const attempts = new Map();
  const windowMs = 30 * 60 * 1000;
  return function submissionLimiter(req, res, next) {
    const now = Date.now();
    let entry = attempts.get(req.ip);
    if (!entry || now - entry.startedAt > windowMs) {
      entry = { startedAt: now, count: 0 };
      attempts.set(req.ip, entry);
    }
    entry.count += 1;
    if (entry.count > 5) return res.status(429).json({ error: 'Too many event submissions. Please try again later.' });
    next();
  };
}

function safeOrderAccess(order, suppliedToken) {
  if (!suppliedToken || !order) return false;
  const actual = Buffer.from(order.access_token_hash, 'hex');
  const expected = Buffer.from(sha256(suppliedToken), 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function createApp(options = {}) {
  const paymentGateway = options.mpesa || mpesa;
  const stripeGateway = options.stripe || stripe;
  const smsGateway = options.sms || walletSms;
  const emailGateway = options.email || accountEmail;
  const ticketEmailGateway = options.ticketEmail || require('./ticket-email');
  const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
  const googleClient = new OAuth2Client(googleClientId || undefined);
  const verifyGoogleToken = options.verifyGoogleToken || (async (idToken) => {
    if (!googleClientId) throw new Error('Google sign-in is not configured.');
    const ticket = await googleClient.verifyIdToken({ idToken, audience: googleClientId });
    return ticket.getPayload();
  });
  const publicSiteUrl = (options.publicSiteUrl || process.env.PUBLIC_SITE_URL || 'http://localhost:8765').replace(/\/+$/, '');
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  async function deliverTicketEmail(orderId) {
    if (!ticketEmailGateway.isConfigured()) return false;
    const claimed = db.transaction(() => {
      const order = db.prepare(`
        SELECT status,ticket_email_status,ticket_email_attempts,ticket_email_attempted_at
        FROM orders WHERE id=? AND order_type='ticket'
      `).get(orderId);
      if (!order || !['paid','confirmed'].includes(order.status) || order.ticket_email_status === 'sent') return false;
      const attemptedAt = order.ticket_email_attempted_at ? Date.parse(order.ticket_email_attempted_at + 'Z') : 0;
      if (!['not_sent','failed','sending'].includes(order.ticket_email_status)) return false;
      if (order.ticket_email_status === 'sending' && attemptedAt > Date.now() - 10 * 60 * 1000) return false;
      if (order.ticket_email_status === 'failed') {
        const delaySeconds = Math.min(3600, 60 * (2 ** Math.min(Math.max(order.ticket_email_attempts - 1, 0), 6)));
        if (attemptedAt > Date.now() - delaySeconds * 1000) return false;
      }
      db.prepare(`
        UPDATE orders SET ticket_email_status='sending',ticket_email_attempts=ticket_email_attempts+1,
          ticket_email_attempted_at=datetime('now'),ticket_email_error=''
        WHERE id=?
      `).run(orderId);
      return true;
    })();
    if (!claimed) return false;
    try {
      await ticketEmailGateway.sendConfirmation(orderId, publicSiteUrl);
      db.prepare(`
        UPDATE orders SET ticket_email_status='sent',ticket_email_error=''
        WHERE id=? AND ticket_email_status='sending'
      `).run(orderId);
      return true;
    } catch (error) {
      const message = String(error && error.message || 'Unknown ticket email delivery error').slice(0, 500);
      db.prepare(`
        UPDATE orders SET ticket_email_status='failed',ticket_email_error=?
        WHERE id=? AND ticket_email_status='sending'
      `).run(message, orderId);
      console.error(`Ticket confirmation email failed for order ${orderId}: ${message}`);
      return false;
    }
  }

  function scheduleTicketEmail(orderId) {
    setImmediate(() => {
      deliverTicketEmail(orderId).catch((error) => {
        console.error(`Could not process ticket confirmation email for order ${orderId}:`, error);
      });
    });
  }

  app.locals.retryPendingTicketEmails = async () => {
    if (!ticketEmailGateway.isConfigured()) return 0;
    const orders = db.prepare(`
      SELECT id FROM orders
      WHERE order_type='ticket' AND status IN ('paid','confirmed')
        AND ticket_email_status IN ('not_sent','failed','sending')
        AND EXISTS (SELECT 1 FROM tickets WHERE tickets.order_id=orders.id)
        AND (
          ticket_email_status='not_sent'
          OR (ticket_email_status='failed' AND datetime(ticket_email_attempted_at) <=
            datetime('now',printf('-%d seconds',MIN(3600,60 * (1 << MIN(MAX(ticket_email_attempts - 1,0),6))))))
          OR (ticket_email_status='sending' AND datetime(ticket_email_attempted_at) <= datetime('now','-10 minutes'))
        )
      ORDER BY paid_at ASC LIMIT 100
    `).all();
    let sent = 0;
    for (const order of orders) {
      if (await deliverTicketEmail(order.id)) sent += 1;
    }
    return sent;
  };

  const origins = (process.env.ALLOWED_ORIGINS || 'http://localhost:8765,http://127.0.0.1:8765')
    .split(',').map((origin) => origin.trim()).filter(Boolean);
  app.use(cors((req, callback) => {
    const origin = req.get('Origin');
    const sameOrigin = origin && origin === `${req.protocol}://${req.get('host')}`;
    if (!origin || origins.includes(origin) || sameOrigin) {
      return callback(null, {
        origin: true,
        allowedHeaders: ['Content-Type','Authorization','X-Order-Access'],
        methods: ['GET','POST','PATCH','OPTIONS']
      });
    }
    return callback(new Error('Origin is not allowed.'));
  }));
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res, next) => {
    if (!stripeGateway.isConfigured()) return res.status(503).send('Stripe webhooks are not configured.');
    let event;
    try {
      event = stripeGateway.constructWebhookEvent(req.body, req.get('stripe-signature'));
    } catch (error) {
      return res.status(400).send('Invalid Stripe webhook signature.');
    }
    try {
      processStripeWebhook(event);
      const orderId = event.data && event.data.object && event.data.object.metadata && event.data.object.metadata.orderId;
      if (typeof orderId === 'string') await deliverTicketEmail(orderId);
      return res.json({ received: true });
    } catch (error) {
      return next(error);
    }
  });
  app.use(express.json({ limit: '64kb' }));
  app.use('/uploads/events', express.static(uploadDirectory, {
    fallthrough: false,
    maxAge: '1d',
    setHeaders(response) {
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    }
  }));

  const loginLimiter = createLoginLimiter();
  const accountLoginLimiter = createLoginLimiter(20);
  const submissionLimiter = createSubmissionLimiter();
  const walletOtpAttempts = new Map();
  const accountCodeAttempts = new Map();
  function normalizedEmail(value) {
    if (typeof value !== 'string') return null;
    const email = value.trim().toLowerCase();
    return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  }

  function createAccountSession(accountId) {
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM account_sessions WHERE expires_at <= datetime(\'now\')').run();
    db.prepare(`
      INSERT INTO account_sessions (token_hash,account_id,expires_at)
      VALUES (?,?,datetime('now','+12 hours'))
    `).run(sha256(token), accountId);
    const account = db.prepare(`
      SELECT id,email,display_name AS displayName,email_verified_at AS emailVerifiedAt
      FROM accounts WHERE id=?
    `).get(accountId);
    return { accessToken: token, expiresIn: '12h', account };
  }

  function requireAccount(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Sign in to your Valor Africa account to continue.' });
    const account = db.prepare(`
      SELECT a.id,a.email,a.display_name AS displayName,a.email_verified_at AS emailVerifiedAt,
        s.token_hash AS sessionTokenHash
      FROM account_sessions s JOIN accounts a ON a.id=s.account_id
      WHERE s.token_hash=? AND s.expires_at > datetime('now')
    `).get(sha256(token));
    if (!account) return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    req.account = account;
    next();
  }

  function optionalAccount(req, res, next) {
    if (!req.headers.authorization) return next();
    return requireAccount(req, res, next);
  }

  function accountCodeLimiter(req, res, next) {
    const email = normalizedEmail(req.body && req.body.email);
    if (!email) return res.status(400).json({ error: 'Enter a valid email address.' });
    const now = Date.now();
    for (const [key, entry] of accountCodeAttempts) {
      if (now - entry.startedAt >= 15 * 60 * 1000) accountCodeAttempts.delete(key);
    }
    const limits = [
      { key: `email:${email}`, maximum: 3 },
      { key: `ip:${req.ip}`, maximum: 20 }
    ];
    if (limits.some(({ key, maximum }) => accountCodeAttempts.get(key)?.count >= maximum)) {
      return res.status(429).json({ error: 'Too many email code requests. Try again in 15 minutes.' });
    }
    for (const { key } of limits) {
      const entry = accountCodeAttempts.get(key);
      accountCodeAttempts.set(key, entry
        ? { startedAt: entry.startedAt, count: entry.count + 1 }
        : { startedAt: now, count: 1 });
    }
    req.accountEmail = email;
    next();
  }

  async function issueAccountCode(email, purpose) {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const codeHash = sha256(`${process.env.JWT_SECRET}:${email}:${purpose}:${code}`);
    db.prepare(`
      INSERT INTO account_email_codes (email,purpose,code_hash,attempts,expires_at)
      VALUES (?,?,?,0,datetime('now','+10 minutes'))
      ON CONFLICT(email,purpose) DO UPDATE SET code_hash=excluded.code_hash,attempts=0,
        expires_at=excluded.expires_at,created_at=datetime('now')
    `).run(email, purpose, codeHash);
    try {
      await emailGateway.sendCode(email, code, purpose);
    } catch (error) {
      db.prepare('DELETE FROM account_email_codes WHERE email=? AND purpose=? AND code_hash=?')
        .run(email, purpose, codeHash);
      throw error;
    }
  }

  function verifyAccountCode(email, purpose, code) {
    const record = db.prepare(`
      SELECT code_hash,attempts FROM account_email_codes
      WHERE email=? AND purpose=? AND expires_at > datetime('now')
    `).get(email, purpose);
    if (!record) return false;
    const actual = Buffer.from(record.code_hash);
    const expected = Buffer.from(sha256(`${process.env.JWT_SECRET}:${email}:${purpose}:${code}`));
    if (actual.length === expected.length && crypto.timingSafeEqual(actual, expected)) return true;
    db.prepare('UPDATE account_email_codes SET attempts=attempts+1 WHERE email=? AND purpose=?').run(email, purpose);
    if (record.attempts + 1 >= 5) {
      db.prepare('DELETE FROM account_email_codes WHERE email=? AND purpose=?').run(email, purpose);
    }
    return false;
  }

  function phoneLinkOtpLimiter(req, res, next) {
    const phone = normalizePhone(req.body && req.body.phone);
    if (!phone) return res.status(400).json({ error: 'Enter a valid Kenyan mobile number.' });
    const now = Date.now();
    for (const [key, entry] of walletOtpAttempts) {
      if (now - entry.startedAt >= 15 * 60 * 1000) walletOtpAttempts.delete(key);
    }
    const limits = [
      { key: `phone:${phone}`, maximum: 3 },
      { key: `ip:${req.ip}`, maximum: 20 }
    ];
    for (const limit of limits) {
      const entry = walletOtpAttempts.get(limit.key);
      if (entry && entry.count >= limit.maximum) {
        return res.status(429).json({ error: 'Too many phone verification code requests. Try again in 15 minutes.' });
      }
    }
    for (const limit of limits) {
      const entry = walletOtpAttempts.get(limit.key);
      walletOtpAttempts.set(limit.key, entry
        ? { startedAt: entry.startedAt, count: entry.count + 1 }
        : { startedAt: now, count: 1 });
    }
    req.linkPhone = phone;
    next();
  }

  function walletForAccount(accountId) {
    return db.prepare('SELECT id,phone,account_type AS accountType,created_at AS createdAt FROM wallets WHERE account_id=?')
      .get(accountId) || null;
  }

  function walletSnapshot(walletId) {
    if (!walletId) return { wallet: null, balanceKes: 0, transactions: [] };
    const wallet = db.prepare('SELECT id,phone,account_type AS accountType,created_at AS createdAt FROM wallets WHERE id=?').get(walletId);
    const balance = db.prepare("SELECT COALESCE(SUM(amount_kes),0) AS balance FROM wallet_transactions WHERE wallet_id=? AND status='completed'").get(walletId).balance;
    const transactions = db.prepare(`
      SELECT id,transaction_type AS type,amount_kes AS amountKes,status,receipt,description,created_at AS createdAt
      FROM wallet_transactions WHERE wallet_id=? ORDER BY created_at DESC,id DESC LIMIT 30
    `).all(walletId);
    return { wallet, balanceKes: balance, transactions };
  }

  const imageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 22, parts: 23, fieldSize: 10000 },
    fileFilter(req, file, callback) {
      const allowed = new Set(['image/jpeg','image/png','image/gif','image/webp']);
      if (allowed.has(file.mimetype)) return callback(null, true);
      const error = new Error('Upload a JPEG, PNG, GIF, or WebP event poster.');
      error.status = 400;
      return callback(error);
    }
  }).single('eventImage');

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      paymentsConfigured: paymentGateway.isConfigured(),
      stripePaymentsConfigured: stripeGateway.isConfigured(),
      phoneLinkSmsConfigured: smsGateway.isConfigured(),
      emailAuthConfigured: emailGateway.isConfigured(),
      ticketEmailsConfigured: ticketEmailGateway.isConfigured(),
      googleAuthConfigured: Boolean(googleClientId)
    });
  });

  app.post('/api/account/phone/otp', requireAccount, phoneLinkOtpLimiter, async (req, res) => {
    if (walletForAccount(req.account.id)) {
      return res.status(409).json({ error: 'A phone wallet is already linked to your account.' });
    }
    if (!smsGateway.isConfigured()) {
      return res.status(503).json({ error: "Phone verification is unavailable until Africa's Talking SMS is configured." });
    }
    const existing = db.prepare('SELECT account_id FROM wallets WHERE phone=?').get(req.linkPhone);
    if (existing && existing.account_id && existing.account_id !== req.account.id) {
      return res.status(409).json({ error: 'This phone wallet is already linked to another account.' });
    }
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const codeHash = sha256(`${process.env.JWT_SECRET}:${req.account.id}:${req.linkPhone}:${code}`);
    db.prepare(`
      INSERT INTO wallet_otps (phone,code_hash,attempts,expires_at)
      VALUES (?,?,0,datetime('now','+5 minutes'))
      ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash,attempts=0,
        expires_at=excluded.expires_at,created_at=datetime('now')
    `).run(req.linkPhone, codeHash);
    try {
      await smsGateway.sendOtp(req.linkPhone, code);
    } catch (error) {
      db.prepare('DELETE FROM wallet_otps WHERE phone=? AND code_hash=?').run(req.linkPhone, codeHash);
      console.error('Wallet phone verification code could not be sent:', error.message);
      return res.status(502).json({ error: 'Could not send a verification code. Check the phone number and try again.' });
    }
    return res.status(202).json({ message: 'A verification code has been sent to your phone.' });
  });

  app.post('/api/account/phone/verify', requireAccount, async (req, res) => {
    const phone = normalizePhone(req.body && req.body.phone);
    const code = req.body && req.body.code;
    const accountType = req.body && req.body.accountType || 'buyer';
    if (!phone || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Enter your Kenyan mobile number and the six-digit code.' });
    }
    if (!['buyer','organizer','both'].includes(accountType)) {
      return res.status(400).json({ error: 'Choose buyer, organizer, or both as your account type.' });
    }
    if (walletForAccount(req.account.id)) {
      return res.status(409).json({ error: 'A phone wallet is already linked to your account.' });
    }
    const existing = db.prepare('SELECT id,account_id FROM wallets WHERE phone=?').get(phone);
    if (existing && existing.account_id && existing.account_id !== req.account.id) {
      return res.status(409).json({ error: 'This phone wallet is already linked to another account.' });
    }
    const otp = db.prepare('SELECT code_hash,attempts FROM wallet_otps WHERE phone=? AND expires_at > datetime(\'now\')').get(phone);
    if (!otp) return res.status(401).json({ error: 'That verification code has expired. Request a new one.' });
    const expectedHash = sha256(`${process.env.JWT_SECRET}:${req.account.id}:${phone}:${code}`);
    const actual = Buffer.from(otp.code_hash);
    const expected = Buffer.from(expectedHash);
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      db.prepare('UPDATE wallet_otps SET attempts=attempts+1 WHERE phone=?').run(phone);
      if (otp.attempts + 1 >= 5) db.prepare('DELETE FROM wallet_otps WHERE phone=?').run(phone);
      return res.status(401).json({ error: 'That verification code is incorrect or expired.' });
    }
    let wallet;
    try {
      wallet = db.transaction(() => {
        const accountWallet = walletForAccount(req.account.id);
        if (accountWallet) throw Object.assign(new Error('A phone wallet is already linked to your account.'), { statusCode: 409 });
        const currentWallet = db.prepare('SELECT id,account_id FROM wallets WHERE phone=?').get(phone);
        if (currentWallet && currentWallet.account_id && currentWallet.account_id !== req.account.id) {
          throw Object.assign(new Error('This phone wallet is already linked to another account.'), { statusCode: 409 });
        }
        db.prepare('DELETE FROM wallet_otps WHERE phone=?').run(phone);
        if (currentWallet) {
          db.prepare('UPDATE wallets SET account_id=? WHERE id=? AND account_id IS NULL')
            .run(req.account.id, currentWallet.id);
          return db.prepare('SELECT id FROM wallets WHERE account_id=?').get(req.account.id);
        }
        const walletId = crypto.randomUUID();
        db.prepare('INSERT INTO wallets (id,phone,account_type,account_id) VALUES (?,?,?,?)')
          .run(walletId, phone, accountType, req.account.id);
        return { id: walletId };
      })();
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      throw error;
    }
    return res.json({ linked: true, ...walletSnapshot(wallet.id) });
  });

  app.get('/api/wallet', requireAccount, (req, res) => {
    const wallet = walletForAccount(req.account.id);
    res.json({ linked: Boolean(wallet), ...walletSnapshot(wallet && wallet.id) });
  });

  app.get('/api/shop/products', (req, res) => {
    const products = db.prepare(`
      SELECT id,name,description,price_kes,image_url,stock,active
      FROM merchandise_products WHERE active=1 ORDER BY created_at DESC,id
    `).all();
    res.json({ products: products.map(publicMerchandiseProduct) });
  });

  app.post('/api/orders/merchandise', requireAccount, (req, res) => {
    const wallet = walletForAccount(req.account.id);
    if (!wallet) return res.status(409).json({ error: 'Link your phone wallet before paying for merchandise.' });
    const { items, customerName, phone, deliveryAddress, clientRequestId } = req.body || {};
    if (req.body && req.body.paymentMethod !== undefined && req.body.paymentMethod !== 'wallet') {
      return res.status(400).json({ error: 'PayPal and crypto payments are not available for merchandise yet. Choose Valor Wallet.' });
    }
    if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
      return res.status(400).json({ error: 'Choose 1–20 merchandise items for your order.' });
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientRequestId || '')) {
      return res.status(400).json({ error: 'Refresh the shop and try your order again.' });
    }
    if (typeof customerName !== 'string' || !customerName.trim() || customerName.trim().length > 120) {
      return res.status(400).json({ error: 'Enter your name (120 characters maximum).' });
    }
    const normalizedContactPhone = normalizePhone(phone);
    if (!normalizedContactPhone) return res.status(400).json({ error: 'Enter a valid Kenyan contact number.' });
    if (typeof deliveryAddress !== 'string' || !deliveryAddress.trim() || deliveryAddress.trim().length > 500) {
      return res.status(400).json({ error: 'Enter delivery details (500 characters maximum).' });
    }

    const productQuantities = new Map();
    for (const item of items) {
      if (!item || typeof item.productId !== 'string' || !item.productId ||
          !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 10 ||
          productQuantities.has(item.productId)) {
        return res.status(400).json({ error: 'Each item must have a unique product and a quantity from 1 to 10.' });
      }
      productQuantities.set(item.productId, item.quantity);
    }

    try {
      const order = db.transaction(() => {
        const existing = db.prepare(`
          SELECT id,amount_kes AS amountKes FROM merchandise_orders
          WHERE account_id=? AND client_request_id=?
        `).get(req.account.id, clientRequestId);
        if (existing) {
          const balanceKes = db.prepare("SELECT COALESCE(SUM(amount_kes),0) AS balance FROM wallet_transactions WHERE wallet_id=? AND status='completed'")
            .get(wallet.id).balance;
          return { ...existing, balanceKes, duplicate: true };
        }

        const orderItems = [];
        let amountKes = 0;
        for (const [productId, quantity] of productQuantities) {
          const product = db.prepare(`
            SELECT id,name,price_kes,stock FROM merchandise_products
            WHERE id=? AND active=1
          `).get(productId);
          if (!product) throw Object.assign(new Error('A merchandise item in your cart is no longer available.'), { statusCode: 409 });
          if (product.stock !== null && product.stock < quantity) {
            throw Object.assign(new Error(`${product.name} does not have enough stock for that quantity.`), { statusCode: 409 });
          }
          const lineTotal = product.price_kes * quantity;
          if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(amountKes + lineTotal)) {
            throw Object.assign(new Error('Your merchandise order total is too large.'), { statusCode: 400 });
          }
          amountKes += lineTotal;
          orderItems.push({ ...product, quantity });
        }

        const balanceKes = db.prepare("SELECT COALESCE(SUM(amount_kes),0) AS balance FROM wallet_transactions WHERE wallet_id=? AND status='completed'")
          .get(wallet.id).balance;
        if (balanceKes < amountKes) {
          throw Object.assign(new Error('Your wallet balance is too low. Add funds and try again.'), { statusCode: 402 });
        }

        const orderId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO merchandise_orders (
            id,account_id,wallet_id,client_request_id,customer_name,phone,delivery_address,amount_kes
          ) VALUES (?,?,?,?,?,?,?,?)
        `).run(orderId, req.account.id, wallet.id, clientRequestId, customerName.trim(), normalizedContactPhone, deliveryAddress.trim(), amountKes);

        const insertItem = db.prepare(`
          INSERT INTO merchandise_order_items (order_id,product_id,product_name,quantity,unit_price_kes)
          VALUES (?,?,?,?,?)
        `);
        const updateStock = db.prepare("UPDATE merchandise_products SET stock=stock-?,updated_at=datetime('now') WHERE id=? AND stock>=?");
        for (const item of orderItems) {
          insertItem.run(orderId, item.id, item.name, item.quantity, item.price_kes);
          if (item.stock !== null && updateStock.run(item.quantity, item.id, item.quantity).changes !== 1) {
            throw Object.assign(new Error(`${item.name} just sold out. Refresh the shop and try again.`), { statusCode: 409 });
          }
        }
        db.prepare(`
          INSERT INTO wallet_transactions (
            id,wallet_id,merchandise_order_id,transaction_type,amount_kes,status,description,completed_at
          ) VALUES (?,?,?,'merchandise_purchase',?,'completed',?,datetime('now'))
        `).run(crypto.randomUUID(), wallet.id, orderId, -amountKes, `Merchandise order ${orderId}`);

        return { id: orderId, amountKes, balanceKes: balanceKes - amountKes, duplicate: false };
      })();
      return res.status(order.duplicate ? 200 : 201).json({
        orderId: order.id,
        status: 'paid',
        amountKes: order.amountKes,
        balanceKes: order.balanceKes,
        message: order.duplicate
          ? 'This merchandise order was already paid from your Valor Wallet.'
          : 'Your merchandise order is paid with Valor Wallet. Our team will contact you about delivery.'
      });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      throw error;
    }
  });

  app.post('/api/wallet/deposits', requireAccount, async (req, res) => {
    const wallet = walletForAccount(req.account.id);
    if (!wallet) return res.status(409).json({ error: 'Verify and link your phone number before adding wallet funds.' });
    if (req.body && req.body.paymentMethod !== undefined && req.body.paymentMethod !== 'mpesa') {
      return res.status(400).json({ error: 'PayPal and crypto deposits are not available yet. Choose M-Pesa.' });
    }
    const amountKes = req.body && req.body.amountKes;
    if (!Number.isSafeInteger(amountKes) || amountKes < 100 || amountKes > 150000) {
      return res.status(400).json({ error: 'Deposit an amount from KES 100 to KES 150,000.' });
    }
    if (paymentsUnavailable(res)) return;
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO wallet_transactions (id,wallet_id,transaction_type,amount_kes,status,description)
      VALUES (?,?, 'deposit', ?, 'pending', 'M-Pesa wallet deposit')
    `).run(id, wallet.id, amountKes);
    try {
      const checkout = await paymentGateway.initiateStkPush({
        id,
        amountKes,
        phone: wallet.phone,
        orderType: 'wallet'
      });
      db.prepare('UPDATE wallet_transactions SET checkout_request_id=?,merchant_request_id=? WHERE id=?')
        .run(checkout.checkoutRequestId, checkout.merchantRequestId, id);
      res.status(201).json({
        transactionId: id,
        status: 'pending',
        message: checkout.customerMessage
      });
    } catch (error) {
      db.prepare("UPDATE wallet_transactions SET status='failed',description=? WHERE id=? AND status='pending'")
        .run('M-Pesa could not start the wallet deposit.', id);
      console.error('M-Pesa wallet deposit could not be started:', error.message);
      res.status(502).json({ error: 'M-Pesa could not start the deposit prompt. Try again shortly.' });
    }
  });

  app.post('/api/auth/login', loginLimiter, (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }
    const token = login(username, password);
    if (!token) return res.status(401).json({ error: 'Invalid admin credentials.' });
    res.json({ token, expiresIn: '8h' });
  });

  app.get('/api/auth/config', (req, res) => {
    res.json({
      googleClientId,
      emailAuthConfigured: emailGateway.isConfigured(),
      phoneLinkSmsConfigured: smsGateway.isConfigured()
    });
  });

  app.post('/api/auth/email/register', accountLoginLimiter, accountCodeLimiter, async (req, res) => {
    if (!emailGateway.isConfigured()) {
      return res.status(503).json({ error: 'Email sign-up is not available until Resend is configured.' });
    }
    const { password, displayName = '' } = req.body || {};
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
      return res.status(400).json({ error: 'Choose a password between 12 and 128 characters.' });
    }
    if (typeof displayName !== 'string' || displayName.trim().length > 120) {
      return res.status(400).json({ error: 'Your name must be 120 characters or fewer.' });
    }
    const existing = db.prepare('SELECT email_verified_at AS emailVerifiedAt FROM accounts WHERE email=?').get(req.accountEmail);
    if (existing && existing.emailVerifiedAt) {
      return res.status(409).json({ error: 'An account already exists with this email. Please sign in instead.' });
    }
    const passwordHash = await require('bcryptjs').hash(password, 12);
    if (existing) {
      db.prepare('UPDATE accounts SET password_hash=?,display_name=? WHERE email=?')
        .run(passwordHash, displayName.trim(), req.accountEmail);
    } else {
      db.prepare('INSERT INTO accounts (id,email,display_name,password_hash) VALUES (?,?,?,?)')
        .run(crypto.randomUUID(), req.accountEmail, displayName.trim(), passwordHash);
    }
    try {
      await issueAccountCode(req.accountEmail, 'verify');
    } catch (error) {
      console.error('Account verification email could not be sent:', error.message);
      return res.status(502).json({ error: 'Could not send the verification email. Please try again shortly.' });
    }
    res.status(202).json({ message: 'Check your email for a six-digit verification code.' });
  });

  app.post('/api/auth/email/resend-verification', accountLoginLimiter, accountCodeLimiter, async (req, res) => {
    if (!emailGateway.isConfigured()) {
      return res.status(503).json({ error: 'Email verification is unavailable until Resend is configured.' });
    }
    const account = db.prepare('SELECT email_verified_at AS emailVerifiedAt FROM accounts WHERE email=?').get(req.accountEmail);
    if (account && !account.emailVerifiedAt) {
      try {
        await issueAccountCode(req.accountEmail, 'verify');
      } catch (error) {
        console.error('Account verification email could not be resent:', error.message);
        return res.status(502).json({ error: 'Could not send the verification email. Please try again shortly.' });
      }
    }
    res.status(202).json({ message: 'If your account needs verification, a code has been sent.' });
  });

  app.post('/api/auth/email/verify', accountLoginLimiter, (req, res) => {
    const email = normalizedEmail(req.body && req.body.email);
    const code = req.body && req.body.code;
    if (!email || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Enter your email and six-digit verification code.' });
    }
    if (!verifyAccountCode(email, 'verify', code)) {
      return res.status(401).json({ error: 'That verification code is incorrect or expired.' });
    }
    const account = db.prepare('SELECT id FROM accounts WHERE email=?').get(email);
    if (!account) return res.status(401).json({ error: 'That verification code is incorrect or expired.' });
    db.transaction(() => {
      db.prepare("UPDATE accounts SET email_verified_at=datetime('now') WHERE id=?").run(account.id);
      db.prepare('DELETE FROM account_email_codes WHERE email=? AND purpose=?').run(email, 'verify');
    })();
    res.json(createAccountSession(account.id));
  });

  app.post('/api/auth/email/login', accountLoginLimiter, async (req, res) => {
    const email = normalizedEmail(req.body && req.body.email);
    const password = req.body && req.body.password;
    if (!email || typeof password !== 'string' || !password || password.length > 128) {
      return res.status(400).json({ error: 'Enter a valid email and password.' });
    }
    const account = db.prepare('SELECT id,password_hash,email_verified_at FROM accounts WHERE email=?').get(email);
    if (!account || !account.password_hash || !await require('bcryptjs').compare(password, account.password_hash)) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    if (!account.email_verified_at) {
      return res.status(403).json({ error: 'Verify your email address before signing in.' });
    }
    res.json(createAccountSession(account.id));
  });

  app.post('/api/auth/email/forgot-password', accountLoginLimiter, accountCodeLimiter, async (req, res) => {
    if (!emailGateway.isConfigured()) {
      return res.status(503).json({ error: 'Password recovery is unavailable until Resend is configured.' });
    }
    const account = db.prepare('SELECT id FROM accounts WHERE email=? AND email_verified_at IS NOT NULL').get(req.accountEmail);
    if (account && db.prepare('SELECT password_hash FROM accounts WHERE id=?').get(account.id).password_hash) {
      try {
        await issueAccountCode(req.accountEmail, 'reset');
      } catch (error) {
        console.error('Password reset email could not be sent:', error.message);
        return res.status(502).json({ error: 'Could not send the password reset email. Please try again shortly.' });
      }
    }
    res.status(202).json({ message: 'If a password account exists for that email, a reset code has been sent.' });
  });

  app.post('/api/auth/email/reset-password', accountLoginLimiter, (req, res) => {
    const email = normalizedEmail(req.body && req.body.email);
    const code = req.body && req.body.code;
    const password = req.body && req.body.password;
    if (!email || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Enter your email and six-digit password reset code.' });
    }
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
      return res.status(400).json({ error: 'Choose a password between 12 and 128 characters.' });
    }
    if (!verifyAccountCode(email, 'reset', code)) {
      return res.status(401).json({ error: 'That password reset code is incorrect or expired.' });
    }
    const account = db.prepare('SELECT id FROM accounts WHERE email=? AND email_verified_at IS NOT NULL').get(email);
    if (!account) return res.status(401).json({ error: 'That password reset code is incorrect or expired.' });
    db.transaction(() => {
      db.prepare('UPDATE accounts SET password_hash=? WHERE id=?')
        .run(require('bcryptjs').hashSync(password, 12), account.id);
      db.prepare('DELETE FROM account_email_codes WHERE email=? AND purpose=?').run(email, 'reset');
      db.prepare('DELETE FROM account_sessions WHERE account_id=?').run(account.id);
    })();
    res.json({ passwordReset: true, message: 'Your password has been reset. Sign in with your new password.' });
  });

  app.post('/api/auth/google', accountLoginLimiter, async (req, res) => {
    const idToken = req.body && req.body.idToken;
    if (typeof idToken !== 'string' || !idToken || idToken.length > 10000) {
      return res.status(400).json({ error: 'A valid Google sign-in credential is required.' });
    }
    let profile;
    try {
      profile = await verifyGoogleToken(idToken);
    } catch (error) {
      console.error('Google sign-in token verification failed:', error.message);
      return res.status(401).json({ error: 'Google sign-in could not be verified. Please try again.' });
    }
    const email = normalizedEmail(profile && profile.email);
    if (!email || profile.email_verified !== true || typeof profile.sub !== 'string' || !profile.sub) {
      return res.status(401).json({ error: 'Google must confirm your email address before you can sign in.' });
    }
    const displayName = typeof profile.name === 'string' ? profile.name.slice(0, 120) : '';
    let account = db.prepare('SELECT id,email_verified_at AS emailVerifiedAt,google_sub AS googleSub FROM accounts WHERE google_sub=?')
      .get(profile.sub);
    if (!account) {
      const byEmail = db.prepare('SELECT id,email_verified_at AS emailVerifiedAt,google_sub AS googleSub FROM accounts WHERE email=?')
        .get(email);
      if (byEmail && !byEmail.emailVerifiedAt) {
        return res.status(409).json({ error: 'Verify your existing email account before signing in with Google using this address.' });
      }
      if (byEmail && byEmail.googleSub && byEmail.googleSub !== profile.sub) {
        return res.status(409).json({ error: 'This email is already connected to a different Google account.' });
      }
      if (byEmail) {
        account = byEmail;
        db.prepare('UPDATE accounts SET google_sub=?,display_name=CASE WHEN display_name=? THEN ? ELSE display_name END WHERE id=?')
          .run(profile.sub, '', displayName, account.id);
      } else {
        const accountId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO accounts (id,email,display_name,google_sub,email_verified_at)
          VALUES (?,?,?,?,datetime('now'))
        `).run(accountId, email, displayName, profile.sub);
        account = { id: accountId };
      }
    }
    res.json(createAccountSession(account.id));
  });

  app.get('/api/auth/account', requireAccount, (req, res) => {
    res.json({
      account: {
        id: req.account.id,
        email: req.account.email,
        displayName: req.account.displayName,
        emailVerifiedAt: req.account.emailVerifiedAt
      }
    });
  });

  app.post('/api/auth/account/logout', requireAccount, (req, res) => {
    db.prepare('DELETE FROM account_sessions WHERE token_hash=?').run(req.account.sessionTokenHash);
    res.json({ signedOut: true });
  });

  app.get('/api/events', (req, res) => {
    const rows = db.prepare(`
      SELECT * FROM events WHERE status = 'approved'
        AND julianday(starts_at) > julianday('now') AND julianday(ends_at) > julianday('now')
      ORDER BY starts_at ASC LIMIT 100
    `).all();
    res.json({ events: rows.map(publicEvent) });
  });

  app.get('/api/events/by-slug/:slug', (req, res) => {
    const row = db.prepare(`
      SELECT * FROM events WHERE slug = ? AND status = 'approved'
    `).get(req.params.slug);
    if (!row) return res.status(404).json({ error: 'This event is not available.' });
    res.json({ event: publicEvent(row) });
  });

  app.get('/api/events/mine', requireAccount, (req, res) => {
    const events = db.prepare(`
      SELECT e.*,
        (SELECT COALESCE(SUM(o.quantity),0) FROM orders o
          WHERE o.event_id=e.id AND o.order_type='ticket' AND o.status IN ('paid','confirmed')) AS tickets_sold,
        (SELECT COUNT(*) FROM tickets t
          WHERE t.event_id=e.id AND t.checked_in_at IS NOT NULL) AS checked_in,
        (SELECT COALESCE(SUM(o.amount_kes),0) FROM orders o
          WHERE o.event_id=e.id AND o.order_type='ticket' AND o.status IN ('paid','confirmed')) AS gross_kes
      FROM events e
      WHERE e.organizer_account_id=?
      ORDER BY e.created_at DESC LIMIT 200
    `).all(req.account.id);
    res.json({
      events: events.map((event) => ({
        ...publicEvent(event),
        reviewNote: event.review_note,
        ticketsSold: event.tickets_sold,
        checkedIn: event.checked_in,
        grossKes: event.gross_kes
      }))
    });
  });

  app.post('/api/events/submissions', submissionLimiter, optionalAccount, (req, res, next) => {
    imageUpload(req, res, (error) => {
      if (error) return next(error);
      if (req.body.website) return res.status(400).json({ error: 'Invalid event submission.' });
      const input = {
        title: req.body.title,
        description: req.body.description,
        category: req.body.category,
        format: req.body.format,
        timezone: req.body.timezone,
        startsAt: req.body.startsAt,
        endsAt: req.body.endsAt,
        venueName: req.body.venueName || '',
        meetingUrl: req.body.meetingUrl || '',
        city: req.body.city,
        capacity: req.body.capacity || '',
        regularPrice: req.body.regularPrice,
        earlyBirdPrice: req.body.earlyBirdPrice || '',
        earlyBirdEnds: req.body.earlyBirdEnds || '',
        vipPrice: req.body.vipPrice || '',
        slug: req.body.slug || '',
        tags: req.body.tags || '',
        organizerName: req.body.organizerName,
        organizerEmail: req.body.organizerEmail,
        organizerPhone: req.body.organizerPhone
      };
      const invalid = validateEvent(input);
      if (invalid) return res.status(400).json({ error: invalid });
      if (req.file && !validImage(req.file.buffer)) return res.status(400).json({ error: 'The uploaded file is not a supported image.' });

      const id = crypto.randomUUID();
      const slug = input.slug ? input.slug.trim() : slugify(input.title);
      let posterUrl = '';
      if (req.file) {
        const extension = validImage(req.file.buffer);
        const filename = `${id}.${extension}`;
        try {
          fs.writeFileSync(path.join(uploadDirectory, filename), req.file.buffer, { flag: 'wx' });
        } catch (error) {
          return next(error);
        }
        posterUrl = `/uploads/events/${filename}`;
      }
      try {
        db.prepare(`
          INSERT INTO events (
            id, slug, title, description, category, format, timezone, starts_at, ends_at,
            venue_name, meeting_url, city, capacity, regular_price, early_bird_price,
            early_bird_ends, vip_price, tags_json, poster_url, organizer_name, organizer_email,
            organizer_phone, organizer_account_id
          ) VALUES (
            @id, @slug, @title, @description, @category, @format, @timezone, @startsAt, @endsAt,
            @venueName, @meetingUrl, @city, @capacity, @regularPrice, @earlyBirdPrice,
            @earlyBirdEnds, @vipPrice, @tags, @posterUrl, @organizerName, @organizerEmail,
            @organizerPhone, @organizerAccountId
          )
        `).run({
          ...input,
          id,
          slug,
          startsAt: new Date(input.startsAt).toISOString(),
          endsAt: new Date(input.endsAt).toISOString(),
          earlyBirdEnds: input.earlyBirdEnds ? new Date(input.earlyBirdEnds).toISOString() : null,
          capacity: input.capacity ? Number(input.capacity) : null,
          regularPrice: Number(input.regularPrice),
          earlyBirdPrice: input.earlyBirdPrice ? Number(input.earlyBirdPrice) : null,
          vipPrice: input.vipPrice ? Number(input.vipPrice) : null,
          tags: JSON.stringify(input.tags.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 12)),
          posterUrl,
          organizerAccountId: req.account ? req.account.id : null
        });
      } catch (error) {
        if (posterUrl) {
          try {
            fs.unlinkSync(path.join(uploadDirectory, path.basename(posterUrl)));
          } catch (cleanupError) {
            console.error('Could not remove an unlinked event poster:', cleanupError.message);
          }
        }
        if (error.errcode === 2067 || error.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/.test(error.message)) {
          return res.status(409).json({ error: 'That event URL is already in use. Choose a different slug.' });
        }
        throw error;
      }
      res.status(202).json({
        id,
        slug,
        status: 'pending',
        message: 'Your event was submitted for review. It will appear publicly after Valor Africa approves it.'
      });
    });
  });

  app.get('/api/events/admin/submissions', requireAdmin, (req, res) => {
    const status = ['pending','approved','rejected'].includes(req.query.status) ? req.query.status : null;
    const rows = status
      ? db.prepare('SELECT * FROM events WHERE status = ? ORDER BY created_at DESC LIMIT 200').all(status)
      : db.prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT 200').all();
    res.json({
      events: rows.map((row) => ({
        ...publicEvent(row),
        organizer: { name: row.organizer_name, email: row.organizer_email, phone: row.organizer_phone },
        reviewNote: row.review_note
      }))
    });
  });

  app.get('/api/orders/admin', requireAdmin, (req, res) => {
    const eventOrders = db.prepare(`
      SELECT o.id,o.order_type AS orderType,o.status,o.buyer_name AS buyerName,o.phone,
        o.ticket_type AS ticketType,o.quantity,o.amount_kes AS amountKes,
        o.mpesa_receipt AS receipt,o.result_description AS resultDescription,
        o.created_at AS createdAt,o.paid_at AS paidAt,e.title AS eventTitle,
        p.name AS adPackage
      FROM orders o
      LEFT JOIN events e ON e.id=o.event_id
      LEFT JOIN ad_bookings b ON b.id=o.ad_booking_id
      LEFT JOIN ad_packages p ON p.id=b.package_id
      ORDER BY o.created_at DESC LIMIT 200
    `).all();
    const merchandiseOrders = db.prepare(`
      SELECT id,'merchandise' AS orderType,status,customer_name AS buyerName,phone,
        '' AS ticketType,
        (SELECT COALESCE(SUM(quantity),0) FROM merchandise_order_items WHERE order_id=merchandise_orders.id) AS quantity,
        amount_kes AS amountKes,'' AS receipt,'Paid with Valor Wallet.' AS resultDescription,
        created_at AS createdAt,'Merchandise order' AS eventTitle,'' AS adPackage,
        delivery_address AS deliveryAddress
      FROM merchandise_orders ORDER BY created_at DESC LIMIT 200
    `).all().map((order) => ({
      ...order,
      items: db.prepare(`
        SELECT product_name AS name,quantity,unit_price_kes AS unitPriceKes
        FROM merchandise_order_items WHERE order_id=?
      `).all(order.id)
    }));
    const orders = [...eventOrders, ...merchandiseOrders]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 200);
    res.json({ orders });
  });

  app.get('/api/shop/admin/products', requireAdmin, (req, res) => {
    const products = db.prepare(`
      SELECT id,name,description,price_kes,image_url,stock,active
      FROM merchandise_products ORDER BY created_at DESC,id
    `).all();
    res.json({ products: products.map(publicMerchandiseProduct) });
  });

  app.post('/api/shop/admin/products', requireAdmin, (req, res) => {
    const { name, description = '', priceKes, imageUrl = '', stock = null, active = true } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) {
      return res.status(400).json({ error: 'Product name is required (120 characters maximum).' });
    }
    if (typeof description !== 'string' || description.length > 2000) {
      return res.status(400).json({ error: 'Product description must be 2,000 characters or fewer.' });
    }
    if (!Number.isSafeInteger(priceKes) || priceKes < 1 || priceKes > 100000000) {
      return res.status(400).json({ error: 'Set a positive whole-number price in KES.' });
    }
    if (typeof imageUrl !== 'string' || imageUrl.length > 2048 ||
        (imageUrl && !imageUrl.startsWith('/images/') && !/^https:\/\//i.test(imageUrl))) {
      return res.status(400).json({ error: 'Use a site image path under /images/ or a secure HTTPS image URL.' });
    }
    if (stock !== null && (!Number.isSafeInteger(stock) || stock < 0)) {
      return res.status(400).json({ error: 'Stock must be a non-negative whole number, or blank for unlimited stock.' });
    }
    if (![0,1,false,true].includes(active)) return res.status(400).json({ error: 'Choose whether the product is active.' });
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO merchandise_products (id,name,description,price_kes,image_url,stock,active)
      VALUES (?,?,?,?,?,?,?)
    `).run(id, name.trim(), description.trim(), priceKes, imageUrl.trim(), stock, active ? 1 : 0);
    return res.status(201).json(publicMerchandiseProduct(db.prepare('SELECT * FROM merchandise_products WHERE id=?').get(id)));
  });

  app.patch('/api/shop/admin/products/:id', requireAdmin, (req, res) => {
    const existing = db.prepare('SELECT * FROM merchandise_products WHERE id=?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Merchandise product not found.' });
    const { name = existing.name, description = existing.description, priceKes = existing.price_kes,
      imageUrl = existing.image_url, stock = existing.stock, active = existing.active } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) {
      return res.status(400).json({ error: 'Product name is required (120 characters maximum).' });
    }
    if (typeof description !== 'string' || description.length > 2000) {
      return res.status(400).json({ error: 'Product description must be 2,000 characters or fewer.' });
    }
    if (!Number.isSafeInteger(priceKes) || priceKes < 1 || priceKes > 100000000) {
      return res.status(400).json({ error: 'Set a positive whole-number price in KES.' });
    }
    if (typeof imageUrl !== 'string' || imageUrl.length > 2048 ||
        (imageUrl && !imageUrl.startsWith('/images/') && !/^https:\/\//i.test(imageUrl))) {
      return res.status(400).json({ error: 'Use a site image path under /images/ or a secure HTTPS image URL.' });
    }
    if (stock !== null && (!Number.isSafeInteger(stock) || stock < 0)) {
      return res.status(400).json({ error: 'Stock must be a non-negative whole number, or blank for unlimited stock.' });
    }
    if (![0,1,false,true].includes(active)) return res.status(400).json({ error: 'Choose whether the product is active.' });
    db.prepare(`
      UPDATE merchandise_products
      SET name=?,description=?,price_kes=?,image_url=?,stock=?,active=?,updated_at=datetime('now')
      WHERE id=?
    `).run(name.trim(), description.trim(), priceKes, imageUrl.trim(), stock, active ? 1 : 0, req.params.id);
    return res.json(publicMerchandiseProduct(db.prepare('SELECT * FROM merchandise_products WHERE id=?').get(req.params.id)));
  });

  app.patch('/api/events/admin/:id/review', requireAdmin, (req, res) => {
    const { status, reviewNote = '' } = req.body || {};
    if (!['approved','rejected'].includes(status)) return res.status(400).json({ error: 'Choose approve or reject.' });
    if (typeof reviewNote !== 'string' || reviewNote.length > 1000) return res.status(400).json({ error: 'Review notes must be 1,000 characters or fewer.' });
    const existing = db.prepare('SELECT id,status FROM events WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Event submission not found.' });
    if (existing.status !== 'pending') return res.status(409).json({ error: 'Only pending event submissions can be reviewed.' });
    db.prepare(`
      UPDATE events SET status = ?, review_note = ?, reviewed_at = datetime('now') WHERE id = ?
    `).run(status, reviewNote.trim(), req.params.id);
    res.json({ id: req.params.id, status });
  });

  app.get('/api/ads/packages', (req, res) => {
    const packages = db.prepare(`
      SELECT id,name,description,duration_days AS durationDays,price_kes AS priceKes
      FROM ad_packages WHERE active = 1 ORDER BY price_kes ASC
    `).all();
    res.json({ packages });
  });

  app.get('/api/ads/featured', (req, res) => {
    const rows = db.prepare(`
      SELECT DISTINCT e.* FROM events e
      INNER JOIN ad_bookings b ON b.event_id = e.id
      WHERE e.status = 'approved' AND b.status = 'active'
        AND julianday(b.starts_at) <= julianday('now')
        AND julianday(b.ends_at) > julianday('now')
        AND julianday(e.ends_at) > julianday('now')
      ORDER BY b.starts_at DESC LIMIT 10
    `).all();
    res.json({ events: rows.map(publicEvent) });
  });

  app.get('/api/ads/admin/packages', requireAdmin, (req, res) => {
    res.json({
      packages: db.prepare(`
        SELECT id,name,description,duration_days AS durationDays,price_kes AS priceKes,active,created_at AS createdAt
        FROM ad_packages ORDER BY created_at DESC
      `).all()
    });
  });

  app.post('/api/ads/admin/packages', requireAdmin, (req, res) => {
    const { name, description = '', durationDays, priceKes } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 80) return res.status(400).json({ error: 'Package name is required (80 characters maximum).' });
    if (typeof description !== 'string' || description.length > 500) return res.status(400).json({ error: 'Package description must be 500 characters or fewer.' });
    if (!Number.isSafeInteger(durationDays) || durationDays < 1 || durationDays > 90) return res.status(400).json({ error: 'Package duration must be 1–90 days.' });
    if (!Number.isSafeInteger(priceKes) || priceKes < 1) return res.status(400).json({ error: 'Set a positive whole-number KES price.' });
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO ad_packages (id,name,description,duration_days,price_kes) VALUES (?,?,?,?,?)')
      .run(id, name.trim(), description.trim(), durationDays, priceKes);
    res.status(201).json({ id, name: name.trim(), description: description.trim(), durationDays, priceKes, active: 1 });
  });

  app.patch('/api/ads/admin/packages/:id', requireAdmin, (req, res) => {
    const existing = db.prepare('SELECT * FROM ad_packages WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Ad package not found.' });
    const { name = existing.name, description = existing.description, durationDays = existing.duration_days, priceKes = existing.price_kes, active = existing.active } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 80) return res.status(400).json({ error: 'Package name is required (80 characters maximum).' });
    if (typeof description !== 'string' || description.length > 500) return res.status(400).json({ error: 'Package description must be 500 characters or fewer.' });
    if (!Number.isSafeInteger(durationDays) || durationDays < 1 || durationDays > 90) return res.status(400).json({ error: 'Package duration must be 1–90 days.' });
    if (!Number.isSafeInteger(priceKes) || priceKes < 1 || ![0,1,false,true].includes(active)) return res.status(400).json({ error: 'Choose a positive whole-number KES price and a valid availability setting.' });
    db.prepare('UPDATE ad_packages SET name=?,description=?,duration_days=?,price_kes=?,active=? WHERE id=?')
      .run(name.trim(), description.trim(), durationDays, priceKes, active ? 1 : 0, req.params.id);
    res.json({ id: req.params.id, name: name.trim(), description: description.trim(), durationDays, priceKes, active: active ? 1 : 0 });
  });

  function paymentsUnavailable(res) {
    if (paymentGateway.isConfigured()) return false;
    res.status(503).json({ error: 'M-Pesa checkout is not enabled yet. Valor Africa must configure its Daraja account and public callback URL.' });
    return true;
  }

  function createPendingOrder({ orderType, eventId = null, adBookingId = null, accountId = null, buyerName, phone, ticketType = '', quantity = 1, amountKes, paymentMethod = 'mpesa' }) {
    const id = crypto.randomUUID();
    const accessToken = crypto.randomBytes(32).toString('base64url');
    db.prepare(`
      INSERT INTO orders (
        id,access_token_hash,order_type,event_id,ad_booking_id,account_id,buyer_name,phone,
        ticket_type,quantity,amount_kes,payment_method,ticket_email_status
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, sha256(accessToken), orderType, eventId, adBookingId, accountId, buyerName.trim(),
      phone, ticketType, quantity, amountKes, paymentMethod,
      orderType === 'ticket' ? 'not_sent' : 'not_applicable'
    );
    return { id, accessToken };
  }

  async function startCheckout(res, order, amountKes, phone) {
    try {
      const request = await paymentGateway.initiateStkPush({
        id: order.id,
        amountKes,
        phone,
        orderType: order.orderType
      });
      db.prepare(`
        UPDATE orders SET checkout_request_id = ?, merchant_request_id = ? WHERE id = ?
      `).run(request.checkoutRequestId, request.merchantRequestId, order.id);
      res.status(201).json({
        orderId: order.id,
        accessToken: order.accessToken,
        status: 'pending',
        message: request.customerMessage
      });
    } catch (error) {
      db.prepare('UPDATE orders SET status = ?, result_description = ? WHERE id = ? AND status = ?')
        .run('failed', 'Could not start M-Pesa checkout.', order.id, 'pending');
      console.error('M-Pesa checkout could not be started:', error.message);
      res.status(502).json({ error: 'M-Pesa could not start the payment prompt. Check the phone number and try again.' });
    }
  }

  async function startStripeCheckout(res, order, amountKes, unitAmountKes, event, customerEmail) {
    try {
      const session = await stripeGateway.createCheckoutSession({
        id: order.id,
        amountKes,
        unitAmountKes,
        quantity: order.quantity,
        ticketType: order.ticketType,
        eventTitle: event.title,
        eventSlug: event.slug,
        customerEmail,
        publicSiteUrl
      });
      if (!session || typeof session.id !== 'string' || typeof session.url !== 'string' ||
          !Number.isSafeInteger(session.expiresAt)) {
        throw new Error('Stripe did not return a valid checkout session.');
      }
      db.prepare(`
        UPDATE orders SET stripe_session_id=?,stripe_session_expires_at=? WHERE id=? AND status='pending'
      `).run(session.id, new Date(session.expiresAt * 1000).toISOString(), order.id);
      return res.status(201).json({
        orderId: order.id,
        accessToken: order.accessToken,
        status: 'pending',
        checkoutUrl: session.url,
        paymentMethod: 'stripe',
        message: 'Continue to Stripe Checkout to complete your ticket payment.'
      });
    } catch (error) {
      db.prepare("UPDATE orders SET status='failed',result_description=? WHERE id=? AND status='pending'")
        .run('Could not start Stripe Checkout.', order.id);
      console.error('Stripe Checkout could not be started:', error.message);
      return res.status(502).json({ error: 'Stripe could not start checkout. Please try again shortly.' });
    }
  }

  function processStripeWebhook(event) {
    const session = event && event.data && event.data.object;
    if (!session || typeof session.id !== 'string') return;
    const order = db.prepare('SELECT * FROM orders WHERE stripe_session_id=?').get(session.id);
    if (!order) return;
    if (order.order_type !== 'ticket' || order.payment_method !== 'stripe' ||
        !session.metadata || session.metadata.orderId !== order.id) {
      console.error('Stripe Checkout session metadata did not match its ticket order.');
      db.prepare("UPDATE orders SET status='review',result_description=? WHERE id=? AND status='pending'")
        .run('Stripe payment details did not match this order; support review is required.', order.id);
      return;
    }

    if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
      db.prepare("UPDATE orders SET status='failed',result_description=? WHERE id=? AND status='pending'")
        .run('Stripe payment was not completed.', order.id);
      return;
    }
    if (!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type) ||
        session.payment_status !== 'paid') return;

    if (session.amount_total !== order.amount_kes * 100 || session.currency !== 'kes') {
      db.prepare("UPDATE orders SET status='review',result_description=? WHERE id=? AND status='pending'")
        .run('Stripe payment amount did not match this order; support review is required.', order.id);
      return;
    }

    db.transaction(() => {
      const current = db.prepare("SELECT * FROM orders WHERE id=? AND status='pending'").get(order.id);
      if (!current) return;
      if (current.event_id) {
        const eventRow = db.prepare('SELECT capacity FROM events WHERE id=?').get(current.event_id);
        if (eventRow && eventRow.capacity !== null) {
          const sold = db.prepare(`
            SELECT COALESCE(SUM(quantity),0) AS total FROM orders
            WHERE event_id=? AND order_type='ticket' AND status IN ('paid','confirmed')
          `).get(current.event_id).total;
          if (sold + current.quantity > eventRow.capacity) {
            db.prepare("UPDATE orders SET status='review',result_description=? WHERE id=?")
              .run('Payment received but ticket capacity was reached; contact support for a refund.', current.id);
            return;
          }
        }
      }
      db.prepare("UPDATE orders SET status='paid',result_description=?,paid_at=datetime('now') WHERE id=?")
        .run('Payment confirmed by Stripe.', current.id);
      const insertTicket = db.prepare('INSERT INTO tickets (code,order_id,event_id,ticket_type) VALUES (?,?,?,?)');
      for (let ticket = 0; ticket < current.quantity; ticket += 1) {
        insertTicket.run(crypto.randomUUID(), current.id, current.event_id, current.ticket_type);
      }
    })();
  }

  app.post('/api/orders/tickets', requireAccount, async (req, res, next) => {
    try {
      const { eventId, ticketType, buyerName, phone: inputPhone, quantity = 1 } = req.body || {};
      const paymentMethod = req.body && req.body.paymentMethod || 'mpesa';
      if (!['mpesa','wallet','stripe'].includes(paymentMethod)) return res.status(400).json({ error: 'Choose M-Pesa, Valor Wallet, or Stripe Checkout as the payment method.' });
      req.wallet = paymentMethod === 'wallet' ? walletForAccount(req.account.id) : null;
      if (paymentMethod === 'wallet' && !req.wallet) return res.status(409).json({ error: 'Verify and link your phone number before paying from your wallet.' });
      const phone = paymentMethod === 'wallet' ? req.wallet.phone : normalizePhone(inputPhone);
      if (typeof eventId !== 'string' || !eventId || typeof ticketType !== 'string' || !ticketType) return res.status(400).json({ error: 'Choose a published event and ticket type.' });
      if (typeof buyerName !== 'string' || !buyerName.trim() || buyerName.length > 120) return res.status(400).json({ error: 'Enter the ticket buyer’s name.' });
      if (!phone) return res.status(400).json({ error: 'Enter a valid Safaricom number, for example 0712345678.' });
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10) return res.status(400).json({ error: 'Ticket quantity must be 1–10.' });
      const event = db.prepare("SELECT * FROM events WHERE id = ? AND status = 'approved'").get(eventId);
      if (!event) return res.status(404).json({ error: 'This event is not available for ticket sales.' });
      if (Date.parse(event.starts_at) <= Date.now()) return res.status(409).json({ error: 'Ticket sales for this event have closed.' });
      let price;
      if (ticketType === 'Regular') price = event.regular_price;
      else if (ticketType === 'Early bird' && event.early_bird_price !== null && Date.parse(event.early_bird_ends) > Date.now()) price = event.early_bird_price;
      else if (ticketType === 'VIP' && event.vip_price !== null) price = event.vip_price;
      else return res.status(400).json({ error: 'That ticket type is unavailable.' });
      if (!Number.isSafeInteger(price * quantity)) return res.status(400).json({ error: 'The ticket order total is too large.' });
      if (price > 0 && paymentMethod === 'mpesa' && paymentsUnavailable(res)) return;
      if (price > 0 && paymentMethod === 'stripe' && !stripeGateway.isConfigured()) {
        return res.status(503).json({ error: 'Stripe Checkout is not enabled yet. Valor Africa must configure its Stripe keys and webhook secret.' });
      }

      let order;
      try {
        order = db.transaction(() => {
          if (event.capacity !== null) {
            const reserved = db.prepare(`
              SELECT COALESCE(SUM(quantity),0) AS total FROM orders
              WHERE event_id = ? AND order_type = 'ticket' AND (
                    status IN ('paid','confirmed') OR (
                      status = 'pending' AND (
                        created_at >= datetime('now','-5 minutes') OR
                        (payment_method='stripe' AND julianday(stripe_session_expires_at) > julianday('now'))
                      )
                    )
                  )
                `).get(eventId).total;
            if (reserved + quantity > event.capacity) throw Object.assign(new Error('There are not enough tickets remaining.'), { statusCode: 409 });
          }
          const created = createPendingOrder({
            orderType: 'ticket', eventId, accountId: req.account.id, buyerName, phone, ticketType, quantity,
            amountKes: price * quantity, paymentMethod: price === 0 ? 'free' : paymentMethod
          });
          if (price === 0) {
            db.prepare("UPDATE orders SET status='confirmed',result_description=?,paid_at=datetime('now') WHERE id=?")
              .run('Free ticket registration confirmed.', created.id);
            const insertTicket = db.prepare('INSERT INTO tickets (code,order_id,event_id,ticket_type) VALUES (?,?,?,?)');
            for (let ticket = 0; ticket < quantity; ticket += 1) {
              insertTicket.run(crypto.randomUUID(), created.id, eventId, ticketType);
            }
          } else if (paymentMethod === 'wallet') {
            const total = price * quantity;
            const balance = db.prepare("SELECT COALESCE(SUM(amount_kes),0) AS balance FROM wallet_transactions WHERE wallet_id=? AND status='completed'")
              .get(req.wallet.id).balance;
            if (balance < total) {
              throw Object.assign(new Error('Your wallet balance is too low. Add funds and try again.'), { statusCode: 402 });
            }
            db.prepare("UPDATE orders SET status='paid',result_description=?,paid_at=datetime('now') WHERE id=?")
              .run('Ticket order paid from Valor Wallet.', created.id);
            db.prepare(`
              INSERT INTO wallet_transactions (id,wallet_id,order_id,transaction_type,amount_kes,status,description,completed_at)
              VALUES (?,?,?,'ticket_purchase',?,'completed',?,datetime('now'))
            `).run(crypto.randomUUID(), req.wallet.id, created.id, -total, `${quantity} ${ticketType} ticket(s)`);
            const insertTicket = db.prepare('INSERT INTO tickets (code,order_id,event_id,ticket_type) VALUES (?,?,?,?)');
            for (let ticket = 0; ticket < quantity; ticket += 1) {
              insertTicket.run(crypto.randomUUID(), created.id, eventId, ticketType);
            }
          }
          return created;
        })();
      } catch (error) {
        if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
        throw error;
      }
      if (price === 0) {
        scheduleTicketEmail(order.id);
        return res.status(201).json({
          orderId: order.id,
          accessToken: order.accessToken,
          status: 'confirmed',
          message: 'Your free event registration is confirmed.'
        });
      }
      if (paymentMethod === 'wallet') {
        scheduleTicketEmail(order.id);
        return res.status(201).json({
          orderId: order.id,
          accessToken: order.accessToken,
          status: 'paid',
          message: 'Your ticket order was paid using Valor Wallet.'
        });
      }
      if (paymentMethod === 'stripe') {
        return startStripeCheckout(res, order, price * quantity, price, event, req.account.email);
      }
      return startCheckout(res, order, price * quantity, phone);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/orders/ads', (req, res, next) => {
    if (req.body && req.body.paymentMethod === 'wallet') return requireAccount(req, res, next);
    next();
  }, async (req, res, next) => {
    try {
      const paymentMethod = req.body && req.body.paymentMethod || 'mpesa';
      if (!['mpesa','wallet'].includes(paymentMethod)) return res.status(400).json({ error: 'Choose M-Pesa or Valor Wallet as the payment method.' });
      if (paymentMethod === 'mpesa' && paymentsUnavailable(res)) return;
      const { eventId, packageId, buyerName, phone: inputPhone } = req.body || {};
      req.wallet = paymentMethod === 'wallet' ? walletForAccount(req.account.id) : null;
      if (paymentMethod === 'wallet' && !req.wallet) return res.status(409).json({ error: 'Verify and link your phone number before paying from your wallet.' });
      const phone = paymentMethod === 'wallet' ? req.wallet.phone : normalizePhone(inputPhone);
      if (typeof eventId !== 'string' || !eventId || typeof packageId !== 'string' || !packageId) return res.status(400).json({ error: 'Choose an approved event and advertising package.' });
      if (typeof buyerName !== 'string' || !buyerName.trim() || buyerName.length > 120) return res.status(400).json({ error: 'Enter the advertiser’s name.' });
      if (!phone) return res.status(400).json({ error: 'Enter a valid Safaricom number, for example 0712345678.' });
      const event = db.prepare("SELECT id FROM events WHERE id = ? AND status = 'approved' AND julianday(starts_at) > julianday('now')").get(eventId);
      if (!event) return res.status(404).json({ error: 'Only approved events can be advertised.' });
      const packageRow = db.prepare('SELECT * FROM ad_packages WHERE id = ? AND active = 1').get(packageId);
      if (!packageRow) return res.status(404).json({ error: 'This advertising package is not available.' });
      const bookingId = crypto.randomUUID();
      let order;
      try {
        order = db.transaction(() => {
          db.prepare('INSERT INTO ad_bookings (id,event_id,package_id) VALUES (?,?,?)').run(bookingId, eventId, packageId);
          const created = createPendingOrder({
            orderType: 'ad', eventId, adBookingId: bookingId, buyerName, phone,
            amountKes: packageRow.price_kes
          });
          if (paymentMethod === 'wallet') {
            const balance = db.prepare("SELECT COALESCE(SUM(amount_kes),0) AS balance FROM wallet_transactions WHERE wallet_id=? AND status='completed'")
              .get(req.wallet.id).balance;
            if (balance < packageRow.price_kes) {
              throw Object.assign(new Error('Your wallet balance is too low. Add funds and try again.'), { statusCode: 402 });
            }
            const beginsAt = new Date(Math.floor(Date.now() / 1000) * 1000);
            const endsAt = new Date(beginsAt.getTime() + packageRow.duration_days * 86400000);
            db.prepare("UPDATE orders SET status='paid',result_description=?,paid_at=datetime('now') WHERE id=?")
              .run('Advertising order paid from Valor Wallet.', created.id);
            db.prepare("UPDATE ad_bookings SET status='active',starts_at=?,ends_at=? WHERE id=?")
              .run(beginsAt.toISOString(), endsAt.toISOString(), bookingId);
            db.prepare(`
              INSERT INTO wallet_transactions (id,wallet_id,order_id,transaction_type,amount_kes,status,description,completed_at)
              VALUES (?,?,?,'ad_purchase',?,'completed',?,datetime('now'))
            `).run(crypto.randomUUID(), req.wallet.id, created.id, -packageRow.price_kes, `${packageRow.name} event promotion`);
          }
          return created;
        })();
      } catch (error) {
        if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
        throw error;
      }
      if (paymentMethod === 'wallet') {
        return res.status(201).json({
          orderId: order.id,
          accessToken: order.accessToken,
          status: 'paid',
          message: 'Your event promotion was paid using Valor Wallet.'
        });
      }
      return startCheckout(res, order, packageRow.price_kes, phone);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/account/tickets', requireAccount, async (req, res, next) => {
    try {
      const tickets = db.prepare(`
        SELECT t.code,t.ticket_type AS ticketType,t.created_at AS issuedAt,
          o.id AS orderId,o.status AS orderStatus,o.ticket_email_status AS ticketEmailStatus,o.quantity,
          e.id AS eventId,e.title AS eventTitle,e.slug AS eventSlug,e.starts_at AS startsAt,
          e.venue_name AS venueName,e.city,e.timezone
        FROM tickets t
        JOIN orders o ON o.id=t.order_id
        JOIN events e ON e.id=t.event_id
        WHERE o.account_id=? AND o.order_type='ticket' AND o.status IN ('paid','confirmed')
        ORDER BY e.starts_at ASC,t.created_at ASC
      `).all(req.account.id);
      res.json({
        tickets: await Promise.all(tickets.map(async (ticket) => ({
          ...ticket,
          qr: await QRCode.toDataURL(
            `${publicSiteUrl}/ticket.html?code=${encodeURIComponent(ticket.code)}`,
            { errorCorrectionLevel: 'M', margin: 1, width: 220 }
          )
        })))
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/orders/:id', (req, res, next) => {
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (order.order_type !== 'ticket' || !order.account_id) {
      req.order = order;
      return next();
    }
    return requireAccount(req, res, () => {
      if (req.account.id !== order.account_id) return res.status(404).json({ error: 'Order not found.' });
      req.order = order;
      next();
    });
  }, async (req, res, next) => {
    try {
      const order = req.order;
      if (!safeOrderAccess(order, req.get('X-Order-Access'))) return res.status(404).json({ error: 'Order not found.' });
      const result = {
        orderId: order.id,
        status: order.status,
        orderType: order.order_type,
        amountKes: order.amount_kes,
        quantity: order.quantity,
        ticketType: order.ticket_type,
        paymentMethod: order.payment_method,
        receipt: order.status === 'paid' ? order.mpesa_receipt : '',
        resultDescription: order.result_description,
        createdAt: order.created_at
      };
      if (order.order_type === 'ticket' && ['paid','confirmed'].includes(order.status)) {
        const tickets = db.prepare(`
          SELECT t.code,t.ticket_type AS ticketType,e.title,e.slug,e.starts_at AS startsAt,e.venue_name AS venueName,e.city
          FROM tickets t JOIN events e ON e.id=t.event_id WHERE t.order_id=? ORDER BY t.created_at,t.code
        `).all(order.id);
        result.tickets = await Promise.all(tickets.map(async (ticket) => ({
          ...ticket,
          qr: await QRCode.toDataURL(`${publicSiteUrl}/ticket.html?code=${encodeURIComponent(ticket.code)}`, { errorCorrectionLevel: 'M', margin: 1, width: 220 })
        })));
      }
      if (order.order_type === 'ad' && order.ad_booking_id) {
        const booking = db.prepare(`
          SELECT b.status AS campaignStatus,b.starts_at AS startsAt,b.ends_at AS endsAt,
            e.title AS eventTitle,p.name AS packageName
          FROM ad_bookings b JOIN events e ON e.id=b.event_id JOIN ad_packages p ON p.id=b.package_id
          WHERE b.id=?
        `).get(order.ad_booking_id);
        result.campaign = booking;
      }
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/mpesa/callback', async (req, res) => {
    const callback = req.body && req.body.Body && req.body.Body.stkCallback;
    if (!callback || typeof callback.CheckoutRequestID !== 'string' || typeof callback.MerchantRequestID !== 'string') {
      console.error('Received an invalid M-Pesa callback payload.');
      return res.status(400).json({ ResultCode: 1, ResultDesc: 'Invalid callback payload.' });
    }
    const walletDeposit = db.prepare(`
      SELECT * FROM wallet_transactions WHERE checkout_request_id=? AND merchant_request_id=?
    `).get(callback.CheckoutRequestID, callback.MerchantRequestID);
    if (walletDeposit) {
      if (walletDeposit.status !== 'pending') return res.json({ ResultCode: 0, ResultDesc: 'Callback accepted.' });
      if (Number(callback.ResultCode) !== 0) {
        db.prepare("UPDATE wallet_transactions SET status='failed',description=? WHERE id=? AND status='pending'")
          .run(String(callback.ResultDesc || 'M-Pesa deposit was not completed.').slice(0, 250), walletDeposit.id);
        return res.json({ ResultCode: 0, ResultDesc: 'Callback accepted.' });
      }
      try {
        const query = await paymentGateway.queryStkPush(walletDeposit.checkout_request_id);
        if (String(query.CheckoutRequestID) !== walletDeposit.checkout_request_id || String(query.ResultCode) !== '0') {
          return res.json({ ResultCode: 0, ResultDesc: 'Payment verification is pending.' });
        }
        const metadata = callback.CallbackMetadata && callback.CallbackMetadata.Item;
        const values = Array.isArray(metadata) ? Object.fromEntries(metadata.map((item) => [item.Name, item.Value])) : {};
        if (Number(values.Amount) !== walletDeposit.amount_kes || typeof values.MpesaReceiptNumber !== 'string' || !values.MpesaReceiptNumber) {
          db.prepare("UPDATE wallet_transactions SET status='review',description=? WHERE id=? AND status='pending'")
            .run('Deposit details did not match M-Pesa; support review is required.', walletDeposit.id);
          return res.json({ ResultCode: 0, ResultDesc: 'Payment requires review.' });
        }
        db.prepare(`
          UPDATE wallet_transactions SET status='completed',receipt=?,description=?,completed_at=datetime('now')
          WHERE id=? AND status='pending'
        `).run(values.MpesaReceiptNumber, 'M-Pesa deposit confirmed.', walletDeposit.id);
      } catch (error) {
        console.error('M-Pesa wallet deposit verification failed; balance remains unchanged:', error.message);
      }
      return res.json({ ResultCode: 0, ResultDesc: 'Callback accepted.' });
    }
    const order = db.prepare(`
      SELECT * FROM orders WHERE checkout_request_id = ? AND merchant_request_id = ?
    `).get(callback.CheckoutRequestID, callback.MerchantRequestID);
    if (!order || order.status !== 'pending') return res.json({ ResultCode: 0, ResultDesc: 'Callback accepted.' });
    if (Number(callback.ResultCode) !== 0) {
      db.prepare('UPDATE orders SET status = ?, result_description = ? WHERE id = ? AND status = ?')
        .run('failed', String(callback.ResultDesc || 'M-Pesa payment was not completed.').slice(0, 250), order.id, 'pending');
      return res.json({ ResultCode: 0, ResultDesc: 'Callback accepted.' });
    }
    try {
      const query = await paymentGateway.queryStkPush(order.checkout_request_id);
      if (String(query.CheckoutRequestID) !== order.checkout_request_id || String(query.ResultCode) !== '0') {
        return res.json({ ResultCode: 0, ResultDesc: 'Payment verification is pending.' });
      }
      const metadata = callback.CallbackMetadata && callback.CallbackMetadata.Item;
      const values = Array.isArray(metadata) ? Object.fromEntries(metadata.map((item) => [item.Name, item.Value])) : {};
      if (Number(values.Amount) !== order.amount_kes || typeof values.MpesaReceiptNumber !== 'string' || !values.MpesaReceiptNumber) {
        db.prepare('UPDATE orders SET status = ?, result_description = ? WHERE id = ? AND status = ?')
          .run('review', 'Payment details did not match the order; support review is required.', order.id, 'pending');
        return res.json({ ResultCode: 0, ResultDesc: 'Payment requires review.' });
      }
      db.transaction(() => {
        const current = db.prepare("SELECT * FROM orders WHERE id = ? AND status = 'pending'").get(order.id);
        if (!current) return;
        if (current.order_type === 'ticket' && current.event_id) {
          const event = db.prepare('SELECT capacity FROM events WHERE id=?').get(current.event_id);
          if (event.capacity !== null) {
            const sold = db.prepare("SELECT COALESCE(SUM(quantity),0) AS total FROM orders WHERE event_id=? AND order_type='ticket' AND status IN ('paid','confirmed')").get(current.event_id).total;
            if (sold + current.quantity > event.capacity) {
              db.prepare('UPDATE orders SET status=?,mpesa_receipt=?,result_description=? WHERE id=?')
                .run('review', values.MpesaReceiptNumber, 'Payment received but capacity was reached; contact support for a refund.', current.id);
              return;
            }
          }
          db.prepare("UPDATE orders SET status='paid',mpesa_receipt=?,result_description=?,paid_at=datetime('now') WHERE id=?")
            .run(values.MpesaReceiptNumber, 'Payment confirmed by M-Pesa.', current.id);
          const insertTicket = db.prepare('INSERT INTO tickets (code,order_id,event_id,ticket_type) VALUES (?,?,?,?)');
          for (let ticket = 0; ticket < current.quantity; ticket += 1) {
            insertTicket.run(crypto.randomUUID(), current.id, current.event_id, current.ticket_type);
          }
        } else if (current.order_type === 'ad' && current.ad_booking_id) {
          const booking = db.prepare(`
            SELECT b.id,p.duration_days FROM ad_bookings b JOIN ad_packages p ON p.id=b.package_id WHERE b.id=?
          `).get(current.ad_booking_id);
          const beginsAt = new Date(Math.floor(Date.now() / 1000) * 1000);
          const endsAt = new Date(beginsAt.getTime() + booking.duration_days * 86400000);
          db.prepare("UPDATE orders SET status='paid',mpesa_receipt=?,result_description=?,paid_at=datetime('now') WHERE id=?")
            .run(values.MpesaReceiptNumber, 'Payment confirmed by M-Pesa.', current.id);
          db.prepare("UPDATE ad_bookings SET status='active',starts_at=?,ends_at=? WHERE id=?")
            .run(beginsAt.toISOString(), endsAt.toISOString(), booking.id);
        }
      })();
    } catch (error) {
      console.error('M-Pesa payment verification failed; order remains unconfirmed:', error.message);
    }
    if (order.order_type === 'ticket') scheduleTicketEmail(order.id);
    res.json({ ResultCode: 0, ResultDesc: 'Callback accepted.' });
  });

  app.get('/api/tickets/:code/verify', (req, res) => {
    const ticket = db.prepare(`
      SELECT t.code,t.ticket_type AS ticketType,t.checked_in_at AS checkedInAt,
        e.title AS eventTitle,e.starts_at AS startsAt,e.ends_at AS endsAt,e.venue_name AS venueName,e.city,
        o.status AS paymentStatus
      FROM tickets t JOIN events e ON e.id=t.event_id JOIN orders o ON o.id=t.order_id
      WHERE t.code=?
    `).get(req.params.code);
    if (!ticket || !['paid','confirmed'].includes(ticket.paymentStatus)) return res.status(404).json({ error: 'Ticket is invalid.' });
    const { paymentStatus, ...publicTicket } = ticket;
    res.json({ valid: true, ...publicTicket });
  });

  app.post('/api/tickets/admin/:code/check-in', requireAdmin, (req, res) => {
    const ticket = db.prepare('SELECT checked_in_at FROM tickets WHERE code=?').get(req.params.code);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
    if (ticket.checked_in_at) return res.status(409).json({ error: 'This ticket was already checked in.' });
    db.prepare("UPDATE tickets SET checked_in_at=datetime('now') WHERE code=? AND checked_in_at IS NULL").run(req.params.code);
    res.json({ checkedIn: true });
  });

  app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));
  app.use('/admin-assets', express.static(path.join(__dirname, '..', 'public'), { index: false }));
  app.get('/admin-assets/:file', (req, res, next) => {
    if (!['admin.js','admin.css'].includes(req.params.file)) return next();
    res.sendFile(path.join(__dirname, '..', 'public', req.params.file));
  });

  app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Event poster must be 10 MB or smaller.' : 'Invalid image upload.' });
    }
    if (error.status === 400) return res.status(400).json({ error: error.message || 'Invalid request.' });
    if (error.status === 413) return res.status(413).json({ error: 'Request body is too large.' });
    if (error && error.status === 404 && error.code === 'ENOENT') return res.status(404).json({ error: 'Uploaded event poster not found.' });
    if (error.message === 'Origin is not allowed.') return res.status(403).json({ error: error.message });
    console.error('Event API error:', error);
    return res.status(500).json({ error: 'The event service could not complete the request.' });
  });
  return app;
}

module.exports = { createApp, initializeAdmin };
