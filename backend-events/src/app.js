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
const nowpayments = require('./nowpayments');
const walletSms = require('./wallet-sms');
const accountEmail = require('./account-email');
const { normalizeKenyanPhone } = require('./kenyan-phone');

const allowedCategories = new Set(['Movies & Cinema','Concerts','Festivals','Community','Food & Drink','Arts & Culture','Sports','Business','Other']);
const allowedTimezones = new Set(['Africa/Nairobi','UTC','Africa/Lagos','Africa/Accra']);
const allowedFormats = new Set(['Physical','Virtual','Hybrid']);
const uploadDirectory = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads', 'events'));
fs.mkdirSync(uploadDirectory, { recursive: true });

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function giftCodeEncryptionKey() {
  const configured = process.env.GIFT_CARD_ENCRYPTION_KEY;
  if (!configured) {
    if (!process.env.JWT_SECRET) throw new Error('Gift-card encryption is unavailable until GIFT_CARD_ENCRYPTION_KEY is configured.');
    return crypto.createHash('sha256').update(`valor-gift-codes-v1:${process.env.JWT_SECRET}`).digest();
  }
  const key = Buffer.from(configured, 'base64');
  if (key.length !== 32) throw new Error('GIFT_CARD_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  return key;
}

if (process.env.NODE_ENV === 'production') giftCodeEncryptionKey();

function protectGiftCode(code) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', giftCodeEncryptionKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  return {
    codeCiphertext: ciphertext.toString('base64'),
    codeNonce: nonce.toString('base64'),
    codeAuthTag: cipher.getAuthTag().toString('base64')
  };
}

function revealGiftCode(record) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    giftCodeEncryptionKey(),
    Buffer.from(record.code_nonce, 'base64')
  );
  decipher.setAuthTag(Buffer.from(record.code_auth_tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(record.code_ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

function normalizeGiftCardCode(value) {
  return typeof value === 'string' ? value.replace(/[\s-]/g, '').toUpperCase() : '';
}

function createGiftCardCode() {
  const value = crypto.randomBytes(18).toString('hex').toUpperCase();
  return `VA-${value.match(/.{1,6}/g).join('-')}`;
}

function giftCardCodeHash(value) {
  return sha256(normalizeGiftCardCode(value));
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
  return normalizeKenyanPhone(value);
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
  if ((body.tags || '').length > 600) return 'Event tags must be 600 characters or fewer.';
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

function createSubmissionLimiter(maximum = 5, description = 'event submissions') {
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
    if (entry.count > maximum) return res.status(429).json({ error: `Too many ${description}. Please try again later.` });
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
  const nowpaymentsGateway = options.nowpayments || nowpayments;
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
  app.post('/api/nowpayments/ipn', (req, res, next) => {
    if (!nowpaymentsGateway.isConfigured()) {
      return res.status(503).json({ error: 'NOWPayments notifications are not configured.' });
    }
    const payload = req.body;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        !nowpaymentsGateway.verifyIpn(payload, req.get('x-nowpayments-sig'))) {
      return res.status(400).json({ error: 'Invalid NOWPayments notification signature.' });
    }
    if (typeof payload.order_id !== 'string' || !['string','number'].includes(typeof payload.invoice_id) ||
        typeof payload.payment_status !== 'string') {
      return res.status(400).json({ error: 'Invalid NOWPayments notification payload.' });
    }
    try {
      const order = db.prepare(`
        SELECT * FROM orders
        WHERE id=? AND order_type='ticket' AND payment_method='nowpayments'
      `).get(payload.order_id);
      if (!order || order.nowpayments_invoice_id !== String(payload.invoice_id)) {
        return res.json({ received: true });
      }
      const receivedPrice = Number(payload.price_amount);
      if (!Number.isFinite(receivedPrice) ||
          Math.round(receivedPrice * 100) !== Math.round(order.nowpayments_price_amount_usd * 100) ||
          String(payload.price_currency).toLowerCase() !== 'usd') {
        db.prepare(`
          UPDATE orders SET status='review',result_description=?
          WHERE id=? AND status='pending'
        `).run('NOWPayments invoice total did not match this order; support review is required.', order.id);
        return res.json({ received: true });
      }
      if (['failed','expired'].includes(payload.payment_status)) {
        db.prepare(`
          UPDATE orders SET status='failed',result_description=?
          WHERE id=? AND status='pending'
        `).run('NOWPayments payment was not completed.', order.id);
        return res.json({ received: true });
      }
      if (payload.payment_status !== 'finished') {
        if (payload.payment_status === 'partially_paid') {
          db.prepare(`
            UPDATE orders SET result_description=?
            WHERE id=? AND status='pending'
          `).run('NOWPayments has received a partial payment. Complete the invoice payment to receive tickets.', order.id);
        }
        return res.json({ received: true });
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
                .run('Crypto payment received but ticket capacity was reached; contact support for a refund.', current.id);
              return;
            }
          }
        }
        db.prepare("UPDATE orders SET status='paid',result_description=?,paid_at=datetime('now') WHERE id=?")
          .run('Payment confirmed by NOWPayments.', current.id);
        const insertTicket = db.prepare('INSERT INTO tickets (code,order_id,event_id,ticket_type) VALUES (?,?,?,?)');
        for (let ticket = 0; ticket < current.quantity; ticket += 1) {
          insertTicket.run(crypto.randomUUID(), current.id, current.event_id, current.ticket_type);
        }
      })();
      const updated = db.prepare('SELECT status FROM orders WHERE id=?').get(order.id);
      if (updated && updated.status === 'paid') {
        deliverTicketEmail(order.id).catch((error) => {
          console.error(`Could not process ticket confirmation email for order ${order.id}:`, error);
        });
      }
      return res.json({ received: true });
    } catch (error) {
      return next(error);
    }
  });
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
  const partnerApplicationLimiter = createSubmissionLimiter(10, 'partnership applications');
  const partnerReferralLimiter = createSubmissionLimiter(1000, 'referral visits');
  const giftPurchaseLimiter = createSubmissionLimiter(8, 'gift purchases');
  const giftCodeAttemptLimiter = createSubmissionLimiter(10, 'gift-code attempts');
  const merchantApplicationLimiter = createSubmissionLimiter(5, 'gift merchant applications');
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

  function recordWalletTransaction(walletId, amountKes, transactionType, referenceType, referenceId, description) {
    db.prepare(`
      INSERT INTO wallet_transactions (
        id,wallet_id,reference_type,reference_id,transaction_type,amount_kes,status,description,completed_at
      ) VALUES (?,?,?,?,?,?,'completed',?,datetime('now'))
    `).run(
      crypto.randomUUID(), walletId, referenceType, referenceId, transactionType, amountKes, description
    );
  }

  function addGiftCardLedgerEntry(cardId, transactionType, amountKes, accountId, referenceId, description) {
    db.prepare(`
      INSERT INTO gift_card_ledger (id,gift_card_id,transaction_type,amount_kes,account_id,reference_id,description)
      VALUES (?,?,?,?,?,?,?)
    `).run(crypto.randomUUID(), cardId, transactionType, amountKes, accountId, referenceId, description);
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
      mpesaEnvironment: typeof paymentGateway.environment === 'function' ? paymentGateway.environment() : null,
      stripePaymentsConfigured: stripeGateway.isConfigured(),
      nowpaymentsConfigured: nowpaymentsGateway.isConfigured(),
      nowpaymentsKesPerUsd: typeof nowpaymentsGateway.kesPerUsdRate === 'function'
        ? nowpaymentsGateway.kesPerUsdRate()
        : null,
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

  app.get('/api/gift-cards/catalog', (req, res) => {
    res.json({
      issuer: 'Valor Africa',
      currency: 'KES',
      minimumAmountKes: 500,
      maximumAmountKes: 150000,
      amountsKes: [500,1000,2500,5000,10000,25000],
      redemption: 'Redeem to a linked Valor Wallet. Wallet value can be used for eligible Valor merchandise and event tickets.',
      expiry: null
    });
  });

  app.post('/api/gift-cards/purchase', requireAccount, giftPurchaseLimiter, async (req, res, next) => {
    const body = req.body || {};
    const amountKes = body.amountKes;
    const paymentMethod = body.paymentMethod || 'wallet';
    const clientRequestId = body.clientRequestId;
    const recipientName = typeof body.recipientName === 'string' ? body.recipientName.trim() : '';
    const recipientContact = typeof body.recipientContact === 'string' ? body.recipientContact.trim() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!Number.isSafeInteger(amountKes) || amountKes < 500 || amountKes > 150000) {
      return res.status(400).json({ error: 'Choose a gift amount from KES 500 to KES 150,000.' });
    }
    if (!['wallet','mpesa'].includes(paymentMethod)) {
      return res.status(400).json({ error: 'Choose Valor Wallet or M-Pesa.' });
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientRequestId || '')) {
      return res.status(400).json({ error: 'Refresh and retry your gift-card purchase.' });
    }
    if (!recipientName || recipientName.length > 120 || recipientContact.length > 160 || message.length > 500) {
      return res.status(400).json({ error: 'Add a recipient name (120 characters maximum), optional contact (160 characters), and message (500 characters maximum).' });
    }
    const wallet = paymentMethod === 'wallet' ? walletForAccount(req.account.id) : null;
    if (paymentMethod === 'wallet' && !wallet) {
      return res.status(409).json({ error: 'Link a Valor Wallet before paying with wallet balance.' });
    }
    const phone = paymentMethod === 'wallet' ? wallet.phone : normalizePhone(body.phone);
    if (!phone) return res.status(400).json({ error: 'Enter a valid Kenyan M-Pesa number.' });
    if (paymentMethod === 'mpesa' && paymentsUnavailable(res)) return;

    const code = createGiftCardCode();
    let protectedCode;
    try {
      protectedCode = protectGiftCode(code);
    } catch (error) {
      return next(error);
    }
    let purchase;
    try {
      purchase = db.transaction(() => {
        const duplicate = db.prepare(`
          SELECT id,amount_kes AS amountKes,payment_method AS paymentMethod,status,
            recipient_name AS recipientName,recipient_contact AS recipientContact,message
          FROM gift_card_purchases WHERE account_id=? AND client_request_id=?
        `).get(req.account.id, clientRequestId);
        if (duplicate) {
          if (duplicate.amountKes !== amountKes || duplicate.paymentMethod !== paymentMethod ||
              duplicate.recipientName !== recipientName || duplicate.recipientContact !== recipientContact ||
              duplicate.message !== message) {
            throw Object.assign(new Error('This retry key was already used for a different gift-card purchase. Refresh and try again.'), { statusCode: 409 });
          }
          return { ...duplicate, duplicate: true };
        }
        if (wallet) {
          const balanceKes = db.prepare("SELECT COALESCE(SUM(amount_kes),0) AS balance FROM wallet_transactions WHERE wallet_id=? AND status='completed'")
            .get(wallet.id).balance;
          if (balanceKes < amountKes) {
            throw Object.assign(new Error('Your wallet balance is too low. Add funds and try again.'), { statusCode: 402 });
          }
        }
        const id = crypto.randomUUID();
        const status = paymentMethod === 'wallet' ? 'paid' : 'pending';
        db.prepare(`
          INSERT INTO gift_card_purchases (
            id,account_id,amount_kes,payment_method,status,client_request_id,
            recipient_name,recipient_contact,message,phone,paid_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='paid' THEN datetime('now') END)
        `).run(
          id, req.account.id, amountKes, paymentMethod, status, clientRequestId,
          recipientName, recipientContact, message, phone, status
        );
        const cardId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO gift_cards (
            id,purchase_id,purchaser_account_id,code_hash,code_ciphertext,code_nonce,code_auth_tag,amount_kes,status,issued_at
          ) VALUES (?,?,?,?,?,?,?,?,?,CASE WHEN ?='issued' THEN datetime('now') END)
        `).run(
          cardId, id, req.account.id, giftCardCodeHash(code), protectedCode.codeCiphertext,
          protectedCode.codeNonce, protectedCode.codeAuthTag, amountKes, status === 'paid' ? 'issued' : 'pending',
          status === 'paid' ? 'issued' : 'pending'
        );
        if (wallet) {
          recordWalletTransaction(
            wallet.id, -amountKes, 'gift_card_purchase', 'gift_card_purchase', id,
            `Valor gift card for ${recipientName}`
          );
          addGiftCardLedgerEntry(cardId, 'issued', amountKes, req.account.id, id, 'Gift card purchase paid from Valor Wallet.');
        }
        return { id, amountKes, paymentMethod, status, duplicate: false };
      })();
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      return next(error);
    }
    if (purchase.duplicate) {
      return res.status(200).json({
        purchaseId: purchase.id,
        status: purchase.status,
        message: purchase.status === 'pending' ? 'Your M-Pesa payment is still processing.' : 'This gift-card purchase was already recorded.'
      });
    }
    if (paymentMethod === 'wallet') {
      return res.status(201).json({
        purchaseId: purchase.id,
        status: 'paid',
        amountKes,
        message: 'Your Valor gift card is ready. Copy its code from Your gifts and share it with the recipient.'
      });
    }
    try {
      const checkout = await paymentGateway.initiateStkPush({
        id: purchase.id,
        amountKes,
        phone,
        orderType: 'gift_card'
      });
      db.prepare('UPDATE gift_card_purchases SET checkout_request_id=?,merchant_request_id=? WHERE id=? AND status=?')
        .run(checkout.checkoutRequestId, checkout.merchantRequestId, purchase.id, 'pending');
      return res.status(201).json({
        purchaseId: purchase.id,
        status: 'pending',
        message: checkout.customerMessage
      });
    } catch (error) {
      db.transaction(() => {
        db.prepare("UPDATE gift_card_purchases SET status='failed' WHERE id=? AND status='pending'").run(purchase.id);
        db.prepare("UPDATE gift_cards SET status='revoked' WHERE purchase_id=? AND status='pending'").run(purchase.id);
      })();
      console.error('M-Pesa gift-card checkout could not be started:', error.message);
      return res.status(502).json({ error: 'M-Pesa could not start the gift-card payment. Please try again shortly.' });
    }
  });

  app.get('/api/gift-cards/mine', requireAccount, (req, res, next) => {
    try {
      const purchases = db.prepare(`
        SELECT p.id,p.amount_kes AS amountKes,p.payment_method AS paymentMethod,p.status,
          p.recipient_name AS recipientName,p.recipient_contact AS recipientContact,p.message,
          p.created_at AS createdAt,p.paid_at AS paidAt,g.id AS giftCardId,g.status AS cardStatus,
          (SELECT r.status FROM gift_refund_requests r WHERE r.instrument_type='gift_card'
            AND r.instrument_id=p.id LIMIT 1) AS refundStatus,
          g.code_ciphertext,g.code_nonce,g.code_auth_tag
        FROM gift_card_purchases p JOIN gift_cards g ON g.purchase_id=p.id
        WHERE p.account_id=? ORDER BY p.created_at DESC LIMIT 50
      `).all(req.account.id).map((purchase) => ({
        purchaseId: purchase.id,
        giftCardId: purchase.giftCardId,
        amountKes: purchase.amountKes,
        paymentMethod: purchase.paymentMethod,
        status: purchase.status,
        cardStatus: purchase.cardStatus,
        refundStatus: purchase.refundStatus,
        recipientName: purchase.recipientName,
        recipientContact: purchase.recipientContact,
        message: purchase.message,
        createdAt: purchase.createdAt,
        paidAt: purchase.paidAt,
        code: purchase.cardStatus === 'issued' ? revealGiftCode(purchase) : ''
      }));
      return res.json({ purchases });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/gift-cards/redeem', requireAccount, giftCodeAttemptLimiter, (req, res) => {
    const wallet = walletForAccount(req.account.id);
    if (!wallet) return res.status(409).json({ error: 'Link and verify a Valor Wallet before redeeming gift credit.' });
    const code = normalizeGiftCardCode(req.body && req.body.code);
    if (!/^VA[0-9A-F]{36}$/.test(code)) return res.status(400).json({ error: 'Enter a valid Valor gift-card code.' });
    try {
      const result = db.transaction(() => {
        const card = db.prepare(`
          SELECT id,amount_kes AS amountKes,status FROM gift_cards WHERE code_hash=?
        `).get(sha256(code));
        if (!card || card.status !== 'issued') {
          throw Object.assign(new Error('This gift-card code is invalid, already redeemed, or not yet paid.'), { statusCode: 404 });
        }
        const updated = db.prepare(`
          UPDATE gift_cards SET status='redeemed',redeemed_by_account_id=?,redeemed_at=datetime('now')
          WHERE id=? AND status='issued'
        `).run(req.account.id, card.id);
        if (updated.changes !== 1) throw Object.assign(new Error('This gift card has already been redeemed.'), { statusCode: 409 });
        const purchase = db.prepare('SELECT purchase_id AS purchaseId FROM gift_cards WHERE id=?').get(card.id);
        recordWalletTransaction(
          wallet.id, card.amountKes, 'gift_card_redemption', 'gift_card', card.id,
          `Valor gift card redeemed (${card.id})`
        );
        addGiftCardLedgerEntry(card.id, 'redeemed', -card.amountKes, req.account.id, wallet.id, 'Gift card value transferred to Valor Wallet.');
        return { ...card, purchaseId: purchase.purchaseId };
      })();
      const snapshot = walletSnapshot(wallet.id);
      return res.status(200).json({
        status: 'redeemed',
        amountKes: result.amountKes,
        purchaseId: result.purchaseId,
        balanceKes: snapshot.balanceKes,
        message: `KES ${result.amountKes.toLocaleString('en-KE')} Valor credit was added to your wallet.`
      });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      throw error;
    }
  });

  app.post('/api/gift-refunds', requireAccount, (req, res) => {
    const { instrumentType, instrumentId, reason } = req.body || {};
    if (!['gift_card','merchant_voucher'].includes(instrumentType) ||
        typeof instrumentId !== 'string' || !instrumentId ||
        typeof reason !== 'string' || !reason.trim() || reason.trim().length > 1000) {
      return res.status(400).json({ error: 'Choose a gift or voucher order and explain the refund request (1,000 characters maximum).' });
    }
    const owned = instrumentType === 'gift_card'
      ? db.prepare(`
        SELECT 1 FROM gift_cards g JOIN gift_card_purchases p ON p.id=g.purchase_id
        WHERE p.id=? AND p.account_id=? AND g.status='issued' AND p.status='paid'
      `).get(instrumentId, req.account.id)
      : db.prepare(`
        SELECT 1 FROM merchant_voucher_orders
        WHERE id=? AND account_id=? AND status='paid'
      `).get(instrumentId, req.account.id);
    if (!owned) return res.status(409).json({ error: 'Only paid, unused gift cards or voucher orders can be submitted for support review.' });
    try {
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO gift_refund_requests (id,account_id,instrument_type,instrument_id,reason)
        VALUES (?,?,?,?,?)
      `).run(id, req.account.id, instrumentType, instrumentId, reason.trim());
      return res.status(201).json({ requestId: id, status: 'pending', message: 'Your refund request was sent to Valor support for review.' });
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed')) {
        return res.status(409).json({ error: 'A refund request for this purchase is already on file.' });
      }
      throw error;
    }
  });

  app.get('/api/gift-vouchers', (req, res) => {
    const vouchers = db.prepare(`
      SELECT v.id,v.title,v.description,v.face_value_kes AS faceValueKes,
        v.sale_price_kes AS salePriceKes,v.redemption_instructions AS redemptionInstructions,
        v.terms,m.id AS merchantId,m.business_name AS merchantName,m.website_url AS merchantWebsite,
        (SELECT COUNT(*) FROM merchant_voucher_codes c WHERE c.voucher_id=v.id AND c.status='available') AS stock
      FROM merchant_vouchers v JOIN gift_merchants m ON m.id=v.merchant_id
      WHERE v.active=1 AND m.status='approved'
        AND EXISTS (SELECT 1 FROM merchant_voucher_codes c WHERE c.voucher_id=v.id AND c.status='available')
      ORDER BY v.created_at DESC LIMIT 100
    `).all();
    return res.json({ vouchers });
  });

  app.post('/api/gift-merchants/applications', requireAccount, merchantApplicationLimiter, (req, res) => {
    const body = req.body || {};
    const businessName = typeof body.businessName === 'string' ? body.businessName.trim() : '';
    const websiteUrl = typeof body.websiteUrl === 'string' ? body.websiteUrl.trim() : '';
    const contactName = typeof body.contactName === 'string' ? body.contactName.trim() : '';
    const contactPhone = normalizePhone(body.contactPhone);
    const details = typeof body.details === 'string' ? body.details.trim() : '';
    if (!businessName || businessName.length > 160 || !contactName || contactName.length > 120 ||
        !contactPhone || !details || details.length > 2000) {
      return res.status(400).json({ error: 'Enter a business name, authorized contact, valid Kenyan contact number, and business details (2,000 characters maximum).' });
    }
    if (websiteUrl) {
      try {
        const website = new URL(websiteUrl);
        if (website.protocol !== 'https:' || website.hostname.length > 253) throw new Error('invalid');
      } catch (error) {
        return res.status(400).json({ error: 'Merchant websites must be valid HTTPS URLs.' });
      }
    }
    const id = crypto.randomUUID();
    try {
      db.prepare(`
        INSERT INTO gift_merchants (id,account_id,business_name,website_url,contact_name,contact_phone,application_details)
        VALUES (?,?,?,?,?,?,?)
      `).run(id, req.account.id, businessName, websiteUrl, contactName, contactPhone, details);
      return res.status(201).json({ merchantId: id, status: 'pending', message: 'Your merchant application was sent for verification.' });
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed')) {
        return res.status(409).json({ error: 'Your account already has a gift merchant application.' });
      }
      throw error;
    }
  });

  app.get('/api/gift-merchants/mine', requireAccount, (req, res) => {
    const merchant = db.prepare(`
      SELECT id,business_name AS businessName,website_url AS websiteUrl,contact_name AS contactName,
        contact_phone AS contactPhone,application_details AS applicationDetails,status,admin_note AS adminNote,
        created_at AS createdAt
      FROM gift_merchants WHERE account_id=?
    `).get(req.account.id);
    if (!merchant) return res.json({ merchant: null, vouchers: [], orders: [], dueKes: 0 });
    const vouchers = db.prepare(`
      SELECT v.id,v.title,v.description,v.face_value_kes AS faceValueKes,v.sale_price_kes AS salePriceKes,
        v.redemption_instructions AS redemptionInstructions,v.terms,v.active,
        (SELECT COUNT(*) FROM merchant_voucher_codes c WHERE c.voucher_id=v.id AND c.status='available') AS stock,
        (SELECT COUNT(*) FROM merchant_voucher_orders o WHERE o.voucher_id=v.id AND o.status='paid') AS sold
      FROM merchant_vouchers v WHERE v.merchant_id=? ORDER BY v.created_at DESC
    `).all(merchant.id);
    const orders = db.prepare(`
      SELECT o.id,o.voucher_title AS title,o.amount_kes AS amountKes,o.face_value_kes AS faceValueKes,
        o.status,o.payment_method AS paymentMethod,o.mpesa_receipt AS receipt,
        o.unused_confirmed AS unusedConfirmed,o.created_at AS createdAt,o.paid_at AS paidAt
      FROM merchant_voucher_orders o WHERE o.merchant_id=?
      ORDER BY o.created_at DESC LIMIT 100
    `).all(merchant.id);
    const refundRequests = db.prepare(`
      SELECT r.id AS requestId,r.reason,r.created_at AS createdAt,
        o.id AS orderId,o.voucher_title AS title,o.amount_kes AS amountKes,
        o.unused_confirmed AS unusedConfirmed
      FROM gift_refund_requests r
      JOIN merchant_voucher_orders o ON o.id=r.instrument_id
      WHERE r.instrument_type='merchant_voucher' AND r.status='pending' AND o.merchant_id=?
      ORDER BY r.created_at DESC LIMIT 100
    `).all(merchant.id);
    const totals = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN o.status='paid' THEN o.amount_kes ELSE 0 END),0) AS salesKes,
        COALESCE((SELECT SUM(p.amount_kes) FROM merchant_payouts p WHERE p.merchant_id=?),0) AS paidOutKes
      FROM merchant_voucher_orders o WHERE o.merchant_id=?
    `).get(merchant.id, merchant.id);
    return res.json({
      merchant,
      vouchers,
      orders,
      refundRequests,
      salesKes: totals.salesKes,
      paidOutKes: totals.paidOutKes,
      dueKes: totals.salesKes - totals.paidOutKes
    });
  });

  app.post('/api/gift-merchants/vouchers', requireAccount, (req, res) => {
    const merchant = db.prepare('SELECT id,status FROM gift_merchants WHERE account_id=?').get(req.account.id);
    if (!merchant || merchant.status !== 'approved') {
      return res.status(403).json({ error: 'Only approved gift merchants can list vouchers.' });
    }
    const body = req.body || {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const faceValueKes = body.faceValueKes;
    const salePriceKes = body.salePriceKes;
    const redemptionInstructions = typeof body.redemptionInstructions === 'string' ? body.redemptionInstructions.trim() : '';
    const terms = typeof body.terms === 'string' ? body.terms.trim() : '';
    if (!title || title.length > 120 || !description || description.length > 2000 ||
        !Number.isSafeInteger(faceValueKes) || faceValueKes < 1 ||
        !Number.isSafeInteger(salePriceKes) || salePriceKes < 1 || salePriceKes > faceValueKes ||
        !redemptionInstructions || redemptionInstructions.length > 2000 || terms.length > 2000) {
      return res.status(400).json({ error: 'Provide a title, description, face value, sale price no greater than face value, redemption instructions, and terms within the stated limits.' });
    }
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO merchant_vouchers (
        id,merchant_id,title,description,face_value_kes,sale_price_kes,
        redemption_instructions,terms,active
      ) VALUES (?,?,?,?,?,?,?,?,1)
    `).run(id, merchant.id, title, description, faceValueKes, salePriceKes, redemptionInstructions, terms);
    return res.status(201).json({ voucherId: id, active: true });
  });

  app.patch('/api/gift-merchants/vouchers/:id', requireAccount, (req, res) => {
    const merchant = db.prepare('SELECT id,status FROM gift_merchants WHERE account_id=?').get(req.account.id);
    const existing = merchant && db.prepare('SELECT * FROM merchant_vouchers WHERE id=? AND merchant_id=?').get(req.params.id, merchant.id);
    if (!existing) return res.status(404).json({ error: 'Voucher not found in your merchant account.' });
    if (merchant.status !== 'approved') return res.status(403).json({ error: 'Your merchant account must be approved to edit voucher listings.' });
    const body = req.body || {};
    const title = typeof body.title === 'string' ? body.title.trim() : existing.title;
    const description = typeof body.description === 'string' ? body.description.trim() : existing.description;
    const faceValueKes = body.faceValueKes === undefined ? existing.face_value_kes : body.faceValueKes;
    const salePriceKes = body.salePriceKes === undefined ? existing.sale_price_kes : body.salePriceKes;
    const redemptionInstructions = typeof body.redemptionInstructions === 'string'
      ? body.redemptionInstructions.trim()
      : existing.redemption_instructions;
    const terms = typeof body.terms === 'string' ? body.terms.trim() : existing.terms;
    const active = body.active === undefined ? Boolean(existing.active) : body.active;
    if (!title || title.length > 120 || !description || description.length > 2000 ||
        !Number.isSafeInteger(faceValueKes) || faceValueKes < 1 ||
        !Number.isSafeInteger(salePriceKes) || salePriceKes < 1 || salePriceKes > faceValueKes ||
        !redemptionInstructions || redemptionInstructions.length > 2000 || terms.length > 2000 ||
        typeof active !== 'boolean') {
      return res.status(400).json({ error: 'Voucher fields are invalid.' });
    }
    db.prepare(`
      UPDATE merchant_vouchers SET title=?,description=?,face_value_kes=?,sale_price_kes=?,
        redemption_instructions=?,terms=?,active=?,updated_at=datetime('now')
      WHERE id=? AND merchant_id=?
    `).run(title, description, faceValueKes, salePriceKes, redemptionInstructions, terms, active ? 1 : 0, existing.id, merchant.id);
    return res.json({ voucherId: existing.id, active });
  });

  app.post('/api/gift-merchants/vouchers/:id/inventory', requireAccount, (req, res, next) => {
    const merchant = db.prepare('SELECT id,status FROM gift_merchants WHERE account_id=?').get(req.account.id);
    const voucher = merchant && db.prepare('SELECT id FROM merchant_vouchers WHERE id=? AND merchant_id=?').get(req.params.id, merchant.id);
    if (!merchant || merchant.status !== 'approved' || !voucher) {
      return res.status(404).json({ error: 'Approved merchant voucher not found.' });
    }
    const codesValue = req.body && req.body.codes;
    if (typeof codesValue !== 'string' || codesValue.length > 12000) {
      return res.status(400).json({ error: 'Add up to 100 unique voucher codes, one per line.' });
    }
    const codes = codesValue.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (!codes.length || codes.length > 100 || codes.some((value) => value.length < 4 || value.length > 120 || /[\u0000-\u001f]/.test(value)) ||
        new Set(codes.map((value) => value.toUpperCase())).size !== codes.length) {
      return res.status(400).json({ error: 'Add 1–100 unique codes (4–120 characters each), one per line.' });
    }
    try {
      const protectedCodes = codes.map((code) => ({
        hash: sha256(code),
        ...protectGiftCode(code)
      }));
      db.transaction(() => {
        for (const code of protectedCodes) {
          db.prepare(`
            INSERT INTO merchant_voucher_codes (
              id,voucher_id,code_hash,code_ciphertext,code_nonce,code_auth_tag
            ) VALUES (?,?,?,?,?,?)
          `).run(
            crypto.randomUUID(), voucher.id, code.hash, code.codeCiphertext, code.codeNonce, code.codeAuthTag
          );
        }
      })();
      return res.status(201).json({ added: codes.length, message: 'Codes were encrypted and added to your inventory. Code values are not shown again.' });
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed')) {
        return res.status(409).json({ error: 'One or more codes already exist in marketplace inventory. No codes were added.' });
      }
      return next(error);
    }
  });

  app.post('/api/gift-merchants/refunds/:requestId/confirm-unused', requireAccount, (req, res) => {
    const merchant = db.prepare('SELECT id,status FROM gift_merchants WHERE account_id=?').get(req.account.id);
    if (!merchant || merchant.status !== 'approved') return res.status(403).json({ error: 'An approved merchant account is required.' });
    const request = db.prepare(`
      SELECT r.id,r.instrument_id AS instrumentId,o.id AS orderId
      FROM gift_refund_requests r JOIN merchant_voucher_orders o ON o.id=r.instrument_id
      WHERE r.id=? AND r.instrument_type='merchant_voucher' AND r.status='pending' AND o.merchant_id=?
    `).get(req.params.requestId, merchant.id);
    if (!request) return res.status(404).json({ error: 'Pending refund request not found for your merchant account.' });
    const updated = db.prepare('UPDATE merchant_voucher_orders SET unused_confirmed=1 WHERE id=? AND status=?')
      .run(request.orderId, 'paid');
    if (updated.changes !== 1) return res.status(409).json({ error: 'This voucher order is no longer eligible for unused confirmation.' });
    return res.json({ message: 'You confirmed the voucher is unused. Valor support will review the refund request.' });
  });

  app.post('/api/merchant-voucher-orders', requireAccount, giftPurchaseLimiter, async (req, res, next) => {
    const body = req.body || {};
    const voucherId = typeof body.voucherId === 'string' ? body.voucherId : '';
    const paymentMethod = body.paymentMethod || 'wallet';
    const clientRequestId = body.clientRequestId;
    const buyerName = typeof body.buyerName === 'string' ? body.buyerName.trim() : '';
    if (!voucherId || !buyerName || buyerName.length > 120 ||
        !['wallet','mpesa'].includes(paymentMethod) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientRequestId || '')) {
      return res.status(400).json({ error: 'Choose a voucher, enter your name, select a supported payment method, and refresh the purchase request.' });
    }
    const wallet = paymentMethod === 'wallet' ? walletForAccount(req.account.id) : null;
    if (paymentMethod === 'wallet' && !wallet) return res.status(409).json({ error: 'Link a Valor Wallet before paying with wallet balance.' });
    const phone = paymentMethod === 'wallet' ? wallet.phone : normalizePhone(body.phone);
    if (!phone) return res.status(400).json({ error: 'Enter a valid Kenyan M-Pesa number.' });
    if (paymentMethod === 'mpesa' && paymentsUnavailable(res)) return;
    let order;
    try {
      order = db.transaction(() => {
        const duplicate = db.prepare(`
          SELECT id,voucher_id AS voucherId,status,payment_method AS paymentMethod
          FROM merchant_voucher_orders WHERE account_id=? AND client_request_id=?
        `).get(req.account.id, clientRequestId);
        if (duplicate) {
          if (duplicate.voucherId !== voucherId || duplicate.paymentMethod !== paymentMethod) {
            throw Object.assign(new Error('This retry key was already used for a different voucher purchase. Refresh and try again.'), { statusCode: 409 });
          }
          return { ...duplicate, duplicate: true };
        }
        const voucher = db.prepare(`
          SELECT v.*,m.status AS merchantStatus,m.id AS merchantId
          FROM merchant_vouchers v JOIN gift_merchants m ON m.id=v.merchant_id
          WHERE v.id=? AND v.active=1 AND m.status='approved'
        `).get(voucherId);
        if (!voucher) throw Object.assign(new Error('This merchant voucher is unavailable.'), { statusCode: 404 });
        const code = db.prepare(`
          SELECT id FROM merchant_voucher_codes WHERE voucher_id=? AND status='available'
          ORDER BY created_at,id LIMIT 1
        `).get(voucherId);
        if (!code) throw Object.assign(new Error('This voucher just sold out. Refresh the listings.'), { statusCode: 409 });
        if (wallet) {
          const balanceKes = db.prepare("SELECT COALESCE(SUM(amount_kes),0) AS balance FROM wallet_transactions WHERE wallet_id=? AND status='completed'")
            .get(wallet.id).balance;
          if (balanceKes < voucher.sale_price_kes) {
            throw Object.assign(new Error('Your wallet balance is too low. Add funds and try again.'), { statusCode: 402 });
          }
        }
        const id = crypto.randomUUID();
        const status = paymentMethod === 'wallet' ? 'paid' : 'pending';
        db.prepare(`
          INSERT INTO merchant_voucher_orders (
            id,account_id,merchant_id,voucher_id,code_id,amount_kes,face_value_kes,voucher_title,
            redemption_instructions,voucher_terms,payment_method,status,client_request_id,buyer_name,phone,paid_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='paid' THEN datetime('now') END)
        `).run(
          id, req.account.id, voucher.merchantId, voucher.id, code.id, voucher.sale_price_kes,
          voucher.face_value_kes, voucher.title, voucher.redemption_instructions, voucher.terms,
          paymentMethod, status, clientRequestId, buyerName, phone, status
        );
        const reserved = db.prepare(`
          UPDATE merchant_voucher_codes SET status=?,order_id=? WHERE id=? AND status='available'
        `).run(status === 'paid' ? 'sold' : 'reserved', id, code.id);
        if (reserved.changes !== 1) throw Object.assign(new Error('This voucher just sold out. Refresh the listings.'), { statusCode: 409 });
        if (wallet) {
          recordWalletTransaction(
            wallet.id, -voucher.sale_price_kes, 'merchant_voucher_purchase',
            'merchant_voucher_order', id, `Merchant voucher: ${voucher.title}`
          );
        }
        if (status === 'paid') {
          db.prepare(`
            INSERT INTO merchant_voucher_ledger
              (id,merchant_id,order_id,transaction_type,amount_kes,reference_id,description)
            VALUES (?,?,?,'sale',?,?,?)
          `).run(`sale-${id}`, voucher.merchantId, id, voucher.sale_price_kes, id, 'Confirmed merchant voucher sale.');
        }
        return { id, amountKes: voucher.sale_price_kes, paymentMethod, status, duplicate: false };
      })();
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      return next(error);
    }
    if (order.duplicate) {
      return res.json({ orderId: order.id, status: order.status, message: 'This voucher purchase was already recorded.' });
    }
    if (paymentMethod === 'wallet') {
      return res.status(201).json({
        orderId: order.id,
        status: 'paid',
        amountKes: order.amountKes,
        message: 'Your voucher purchase is paid. View the code and redemption instructions in Your gifts.'
      });
    }
    try {
      const checkout = await paymentGateway.initiateStkPush({
        id: order.id,
        amountKes: order.amountKes,
        phone,
        orderType: 'merchant_voucher'
      });
      db.prepare('UPDATE merchant_voucher_orders SET checkout_request_id=?,merchant_request_id=? WHERE id=? AND status=?')
        .run(checkout.checkoutRequestId, checkout.merchantRequestId, order.id, 'pending');
      return res.status(201).json({ orderId: order.id, status: 'pending', message: checkout.customerMessage });
    } catch (error) {
      db.transaction(() => {
        db.prepare("UPDATE merchant_voucher_orders SET status='failed' WHERE id=? AND status='pending'").run(order.id);
        db.prepare("UPDATE merchant_voucher_codes SET status='available',order_id=NULL WHERE order_id=? AND status='reserved'").run(order.id);
      })();
      console.error('M-Pesa merchant voucher checkout could not be started:', error.message);
      return res.status(502).json({ error: 'M-Pesa could not start the voucher payment. Please try again shortly.' });
    }
  });

  app.get('/api/merchant-voucher-orders/mine', requireAccount, (req, res, next) => {
    try {
      const orders = db.prepare(`
        SELECT o.id,o.voucher_title AS title,o.amount_kes AS amountKes,o.face_value_kes AS faceValueKes,
          o.redemption_instructions AS redemptionInstructions,o.voucher_terms AS terms,
          o.status,o.mpesa_receipt AS receipt,o.created_at AS createdAt,o.paid_at AS paidAt,
          (SELECT r.status FROM gift_refund_requests r WHERE r.instrument_type='merchant_voucher'
            AND r.instrument_id=o.id LIMIT 1) AS refundStatus,
          m.business_name AS merchantName,m.website_url AS merchantWebsite,
          c.code_ciphertext,c.code_nonce,c.code_auth_tag
        FROM merchant_voucher_orders o
        JOIN gift_merchants m ON m.id=o.merchant_id
        JOIN merchant_voucher_codes c ON c.id=o.code_id
        WHERE o.account_id=? ORDER BY o.created_at DESC LIMIT 50
      `).all(req.account.id).map((order) => ({
        orderId: order.id,
        title: order.title,
        amountKes: order.amountKes,
        faceValueKes: order.faceValueKes,
        redemptionInstructions: order.redemptionInstructions,
        terms: order.terms,
        status: order.status,
        refundStatus: order.refundStatus,
        receipt: order.receipt,
        createdAt: order.createdAt,
        paidAt: order.paidAt,
        merchantName: order.merchantName,
        merchantWebsite: order.merchantWebsite,
        code: order.status === 'paid' ? revealGiftCode(order) : ''
      }));
      return res.json({ orders });
    } catch (error) {
      return next(error);
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
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'Choose a password between 8 and 128 characters.' });
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
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'Choose a password between 8 and 128 characters.' });
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

  function affiliateEarnings(partnerId) {
    const earnedKes = db.prepare(`
      SELECT COALESCE(SUM(ROUND(amount_kes * affiliate_commission_percent / 100.0)),0) AS amount
      FROM orders
      WHERE affiliate_partner_id=? AND order_type='ticket' AND status IN ('paid','confirmed')
    `).get(partnerId).amount;
    const paidKes = db.prepare('SELECT COALESCE(SUM(amount_kes),0) AS amount FROM affiliate_payouts WHERE partner_id=?')
      .get(partnerId).amount;
    return { earnedKes, paidKes, dueKes: Math.max(0, earnedKes - paidKes) };
  }

  app.post('/api/partners/visit', partnerReferralLimiter, (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    if (!/^[A-F0-9]{10}$/.test(code)) return res.status(400).json({ error: 'Enter a valid partner referral link.' });
    const partner = db.prepare(`
      SELECT id FROM affiliate_partners
      WHERE referral_code=? AND status='approved' AND commission_percent IS NOT NULL
    `).get(code);
    if (!partner) return res.status(404).json({ error: 'This partner referral link is not active.' });
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
    db.prepare(`
      INSERT INTO affiliate_referral_visits (token_hash,partner_id,expires_at)
      VALUES (?,?,?)
    `).run(sha256(token), partner.id, expiresAt);
    res.status(201).json({ referralToken: token, expiresAt });
  });

  app.get('/api/partners/me', requireAccount, (req, res) => {
    const partner = db.prepare(`
      SELECT id,social_platform AS socialPlatform,profile_url AS profileUrl,
        audience_description AS audienceDescription,status,referral_code AS referralCode,
        commission_percent AS commissionPercent,admin_note AS adminNote,
        created_at AS createdAt,reviewed_at AS reviewedAt
      FROM affiliate_partners WHERE account_id=?
    `).get(req.account.id);
    if (!partner) return res.json({ partner: null });
    const totals = affiliateEarnings(partner.id);
    const clicks = db.prepare('SELECT COUNT(*) AS count FROM affiliate_referral_visits WHERE partner_id=?')
      .get(partner.id).count;
    const conversions = db.prepare(`
      SELECT COUNT(*) AS count FROM orders
      WHERE affiliate_partner_id=? AND order_type='ticket' AND amount_kes>0 AND status IN ('paid','confirmed')
    `).get(partner.id).count;
    const payouts = db.prepare(`
      SELECT amount_kes AS amountKes,reference,note,created_at AS createdAt
      FROM affiliate_payouts WHERE partner_id=? ORDER BY created_at DESC LIMIT 50
    `).all(partner.id);
    res.json({
      partner: {
        ...partner,
        referralUrl: partner.referralCode ? `${publicSiteUrl}/events.html?ref=${partner.referralCode}` : null,
        clicks,
        conversions,
        ...totals,
        payouts
      }
    });
  });

  app.post('/api/partners/apply', requireAccount, partnerApplicationLimiter, (req, res) => {
    const socialPlatform = req.body?.socialPlatform;
    const profileUrl = typeof req.body?.profileUrl === 'string' ? req.body.profileUrl.trim() : '';
    const audienceDescription = typeof req.body?.audienceDescription === 'string' ? req.body.audienceDescription.trim() : '';
    if (!['Instagram','TikTok','YouTube','Facebook','Other'].includes(socialPlatform)) {
      return res.status(400).json({ error: 'Choose a supported social platform.' });
    }
    if (profileUrl.length > 2048) return res.status(400).json({ error: 'Profile link must be 2,048 characters or fewer.' });
    try {
      const url = new URL(profileUrl);
      if (url.protocol !== 'https:') return res.status(400).json({ error: 'Use a secure HTTPS link to your public profile.' });
    } catch (error) {
      return res.status(400).json({ error: 'Enter a valid public social profile link.' });
    }
    if (audienceDescription.length < 20 || audienceDescription.length > 1500) {
      return res.status(400).json({ error: 'Describe your audience and how you would promote events (20–1,500 characters).' });
    }
    const existing = db.prepare('SELECT id,status FROM affiliate_partners WHERE account_id=?').get(req.account.id);
    if (existing && existing.status !== 'rejected') {
      return res.status(409).json({ error: 'You already have a creator partnership application or account.' });
    }
    const id = existing ? existing.id : crypto.randomUUID();
    if (existing) {
      db.prepare(`
        UPDATE affiliate_partners SET social_platform=?,profile_url=?,audience_description=?,
          status='pending',admin_note='',reviewed_at=NULL WHERE id=?
      `).run(socialPlatform, profileUrl, audienceDescription, id);
    } else {
      db.prepare(`
        INSERT INTO affiliate_partners (id,account_id,social_platform,profile_url,audience_description)
        VALUES (?,?,?,?,?)
      `).run(id, req.account.id, socialPlatform, profileUrl, audienceDescription);
    }
    res.status(201).json({ message: 'Your creator partnership application was received. We will review it and agree any commission terms before activation.' });
  });

  app.get('/api/partnership-applications/me', requireAccount, (req, res) => {
    const applications = db.prepare(`
      SELECT id,application_type AS type,organization_name AS organizationName,
        website_url AS websiteUrl,application_details AS applicationDetails,
        requested_support AS requestedSupport,status,admin_note AS adminNote,
        created_at AS createdAt,updated_at AS updatedAt,reviewed_at AS reviewedAt
      FROM partnership_applications WHERE account_id=? ORDER BY application_type
    `).all(req.account.id);
    res.json({ applications });
  });

  app.post('/api/partnership-applications', requireAccount, partnerApplicationLimiter, (req, res) => {
    const type = req.body?.type;
    const organizationName = typeof req.body?.organizationName === 'string' ? req.body.organizationName.trim() : '';
    const websiteUrl = typeof req.body?.websiteUrl === 'string' ? req.body.websiteUrl.trim() : '';
    const applicationDetails = typeof req.body?.applicationDetails === 'string' ? req.body.applicationDetails.trim() : '';
    const requestedSupport = typeof req.body?.requestedSupport === 'string' ? req.body.requestedSupport.trim() : '';
    if (!['organizer','sponsor'].includes(type)) return res.status(400).json({ error: 'Choose organizer partner or event sponsor.' });
    if (!organizationName || organizationName.length > 160) {
      return res.status(400).json({ error: 'Organization name is required and must be 160 characters or fewer.' });
    }
    if (websiteUrl) {
      if (websiteUrl.length > 2048) return res.status(400).json({ error: 'Website link must be 2,048 characters or fewer.' });
      try {
        if (new URL(websiteUrl).protocol !== 'https:') return res.status(400).json({ error: 'Website links must use HTTPS.' });
      } catch (error) {
        return res.status(400).json({ error: 'Enter a valid HTTPS website link.' });
      }
    }
    if (applicationDetails.length < 30 || applicationDetails.length > 3000) {
      return res.status(400).json({ error: 'Tell us about your organization and proposal (30–3,000 characters).' });
    }
    if (requestedSupport.length > 1000) return res.status(400).json({ error: 'Requested support must be 1,000 characters or fewer.' });
    const existing = db.prepare(`
      SELECT id,status FROM partnership_applications WHERE account_id=? AND application_type=?
    `).get(req.account.id, type);
    if (existing && existing.status !== 'rejected') {
      return res.status(409).json({ error: `You already have a ${type} partnership inquiry in progress.` });
    }
    const id = existing ? existing.id : crypto.randomUUID();
    if (existing) {
      db.prepare(`
        UPDATE partnership_applications SET organization_name=?,website_url=?,application_details=?,
          requested_support=?,status='pending',admin_note='',updated_at=datetime('now'),
          reviewed_at=NULL WHERE id=?
      `).run(organizationName, websiteUrl, applicationDetails, requestedSupport, id);
    } else {
      db.prepare(`
        INSERT INTO partnership_applications
          (id,account_id,application_type,organization_name,website_url,application_details,requested_support)
        VALUES (?,?,?,?,?,?,?)
      `).run(id, req.account.id, type, organizationName, websiteUrl, applicationDetails, requestedSupport);
    }
    res.status(201).json({
      id,
      status: 'pending',
      message: `Your ${type === 'organizer' ? 'organizer partnership' : 'sponsorship'} inquiry was received. Our team will contact you to discuss fit and any terms; no package or price is committed by this application.`
    });
  });

  app.get('/api/partnership-applications/admin', requireAdmin, (req, res) => {
    const type = ['organizer','sponsor'].includes(req.query.type) ? req.query.type : null;
    const applications = (type
      ? db.prepare(`
          SELECT p.id,p.account_id AS accountId,a.email,a.display_name AS displayName,
            p.application_type AS type,p.organization_name AS organizationName,
            p.website_url AS websiteUrl,p.application_details AS applicationDetails,
            p.requested_support AS requestedSupport,p.status,p.admin_note AS adminNote,
            p.created_at AS createdAt,p.updated_at AS updatedAt
          FROM partnership_applications p JOIN accounts a ON a.id=p.account_id
          WHERE p.application_type=? ORDER BY p.created_at DESC LIMIT 500
        `).all(type)
      : db.prepare(`
          SELECT p.id,p.account_id AS accountId,a.email,a.display_name AS displayName,
            p.application_type AS type,p.organization_name AS organizationName,
            p.website_url AS websiteUrl,p.application_details AS applicationDetails,
            p.requested_support AS requestedSupport,p.status,p.admin_note AS adminNote,
            p.created_at AS createdAt,p.updated_at AS updatedAt
          FROM partnership_applications p JOIN accounts a ON a.id=p.account_id
          ORDER BY CASE p.status WHEN 'pending' THEN 0 WHEN 'contacted' THEN 1 ELSE 2 END,p.created_at DESC
          LIMIT 500
        `).all());
    res.json({ applications });
  });

  app.patch('/api/partnership-applications/admin/:id', requireAdmin, (req, res) => {
    const existing = db.prepare('SELECT id FROM partnership_applications WHERE id=?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Partnership application not found.' });
    const { status, adminNote = '' } = req.body || {};
    if (!['contacted','approved','rejected','closed'].includes(status)) {
      return res.status(400).json({ error: 'Choose contacted, approved, rejected, or closed status.' });
    }
    if (typeof adminNote !== 'string' || adminNote.length > 1000) {
      return res.status(400).json({ error: 'Admin note must be 1,000 characters or fewer.' });
    }
    db.prepare(`
      UPDATE partnership_applications SET status=?,admin_note=?,updated_at=datetime('now'),
        reviewed_at=datetime('now') WHERE id=?
    `).run(status, adminNote.trim(), existing.id);
    res.json({ id: existing.id, status, message: 'Partnership application updated.' });
  });

  app.get('/api/partners/admin', requireAdmin, (req, res) => {
    const partners = db.prepare(`
      SELECT p.id,p.account_id AS accountId,a.email,a.display_name AS displayName,
        p.social_platform AS socialPlatform,p.profile_url AS profileUrl,
        p.audience_description AS audienceDescription,p.status,p.referral_code AS referralCode,
        p.commission_percent AS commissionPercent,p.admin_note AS adminNote,
        p.created_at AS createdAt,p.reviewed_at AS reviewedAt,
        (SELECT COUNT(*) FROM affiliate_referral_visits v WHERE v.partner_id=p.id) AS clicks,
        (SELECT COUNT(*) FROM orders o WHERE o.affiliate_partner_id=p.id AND o.order_type='ticket'
          AND o.amount_kes>0 AND o.status IN ('paid','confirmed')) AS conversions,
        (SELECT COALESCE(SUM(ROUND(o.amount_kes * o.affiliate_commission_percent / 100.0)),0)
          FROM orders o WHERE o.affiliate_partner_id=p.id AND o.order_type='ticket'
          AND o.status IN ('paid','confirmed')) AS earnedKes,
        (SELECT COALESCE(SUM(amount_kes),0) FROM affiliate_payouts ap WHERE ap.partner_id=p.id) AS paidKes
      FROM affiliate_partners p JOIN accounts a ON a.id=p.account_id
      ORDER BY CASE p.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,p.created_at DESC
      LIMIT 500
    `).all();
    res.json({
      partners: partners.map((partner) => ({
        ...partner,
        dueKes: Math.max(0, partner.earnedKes - partner.paidKes),
        referralUrl: partner.referralCode ? `${publicSiteUrl}/events.html?ref=${partner.referralCode}` : null
      }))
    });
  });

  app.patch('/api/partners/admin/:id', requireAdmin, (req, res) => {
    const existing = db.prepare('SELECT * FROM affiliate_partners WHERE id=?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Creator partner not found.' });
    const { status, commissionPercent, adminNote = '' } = req.body || {};
    if (!['approved','rejected','suspended'].includes(status)) {
      return res.status(400).json({ error: 'Choose approved, rejected, or suspended status.' });
    }
    if (typeof adminNote !== 'string' || adminNote.length > 1000) {
      return res.status(400).json({ error: 'Admin note must be 1,000 characters or fewer.' });
    }
    if (status === 'approved' && (!Number.isFinite(commissionPercent) || commissionPercent <= 0 || commissionPercent > 100)) {
      return res.status(400).json({ error: 'Enter the individually agreed commission rate (greater than 0 and no more than 100 percent).' });
    }
    let referralCode = existing.referral_code;
    if (status === 'approved' && !referralCode) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = crypto.randomBytes(5).toString('hex').toUpperCase();
        if (!db.prepare('SELECT 1 FROM affiliate_partners WHERE referral_code=?').get(candidate)) {
          referralCode = candidate;
          break;
        }
      }
      if (!referralCode) return res.status(503).json({ error: 'Could not allocate a unique referral code. Please retry.' });
    }
    db.prepare(`
      UPDATE affiliate_partners SET status=?,commission_percent=?,referral_code=?,admin_note=?,
        reviewed_at=datetime('now') WHERE id=?
    `).run(status, status === 'approved' ? commissionPercent : existing.commission_percent, referralCode, adminNote.trim(), existing.id);
    res.json({ id: existing.id, status, commissionPercent: status === 'approved' ? commissionPercent : existing.commission_percent, referralCode });
  });

  app.post('/api/partners/admin/:id/payout', requireAdmin, (req, res) => {
    const partner = db.prepare('SELECT id,status FROM affiliate_partners WHERE id=?').get(req.params.id);
    if (!partner) return res.status(404).json({ error: 'Creator partner not found.' });
    const { amountKes, reference, note = '' } = req.body || {};
    if (!Number.isSafeInteger(amountKes) || amountKes < 1) {
      return res.status(400).json({ error: 'Payout amount must be a positive whole KES amount.' });
    }
    if (typeof reference !== 'string' || !reference.trim() || reference.trim().length > 120) {
      return res.status(400).json({ error: 'Enter the payout receipt or reference (120 characters maximum).' });
    }
    if (typeof note !== 'string' || note.length > 500) {
      return res.status(400).json({ error: 'Payout note must be 500 characters or fewer.' });
    }
    try {
      db.transaction(() => {
        const totals = affiliateEarnings(partner.id);
        if (db.prepare('SELECT 1 FROM affiliate_payouts WHERE partner_id=? AND reference=?').get(partner.id, reference.trim())) {
          throw Object.assign(new Error('That payout reference has already been recorded for this partner.'), { statusCode: 409 });
        }
        if (amountKes > totals.dueKes) {
          throw Object.assign(new Error(`Payout cannot exceed the KES ${totals.dueKes.toLocaleString('en-KE')} balance due.`), { statusCode: 409 });
        }
        db.prepare(`
          INSERT INTO affiliate_payouts (id,partner_id,amount_kes,reference,note,admin_id)
          VALUES (?,?,?,?,?,?)
        `).run(crypto.randomUUID(), partner.id, amountKes, reference.trim(), note.trim(), req.admin.sub);
      })();
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      throw error;
    }
    res.status(201).json({ message: 'Manual payout recorded.' });
  });

  app.get('/api/events', (req, res) => {
    const rows = db.prepare(`
      SELECT * FROM events WHERE status = 'approved' AND deleted_at IS NULL
        AND julianday(starts_at) > julianday('now') AND julianday(ends_at) > julianday('now')
      ORDER BY starts_at ASC LIMIT 100
    `).all();
    res.json({ events: rows.map(publicEvent) });
  });

  app.get('/api/events/:eventId/reviews', (req, res, next) => {
    try {
      const eventExists = db.prepare(`SELECT 1 FROM events WHERE id=? LIMIT 1`).get(req.params.eventId);
      if (!eventExists) return res.status(404).json({ error: 'This event is not available.' });
      const summary = db.prepare(`
        SELECT
          COUNT(*) AS loveCount,
          COUNT(rating) AS ratingCount,
          AVG(rating) AS averageRating,
          SUM(CASE WHEN TRIM(review) <> '' THEN 1 ELSE 0 END) AS reviewCount
        FROM event_feedback
        WHERE event_id=? AND (loved=1 OR rating IS NOT NULL OR TRIM(review) <> '')
      `).get(req.params.eventId);
      const reviews = db.prepare(`
        SELECT COALESCE(NULLIF(TRIM(a.display_name), ''), 'Valor attendee') AS displayName,
          f.rating,f.review,f.updated_at AS updatedAt
        FROM event_feedback f
        JOIN accounts a ON a.id=f.account_id
        WHERE f.event_id=? AND TRIM(f.review) <> ''
        ORDER BY datetime(f.updated_at) DESC
        LIMIT 20
      `).all(req.params.eventId);
      res.json({
        averageRating: summary.averageRating === null ? null : Number(Number(summary.averageRating).toFixed(1)),
        ratingCount: summary.ratingCount || 0,
        loveCount: summary.loveCount || 0,
        reviewCount: summary.reviewCount || 0,
        reviews: reviews.map((review) => ({
          displayName: review.displayName,
          rating: review.rating,
          review: review.review,
          updatedAt: review.updatedAt
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/events/by-slug/:slug', (req, res) => {
    const row = db.prepare(`
      SELECT * FROM events WHERE slug = ? AND status = 'approved' AND deleted_at IS NULL
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
          WHERE o.event_id=e.id AND o.order_type='ticket' AND o.status IN ('paid','confirmed')) AS gross_kes,
        (SELECT COUNT(*) FROM orders o
          WHERE o.event_id=e.id AND o.order_type='ticket' AND o.status IN ('pending','paid','confirmed','review')) AS active_orders,
        (SELECT COUNT(*) FROM ad_bookings b
          WHERE b.event_id=e.id AND b.status IN ('pending_payment','active')) AS active_promotions
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
        grossKes: event.gross_kes,
        archived: Boolean(event.deleted_at),
        regularPrice: event.regular_price,
        earlyBirdPrice: event.early_bird_price,
        earlyBirdEnds: event.early_bird_ends,
        vipPrice: event.vip_price,
        organizerName: event.organizer_name,
        organizerEmail: event.organizer_email,
        organizerPhone: event.organizer_phone,
        hasActiveOrders: event.active_orders > 0,
        hasActivePromotion: event.active_promotions > 0
      }))
    });
  });

  function eventHasActiveOrders(eventId) {
    return Boolean(db.prepare(`
      SELECT 1 FROM orders
      WHERE event_id=? AND order_type='ticket' AND status IN ('pending','paid','confirmed','review')
      LIMIT 1
    `).get(eventId));
  }

  function eventHasActiveAdvertising(eventId) {
    return Boolean(db.prepare(`
      SELECT 1 FROM ad_bookings WHERE event_id=? AND status IN ('pending_payment','active') LIMIT 1
    `).get(eventId));
  }

  app.patch('/api/events/mine/:id', requireAccount, (req, res, next) => {
    imageUpload(req, res, (error) => {
      if (error) return next(error);
      const existing = db.prepare(`
        SELECT * FROM events WHERE id=? AND organizer_account_id=? AND deleted_at IS NULL
      `).get(req.params.id, req.account.id);
      if (!existing) return res.status(404).json({ error: 'Event not found in your organizer account.' });
      if (eventHasActiveOrders(existing.id)) {
        return res.status(409).json({ error: 'This event has ticket orders in progress or tickets sold. Contact Valor Africa support before changing event details.' });
      }
      if (eventHasActiveAdvertising(existing.id)) {
        return res.status(409).json({ error: 'This event has an active or pending promotion. Contact Valor Africa support before changing event details.' });
      }
      if (req.file && !validImage(req.file.buffer)) return res.status(400).json({ error: 'The uploaded file is not a supported image.' });
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
      const slug = input.slug.trim() || slugify(input.title);
      const posterUrl = req.file
        ? `/uploads/events/${req.params.id}-${crypto.randomUUID()}.${validImage(req.file.buffer)}`
        : existing.poster_url;
      if (req.file) {
        try {
          fs.writeFileSync(path.join(uploadDirectory, path.basename(posterUrl)), req.file.buffer);
        } catch (writeError) {
          return next(writeError);
        }
      }
      try {
        db.prepare(`
          UPDATE events SET
            slug=@slug,title=@title,description=@description,category=@category,format=@format,
            timezone=@timezone,starts_at=@startsAt,ends_at=@endsAt,venue_name=@venueName,
            meeting_url=@meetingUrl,city=@city,capacity=@capacity,regular_price=@regularPrice,
            early_bird_price=@earlyBirdPrice,early_bird_ends=@earlyBirdEnds,vip_price=@vipPrice,
            tags_json=@tags,poster_url=@posterUrl,organizer_name=@organizerName,
            organizer_email=@organizerEmail,organizer_phone=@organizerPhone,updated_at=datetime('now')
          WHERE id=@id AND organizer_account_id=@organizerAccountId AND deleted_at IS NULL
        `).run({
          ...input,
          id: existing.id,
          organizerAccountId: req.account.id,
          slug,
          startsAt: new Date(input.startsAt).toISOString(),
          endsAt: new Date(input.endsAt).toISOString(),
          capacity: input.capacity ? Number(input.capacity) : null,
          regularPrice: Number(input.regularPrice),
          earlyBirdPrice: input.earlyBirdPrice ? Number(input.earlyBirdPrice) : null,
          earlyBirdEnds: input.earlyBirdPrice ? new Date(input.earlyBirdEnds).toISOString() : null,
          vipPrice: input.vipPrice ? Number(input.vipPrice) : null,
          tags: JSON.stringify(input.tags.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 12)),
          posterUrl
        });
      } catch (updateError) {
        if (req.file) {
          try {
            fs.unlinkSync(path.join(uploadDirectory, path.basename(posterUrl)));
          } catch (cleanupError) {
            console.error('Could not remove an unlinked event poster:', cleanupError.message);
          }
        }
        if (updateError.errcode === 2067 || updateError.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/.test(updateError.message)) {
          return res.status(409).json({ error: 'That event URL is already in use. Choose a different slug.' });
        }
        throw updateError;
      }
      if (req.file && existing.poster_url.startsWith('/uploads/events/')) {
        try {
          fs.unlinkSync(path.join(uploadDirectory, path.basename(existing.poster_url)));
        } catch (cleanupError) {
          if (cleanupError.code !== 'ENOENT') console.error('Could not remove the replaced event poster:', cleanupError.message);
        }
      }
      res.json({ id: existing.id, slug, status: existing.status, message: 'Your event changes have been saved.' });
    });
  });

  app.delete('/api/events/mine/:id', requireAccount, (req, res) => {
    const existing = db.prepare(`
      SELECT id FROM events WHERE id=? AND organizer_account_id=? AND deleted_at IS NULL
    `).get(req.params.id, req.account.id);
    if (!existing) return res.status(404).json({ error: 'Event not found in your organizer account.' });
    if (eventHasActiveOrders(existing.id)) {
      return res.status(409).json({ error: 'This event has ticket orders in progress or tickets sold. Contact Valor Africa support before removing it.' });
    }
    if (eventHasActiveAdvertising(existing.id)) {
      return res.status(409).json({ error: 'This event has an active or pending promotion. Contact Valor Africa support before removing it.' });
    }
    db.prepare('UPDATE events SET deleted_at=datetime(\'now\'),updated_at=datetime(\'now\') WHERE id=? AND organizer_account_id=?')
      .run(existing.id, req.account.id);
    res.json({ id: existing.id, archived: true, message: 'The event has been removed from public listings. Its records have been retained.' });
  });

  app.post('/api/events/submissions', requireAccount, submissionLimiter, (req, res, next) => {
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
            organizer_phone, organizer_account_id, status
          ) VALUES (
            @id, @slug, @title, @description, @category, @format, @timezone, @startsAt, @endsAt,
            @venueName, @meetingUrl, @city, @capacity, @regularPrice, @earlyBirdPrice,
            @earlyBirdEnds, @vipPrice, @tags, @posterUrl, @organizerName, @organizerEmail,
            @organizerPhone, @organizerAccountId, 'approved'
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
          organizerAccountId: req.account.id
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
      res.status(201).json({
        id,
        slug,
        status: 'approved',
        message: 'Your event is now live on Valor Africa.'
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

  app.get('/api/gift-merchants/admin', requireAdmin, (req, res) => {
    const merchants = db.prepare(`
      SELECT m.id,m.business_name AS businessName,m.website_url AS websiteUrl,
        m.contact_name AS contactName,m.contact_phone AS contactPhone,
        m.application_details AS applicationDetails,m.status,m.admin_note AS adminNote,
        m.created_at AS createdAt,a.email,
        COALESCE((SELECT SUM(o.amount_kes) FROM merchant_voucher_orders o
          WHERE o.merchant_id=m.id AND o.status='paid'),0) AS salesKes,
        COALESCE((SELECT SUM(p.amount_kes) FROM merchant_payouts p WHERE p.merchant_id=m.id),0) AS paidOutKes
      FROM gift_merchants m JOIN accounts a ON a.id=m.account_id
      ORDER BY CASE m.status WHEN 'pending' THEN 0 ELSE 1 END,m.created_at DESC LIMIT 200
    `).all().map((merchant) => ({
      ...merchant,
      dueKes: merchant.salesKes - merchant.paidOutKes,
      voucherCount: db.prepare('SELECT COUNT(*) AS count FROM merchant_vouchers WHERE merchant_id=?').get(merchant.id).count
    }));
    return res.json({ merchants });
  });

  app.patch('/api/gift-merchants/admin/:id', requireAdmin, (req, res) => {
    const { status, adminNote = '' } = req.body || {};
    if (!['approved','rejected','suspended'].includes(status)) {
      return res.status(400).json({ error: 'Choose approved, rejected, or suspended merchant status.' });
    }
    if (typeof adminNote !== 'string' || adminNote.length > 1000) {
      return res.status(400).json({ error: 'Admin note must be 1,000 characters or fewer.' });
    }
    const merchant = db.prepare('SELECT id FROM gift_merchants WHERE id=?').get(req.params.id);
    if (!merchant) return res.status(404).json({ error: 'Gift merchant not found.' });
    db.prepare(`
      UPDATE gift_merchants SET status=?,admin_note=?,reviewed_at=datetime('now') WHERE id=?
    `).run(status, adminNote.trim(), merchant.id);
    return res.json({ merchantId: merchant.id, status });
  });

  app.get('/api/gift-vouchers/admin', requireAdmin, (req, res) => {
    const vouchers = db.prepare(`
      SELECT v.id,v.title,v.description,v.face_value_kes AS faceValueKes,
        v.sale_price_kes AS salePriceKes,v.active,v.created_at AS createdAt,
        m.id AS merchantId,m.business_name AS merchantName,m.status AS merchantStatus,
        (SELECT COUNT(*) FROM merchant_voucher_codes c WHERE c.voucher_id=v.id AND c.status='available') AS stock,
        (SELECT COUNT(*) FROM merchant_voucher_orders o WHERE o.voucher_id=v.id AND o.status='paid') AS sold
      FROM merchant_vouchers v JOIN gift_merchants m ON m.id=v.merchant_id
      ORDER BY v.created_at DESC LIMIT 500
    `).all();
    return res.json({ vouchers });
  });

  app.patch('/api/gift-vouchers/admin/:id', requireAdmin, (req, res) => {
    if (typeof (req.body && req.body.active) !== 'boolean') {
      return res.status(400).json({ error: 'Choose whether the voucher listing should be active.' });
    }
    const voucher = db.prepare('SELECT id FROM merchant_vouchers WHERE id=?').get(req.params.id);
    if (!voucher) return res.status(404).json({ error: 'Merchant voucher not found.' });
    db.prepare("UPDATE merchant_vouchers SET active=?,updated_at=datetime('now') WHERE id=?")
      .run(req.body.active ? 1 : 0, voucher.id);
    return res.json({ voucherId: voucher.id, active: req.body.active });
  });

  app.get('/api/gift-payouts/admin', requireAdmin, (req, res) => {
    const merchants = db.prepare(`
      SELECT m.id AS merchantId,m.business_name AS businessName,m.status,
        COALESCE((SELECT SUM(o.amount_kes) FROM merchant_voucher_orders o
          WHERE o.merchant_id=m.id AND o.status='paid'),0) AS salesKes,
        COALESCE((SELECT SUM(p.amount_kes) FROM merchant_payouts p WHERE p.merchant_id=m.id),0) AS paidOutKes
      FROM gift_merchants m ORDER BY m.business_name COLLATE NOCASE
    `).all().map((merchant) => ({
      ...merchant,
      dueKes: merchant.salesKes - merchant.paidOutKes,
      payouts: db.prepare(`
        SELECT amount_kes AS amountKes,reference,note,created_at AS createdAt
        FROM merchant_payouts WHERE merchant_id=? ORDER BY created_at DESC LIMIT 20
      `).all(merchant.merchantId)
    }));
    return res.json({ merchants });
  });

  app.post('/api/gift-payouts/admin/:merchantId', requireAdmin, (req, res) => {
    const { amountKes, reference, note = '' } = req.body || {};
    if (!Number.isSafeInteger(amountKes) || amountKes < 1 ||
        typeof reference !== 'string' || !reference.trim() || reference.trim().length > 120 ||
        typeof note !== 'string' || note.length > 500) {
      return res.status(400).json({ error: 'Enter a positive whole-KES payout, payment reference (120 characters maximum), and note (500 characters maximum).' });
    }
    try {
      const merchant = db.prepare('SELECT id FROM gift_merchants WHERE id=? AND status=\'approved\'').get(req.params.merchantId);
      if (!merchant) return res.status(404).json({ error: 'Approved gift merchant not found.' });
      db.transaction(() => {
        const totals = db.prepare(`
          SELECT COALESCE((SELECT SUM(amount_kes) FROM merchant_voucher_orders
            WHERE merchant_id=? AND status='paid'),0) -
            COALESCE((SELECT SUM(amount_kes) FROM merchant_payouts WHERE merchant_id=?),0) AS dueKes
        `).get(merchant.id, merchant.id);
        if (amountKes > totals.dueKes) {
          throw Object.assign(new Error(`Payout cannot exceed the KES ${totals.dueKes.toLocaleString('en-KE')} amount due.`), { statusCode: 409 });
        }
        const payoutId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO merchant_payouts (id,merchant_id,amount_kes,reference,note,admin_id)
          VALUES (?,?,?,?,?,?)
        `).run(payoutId, merchant.id, amountKes, reference.trim(), note.trim(), req.admin.sub);
        let remainingKes = amountKes;
        const orders = db.prepare(`
          SELECT id,amount_kes AS amountKes FROM merchant_voucher_orders
          WHERE merchant_id=? AND status='paid' ORDER BY paid_at,id
        `).all(merchant.id);
        for (const order of orders) {
          if (!remainingKes) break;
          const previouslyPaidKes = db.prepare(`
            SELECT COALESCE(-SUM(amount_kes),0) AS amountKes
            FROM merchant_voucher_ledger WHERE order_id=? AND transaction_type='payout'
          `).get(order.id).amountKes;
          const allocationKes = Math.min(remainingKes, order.amountKes - previouslyPaidKes);
          if (allocationKes <= 0) continue;
          db.prepare(`
            INSERT INTO merchant_voucher_ledger
              (id,merchant_id,order_id,transaction_type,amount_kes,reference_id,description)
            VALUES (?,?,?,'payout',?,?,?)
          `).run(
            `${payoutId}-${order.id}`, merchant.id, order.id, -allocationKes, payoutId,
            `Manual merchant payout recorded (${reference.trim()}).`
          );
          remainingKes -= allocationKes;
        }
      })();
      return res.status(201).json({ message: 'Manual merchant payout recorded.' });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      if (String(error.message).includes('UNIQUE constraint failed')) {
        return res.status(409).json({ error: 'That payout reference has already been recorded for this merchant.' });
      }
      throw error;
    }
  });

  app.get('/api/gift-refunds/admin', requireAdmin, (req, res) => {
    const requests = db.prepare(`
      SELECT r.id,r.instrument_type AS instrumentType,r.instrument_id AS instrumentId,
        r.reason,r.status,r.admin_note AS adminNote,r.refund_reference AS refundReference,
        r.created_at AS createdAt,a.email,
        CASE WHEN r.instrument_type='gift_card' THEN gc.amount_kes ELSE vo.amount_kes END AS amountKes,
        CASE WHEN r.instrument_type='gift_card' THEN gp.payment_method ELSE vo.payment_method END AS paymentMethod,
        CASE WHEN r.instrument_type='gift_card' THEN gp.status ELSE vo.status END AS purchaseStatus,
        CASE WHEN r.instrument_type='gift_card' THEN gc.status ELSE vo.unused_confirmed END AS instrumentStatus,
        CASE WHEN r.instrument_type='gift_card' THEN 'Valor Africa gift card' ELSE vo.voucher_title END AS title,
        CASE WHEN r.instrument_type='gift_card' THEN '' ELSE gm.business_name END AS merchantName
      FROM gift_refund_requests r JOIN accounts a ON a.id=r.account_id
      LEFT JOIN gift_card_purchases gp ON r.instrument_type='gift_card' AND gp.id=r.instrument_id
      LEFT JOIN gift_cards gc ON gc.purchase_id=gp.id
      LEFT JOIN merchant_voucher_orders vo ON r.instrument_type='merchant_voucher' AND vo.id=r.instrument_id
      LEFT JOIN gift_merchants gm ON gm.id=vo.merchant_id
      ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END,r.created_at DESC LIMIT 200
    `).all();
    return res.json({ requests });
  });

  app.patch('/api/gift-refunds/admin/:id', requireAdmin, (req, res) => {
    const { status, adminNote = '', refundReference = '' } = req.body || {};
    if (!['approved','rejected'].includes(status) || typeof adminNote !== 'string' || adminNote.length > 1000 ||
        typeof refundReference !== 'string' || refundReference.length > 120) {
      return res.status(400).json({ error: 'Choose approved or rejected and enter valid review details.' });
    }
    try {
      db.transaction(() => {
        const request = db.prepare(`
          SELECT id,account_id AS accountId,instrument_type AS instrumentType,
            instrument_id AS instrumentId,status
          FROM gift_refund_requests WHERE id=?
        `).get(req.params.id);
        if (!request || request.status !== 'pending') {
          throw Object.assign(new Error('Pending gift refund request not found.'), { statusCode: 404 });
        }
        if (status === 'approved' && request.instrumentType === 'gift_card') {
          const record = db.prepare(`
            SELECT g.id AS cardId,g.amount_kes AS amountKes,g.status AS cardStatus,
              p.id AS purchaseId,p.status AS purchaseStatus,p.payment_method AS paymentMethod,
              p.account_id AS accountId
            FROM gift_card_purchases p JOIN gift_cards g ON g.purchase_id=p.id
            WHERE p.id=? AND p.account_id=?
          `).get(request.instrumentId, request.accountId);
          if (!record || record.cardStatus !== 'issued' || record.purchaseStatus !== 'paid') {
            throw Object.assign(new Error('Gift cards can only be refunded while paid and unredeemed.'), { statusCode: 409 });
          }
          if (record.paymentMethod === 'mpesa' && !refundReference.trim()) {
            throw Object.assign(new Error('Record the manual M-Pesa refund reference before approving this request.'), { statusCode: 400 });
          }
          db.prepare("UPDATE gift_cards SET status='refunded' WHERE id=? AND status='issued'").run(record.cardId);
          db.prepare(`
            UPDATE gift_card_purchases SET status='refunded',refund_reference=?,refunded_at=datetime('now')
            WHERE id=? AND status='paid'
          `).run(refundReference.trim(), record.purchaseId);
          addGiftCardLedgerEntry(record.cardId, 'refunded', -record.amountKes, request.accountId, req.params.id, 'Unused Valor gift card refund approved.');
          if (record.paymentMethod === 'wallet') {
            const wallet = walletForAccount(request.accountId);
            if (!wallet) throw new Error('Purchaser Valor Wallet is no longer linked.');
            recordWalletTransaction(
              wallet.id, record.amountKes, 'gift_card_refund', 'gift_refund', req.params.id,
              `Refund for Valor gift card ${record.purchaseId}`
            );
          }
        } else if (status === 'approved') {
          const order = db.prepare(`
            SELECT id,account_id AS accountId,merchant_id AS merchantId,code_id AS codeId,
              amount_kes AS amountKes,payment_method AS paymentMethod,unused_confirmed AS unusedConfirmed,status
            FROM merchant_voucher_orders WHERE id=? AND account_id=?
          `).get(request.instrumentId, request.accountId);
          if (!order || order.status !== 'paid' || order.unusedConfirmed !== 1) {
            throw Object.assign(new Error('The merchant must confirm the paid voucher code is unused before this refund can be approved.'), { statusCode: 409 });
          }
          if (order.paymentMethod === 'mpesa' && !refundReference.trim()) {
            throw Object.assign(new Error('Record the manual M-Pesa refund reference before approving this request.'), { statusCode: 400 });
          }
          db.prepare(`
            UPDATE merchant_voucher_orders SET status='refunded',refund_reference=?,refunded_at=datetime('now')
            WHERE id=? AND status='paid'
          `).run(refundReference.trim(), order.id);
          db.prepare("UPDATE merchant_voucher_codes SET status='retired' WHERE id=? AND order_id=? AND status='sold'")
            .run(order.codeId, order.id);
          db.prepare(`
            INSERT INTO merchant_voucher_ledger
              (id,merchant_id,order_id,transaction_type,amount_kes,reference_id,description)
            VALUES (?,?,?,'refund',?,?,?)
          `).run(`refund-${order.id}`, order.merchantId, order.id, -order.amountKes, refundReference.trim(), 'Merchant voucher refund recorded.');
          if (order.paymentMethod === 'wallet') {
            const wallet = walletForAccount(request.accountId);
            if (!wallet) throw new Error('Purchaser Valor Wallet is no longer linked.');
            recordWalletTransaction(
              wallet.id, order.amountKes, 'gift_card_refund', 'gift_refund', req.params.id,
              `Refund for merchant voucher ${order.id}`
            );
          }
        }
        db.prepare(`
          UPDATE gift_refund_requests SET status=?,admin_note=?,refund_reference=?,
            reviewed_by=?,reviewed_at=datetime('now') WHERE id=? AND status='pending'
        `).run(status, adminNote.trim(), refundReference.trim(), req.admin.sub, request.id);
      })();
      return res.json({ requestId: req.params.id, status });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      throw error;
    }
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
    if (existing.status !== 'pending' && !(existing.status === 'approved' && status === 'rejected')) {
      return res.status(409).json({ error: 'Only pending events can be approved; live events may be unpublished.' });
    }
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
      WHERE e.status = 'approved' AND e.deleted_at IS NULL AND b.status = 'active'
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

  function createPendingOrder({
    orderType, eventId = null, adBookingId = null, accountId = null, buyerName, phone,
    ticketType = '', quantity = 1, amountKes, paymentMethod = 'mpesa',
    affiliatePartnerId = null, affiliateCommissionPercent = null, affiliateReferralTokenHash = null
  }) {
    const id = crypto.randomUUID();
    const accessToken = crypto.randomBytes(32).toString('base64url');
    db.prepare(`
      INSERT INTO orders (
        id,access_token_hash,order_type,event_id,ad_booking_id,account_id,buyer_name,phone,
        ticket_type,quantity,amount_kes,payment_method,ticket_email_status,
        affiliate_partner_id,affiliate_commission_percent,affiliate_referral_token_hash
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, sha256(accessToken), orderType, eventId, adBookingId, accountId, buyerName.trim(),
      phone, ticketType, quantity, amountKes, paymentMethod,
      orderType === 'ticket' ? 'not_sent' : 'not_applicable',
      affiliatePartnerId, affiliateCommissionPercent, affiliateReferralTokenHash
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
      res.status(502).json({
        error: 'M-Pesa could not start the prompt. Check that this is an active Safaricom M-Pesa number. Use a Daraja test number in Sandbox, or check your Daraja setup for live payments.'
      });
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

  async function startNowPaymentsCheckout(res, order, amountKes, event) {
    try {
      const invoice = await nowpaymentsGateway.createInvoice({
        id: order.id,
        amountKes,
        quantity: order.quantity,
        ticketType: order.ticketType,
        eventTitle: event.title,
        eventSlug: event.slug,
        publicSiteUrl
      });
      if (!invoice || typeof invoice.id !== 'string' || typeof invoice.url !== 'string' ||
          !Number.isFinite(invoice.priceAmountUsd) || invoice.priceAmountUsd <= 0) {
        throw new Error('NOWPayments did not return a valid invoice.');
      }
      db.prepare(`
        UPDATE orders SET nowpayments_invoice_id=?,nowpayments_price_amount_usd=?
        WHERE id=? AND status='pending'
      `).run(invoice.id, invoice.priceAmountUsd, order.id);
      return res.status(201).json({
        orderId: order.id,
        accessToken: order.accessToken,
        status: 'pending',
        paymentMethod: 'nowpayments',
        checkoutUrl: invoice.url,
        cryptoPriceAmountUsd: invoice.priceAmountUsd,
        message: 'Continue to NOWPayments to complete your crypto payment.'
      });
    } catch (error) {
      db.prepare("UPDATE orders SET status='failed',result_description=? WHERE id=? AND status='pending'")
        .run('Could not start NOWPayments checkout.', order.id);
      console.error('NOWPayments invoice could not be created:', error.message);
      return res.status(502).json({ error: 'NOWPayments could not start checkout. Please try again shortly.' });
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
      if (!['mpesa','wallet','stripe','nowpayments'].includes(paymentMethod)) return res.status(400).json({ error: 'Choose M-Pesa, Valor Wallet, Stripe Checkout, or NOWPayments as the payment method.' });
      req.wallet = paymentMethod === 'wallet' ? walletForAccount(req.account.id) : null;
      if (paymentMethod === 'wallet' && !req.wallet) return res.status(409).json({ error: 'Verify and link your phone number before paying from your wallet.' });
      const phone = paymentMethod === 'wallet'
        ? req.wallet.phone
        : paymentMethod === 'nowpayments' ? '' : normalizePhone(inputPhone);
      if (typeof eventId !== 'string' || !eventId || typeof ticketType !== 'string' || !ticketType) return res.status(400).json({ error: 'Choose a published event and ticket type.' });
      if (typeof buyerName !== 'string' || !buyerName.trim() || buyerName.length > 120) return res.status(400).json({ error: 'Enter the ticket buyer’s name.' });
      if (!phone && paymentMethod !== 'nowpayments') {
        return res.status(400).json({ error: 'Enter a Kenyan Safaricom M-Pesa number: 0712345678, 0112345678, or +254712345678.' });
      }
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10) return res.status(400).json({ error: 'Ticket quantity must be 1–10.' });
      const event = db.prepare("SELECT * FROM events WHERE id = ? AND status = 'approved' AND deleted_at IS NULL").get(eventId);
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
      if (price > 0 && paymentMethod === 'nowpayments' && !nowpaymentsGateway.isConfigured()) {
        return res.status(503).json({ error: 'NOWPayments checkout is not enabled yet. Valor Africa must configure its API key, IPN secret, callback URL, and KES-to-USD rate.' });
      }
      const referralToken = typeof req.body?.affiliateReferralToken === 'string' &&
        req.body.affiliateReferralToken.length <= 100
        ? req.body.affiliateReferralToken
        : '';

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
          let affiliate = null;
          if (referralToken) {
            const visit = db.prepare(`
            SELECT v.token_hash,p.id,p.account_id,p.commission_percent
            FROM affiliate_referral_visits v JOIN affiliate_partners p ON p.id=v.partner_id
            WHERE v.token_hash=? AND julianday(v.expires_at)>julianday('now')
              AND p.status='approved' AND p.commission_percent IS NOT NULL
            `).get(sha256(referralToken));
            if (visit && visit.account_id !== req.account.id) affiliate = visit;
          }
          const created = createPendingOrder({
            orderType: 'ticket', eventId, accountId: req.account.id, buyerName, phone, ticketType, quantity,
            amountKes: price * quantity, paymentMethod: price === 0 ? 'free' : paymentMethod,
            affiliatePartnerId: affiliate?.id || null,
            affiliateCommissionPercent: affiliate?.commission_percent ?? null,
            affiliateReferralTokenHash: affiliate?.token_hash || null
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
      if (paymentMethod === 'nowpayments') {
        return startNowPaymentsCheckout(res, order, price * quantity, event);
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
      if (!phone) return res.status(400).json({ error: 'Enter a Kenyan Safaricom M-Pesa number: 0712345678, 0112345678, or +254712345678.' });
      const event = db.prepare("SELECT id FROM events WHERE id = ? AND status = 'approved' AND deleted_at IS NULL AND julianday(starts_at) > julianday('now')").get(eventId);
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
          e.venue_name AS venueName,e.city,e.timezone,
          COALESCE(f.loved,0) AS loved,f.rating,f.review
        FROM tickets t
        JOIN orders o ON o.id=t.order_id
        JOIN events e ON e.id=t.event_id
        LEFT JOIN event_feedback f ON f.event_id=e.id AND f.account_id=?
        WHERE (
          o.account_id=? OR (
            o.account_id IS NULL AND EXISTS (
              SELECT 1 FROM wallets w WHERE w.account_id=?
                AND substr(replace(replace(replace(replace(replace(o.phone,'+',''),' ',''),'-',''),'(',''),')',''),-9)
                  = substr(w.phone,-9)
            )
          )
        ) AND o.order_type='ticket' AND o.status IN ('paid','confirmed')
        ORDER BY e.starts_at ASC,t.created_at ASC
      `).all(req.account.id, req.account.id, req.account.id);
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

  app.get('/api/account/events/:eventId/feedback', requireAccount, (req, res, next) => {
    const eventExists = db.prepare(`SELECT 1 FROM events WHERE id=? LIMIT 1`).get(req.params.eventId);
    if (!eventExists) return res.status(404).json({ error: 'This event is not available.' });
    try {
      const feedback = db.prepare(`
        SELECT loved,rating,review
        FROM event_feedback
        WHERE account_id=? AND event_id=?
      `).get(req.account.id, req.params.eventId);
      res.json(feedback ? {
        loved: Boolean(feedback.loved),
        rating: feedback.rating,
        review: feedback.review || ''
      } : { loved: false, rating: null, review: '' });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/account/events/:eventId/feedback', requireAccount, (req, res, next) => {
    const { loved, rating, review } = req.body || {};
    const normalizedRating = rating === undefined || rating === null || rating === '' ? null : rating;
    if (typeof loved !== 'boolean') {
      return res.status(400).json({ error: 'Choose whether you loved this event.' });
    }
    if (normalizedRating !== null && (!Number.isInteger(normalizedRating) || normalizedRating < 1 || normalizedRating > 5)) {
      return res.status(400).json({ error: 'Rating must be a whole number from 1 to 5, or left blank.' });
    }
    if (typeof review !== 'string' || review.length > 1200) {
      return res.status(400).json({ error: 'Review must be text of 1,200 characters or fewer.' });
    }
    const eventExists = db.prepare(`SELECT 1 FROM events WHERE id=? LIMIT 1`).get(req.params.eventId);
    if (!eventExists) return res.status(404).json({ error: 'This event is not available.' });

    try {
      db.prepare(`
        INSERT INTO event_feedback (account_id,event_id,loved,rating,review,updated_at)
        VALUES (?,?,?,?,?,datetime('now'))
        ON CONFLICT(account_id,event_id) DO UPDATE SET
          loved=excluded.loved,rating=excluded.rating,review=excluded.review,updated_at=datetime('now')
      `).run(req.account.id, req.params.eventId, loved ? 1 : 0, normalizedRating, review.trim());
      res.json({ loved, rating: normalizedRating, review: review.trim() });
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
        cryptoPriceAmountUsd: order.nowpayments_price_amount_usd,
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
