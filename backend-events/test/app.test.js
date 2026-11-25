process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.UPLOAD_DIR = require('path').join(__dirname, '..', '.test-uploads');
process.env.HERO_AD_UPLOAD_DIR = require('path').join(__dirname, '..', '.test-uploads', 'hero-ads');
process.env.SPONSORSHIP_UPLOAD_DIR = require('path').join(__dirname, '..', '.test-uploads', 'sponsorships');
process.env.JWT_SECRET = 'test-only-secret-not-used-outside-test-1234567890';
process.env.ADMIN_USERNAME = 'test-admin';
process.env.ADMIN_PASSWORD = 'test-admin-password-long-enough';
process.env.ALLOWED_ORIGINS = 'http://localhost:8765,http://localhost:4001';
process.env.PUBLIC_SITE_URL = 'https://valorafrica.co.ke';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const db = require('../src/db');
const { createApp, initializeAdmin } = require('../src/app');
const { login } = require('../src/auth');
const { PARTNER_TERMS_VERSION } = require('../src/partner-terms');
const mpesa = require('../src/mpesa');
const nowpayments = require('../src/nowpayments');
const { normalizeKenyanPhone } = require('../src/kenyan-phone');

initializeAdmin();

let checkoutNumber = 0;
const paymentGateway = {
  enabled: true,
  lastOrder: null,
  async initiateStkPush(order) {
    checkoutNumber += 1;
    this.lastOrder = order;
    return {
      checkoutRequestId: `checkout-${checkoutNumber}`,
      merchantRequestId: `merchant-${checkoutNumber}`,
      customerMessage: 'Check your phone for the payment prompt.'
    };
  },
  isConfigured() {
    return this.enabled;
  },
  environment() {
    return 'sandbox';
  },
  async queryStkPush(checkoutRequestId) {
    return { CheckoutRequestID: checkoutRequestId, ResultCode: '0' };
  }
};
let stripeCheckoutNumber = 0;
const stripeGateway = {
  enabled: true,
  async createCheckoutSession(order) {
    stripeCheckoutNumber += 1;
    return {
      id: `cs_test_${stripeCheckoutNumber}`,
      url: `https://checkout.stripe.test/session/${stripeCheckoutNumber}`,
      expiresAt: Math.floor(Date.now() / 1000) + 1800,
      order
    };
  },
  constructWebhookEvent(payload, signature) {
    if (signature !== 'test-stripe-signature') throw new Error('Invalid signature.');
    return JSON.parse(payload.toString());
  },
  isConfigured() {
    return this.enabled;
  }
};
let nowpaymentsInvoiceNumber = 0;
const nowpaymentsGateway = {
  enabled: true,
  lastInvoice: null,
  isConfigured() {
    return this.enabled;
  },
  async createInvoice(order) {
    nowpaymentsInvoiceNumber += 1;
    this.lastInvoice = order;
    return {
      id: `invoice-${nowpaymentsInvoiceNumber}`,
      url: `https://nowpayments.test/payment/${nowpaymentsInvoiceNumber}`,
      priceAmountUsd: Math.round((order.amountKes / 130) * 100) / 100
    };
  },
  verifyIpn(payload, signature) {
    return signature === 'test-nowpayments-signature';
  }
};
let paypalOrderNumber = 0;
const paypalOrders = new Map();
const paypalGateway = {
  enabled: true,
  isConfigured() {
    return this.enabled;
  },
  environment() {
    return 'sandbox';
  },
  kesPerUsdRate() {
    return 130;
  },
  async createOrder({ id, amountKes }) {
    paypalOrderNumber += 1;
    const orderId = `PAYPAL-ORDER-${paypalOrderNumber}`;
    const amountUsd = Math.round((amountKes / 130) * 100) / 100;
    paypalOrders.set(orderId, { customId: id, amountUsd });
    return { orderId, approveUrl: `https://paypal.test/approve/${orderId}`, amountUsd };
  },
  async captureOrder(orderId) {
    const record = paypalOrders.get(orderId);
    if (!record) throw new Error('PayPal order not found.');
    return {
      status: 'COMPLETED',
      customId: record.customId,
      captureStatus: 'COMPLETED',
      amountValue: record.amountUsd,
      amountCurrency: 'USD'
    };
  },
  async verifyWebhookEvent(headers, event) {
    if (headers['paypal-transmission-sig'] !== 'test-paypal-signature') return null;
    return event;
  }
};
let googlePayTransactionCalls = 0;
let applePayTransactionCalls = 0;
const braintreeGateway = {
  enabled: true,
  applePayEnabled: true,
  lastTransaction: null,
  nextTransactionResult: null,
  isConfigured() {
    return this.enabled;
  },
  isApplePayConfigured() {
    return this.enabled && this.applePayEnabled;
  },
  environment() {
    return 'TEST';
  },
  kesPerUsdRate() {
    return 130;
  },
  googleMerchantId() {
    return 'google-merchant-test';
  },
  convertKesToUsd(amountKes) {
    return Math.round((amountKes / 130) * 100) / 100;
  },
  async generateClientToken() {
    return 'test-braintree-client-token';
  },
  async createTransaction(details) {
    const order = db.prepare('SELECT payment_method FROM orders WHERE id=?').get(details.orderId);
    if (order && order.payment_method === 'applepay') applePayTransactionCalls += 1;
    else googlePayTransactionCalls += 1;
    this.lastTransaction = details;
    const result = this.nextTransactionResult || {
      success: true,
      transactionId: `BRAINTREE-${details.orderId}`,
      amountUsd: details.amountUsd
    };
    this.nextTransactionResult = null;
    return result;
  }
};
const smsCodes = new Map();
const smsGateway = {
  enabled: true,
  isConfigured() {
    return this.enabled;
  },
  async sendOtp(phone, code) {
    smsCodes.set(phone, code);
  }
};
const emailCodes = new Map();
const emailGateway = {
  enabled: true,
  isConfigured() {
    return this.enabled;
  },
  async sendCode(email, code, purpose) {
    emailCodes.set(`${email}:${purpose}`, code);
  }
};
const ticketEmailAttempts = [];
const ticketEmailGateway = {
  enabled: true,
  failNext: false,
  isConfigured() {
    return this.enabled;
  },
  async sendConfirmation(orderId, publicSiteUrl) {
    ticketEmailAttempts.push({ orderId, publicSiteUrl });
    if (this.failNext) {
      this.failNext = false;
      throw new Error('Temporary Resend test failure.');
    }
  }
};
const reminderEmailAttempts = [];
const reminderEmailGateway = {
  enabled: true,
  failNext: false,
  isConfigured() {
    return this.enabled;
  },
  async sendTicketCountdown(args) {
    reminderEmailAttempts.push({ type: 'ticket', ...args });
    if (this.failNext) {
      this.failNext = false;
      throw new Error('Temporary Resend test failure.');
    }
  },
  async sendViewReminder(args) {
    reminderEmailAttempts.push({ type: 'view', ...args });
    if (this.failNext) {
      this.failNext = false;
      throw new Error('Temporary Resend test failure.');
    }
  }
};
const artistBookingEmailAttempts = [];
const artistBookingEmailGateway = {
  enabled: true,
  failNext: false,
  isConfigured() {
    return this.enabled;
  },
  async sendUpdate(notification) {
    artistBookingEmailAttempts.push(notification);
    if (this.failNext) {
      this.failNext = false;
      throw new Error('Temporary artist booking email failure.');
    }
  }
};
const app = createApp({
  payhero: paymentGateway,
  stripe: stripeGateway,
  nowpayments: nowpaymentsGateway,
  paypal: paypalGateway,
  braintree: braintreeGateway,
  sms: smsGateway,
  email: emailGateway,
  ticketEmail: ticketEmailGateway,
  reminderEmail: reminderEmailGateway,
  artistBookingEmail: artistBookingEmailGateway,
  artistBookingsPaymentsEnabled: true,
  verifyGoogleToken: async (idToken) => {
    const profiles = {
      'valid-google-token': { sub: 'google-subject-123', email: 'google@example.com', name: 'Google Member' },
      'another-google-token': { sub: 'google-subject-456', email: 'another@example.com', name: 'Another Member' },
      'wallet-google-token': { sub: 'wallet-google-subject', email: 'wallet-owner@example.com', name: 'Wallet Owner' }
    };
    if (!profiles[idToken]) throw new Error('Invalid test credential.');
    return { ...profiles[idToken], email_verified: true };
  },
  publicSiteUrl: 'https://valorafrica.co.ke'
});
const adminToken = login(process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD);
const admin = { Authorization: `Bearer ${adminToken}` };

async function ticketAccountAuth(idToken = 'valid-google-token') {
  const response = await request(app).post('/api/auth/google').send({ idToken });
  assert.equal(response.status, 200);
  return { Authorization: `Bearer ${response.body.accessToken}` };
}

function createTestAccountAuth(email, { acknowledgeTerms = true } = {}) {
  const id = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare(`
    INSERT INTO accounts (id,email,display_name,email_verified_at)
    VALUES (?,?,?,datetime('now'))
  `).run(id, email, email.split('@')[0]);
  db.prepare(`
    INSERT INTO account_sessions (token_hash,account_id,expires_at)
    VALUES (?,?,datetime('now','+30 days'))
  `).run(tokenHash, id);
  if (acknowledgeTerms) {
    db.prepare(`
      INSERT INTO partner_terms_acknowledgements
        (account_id,terms_version,signer_name,account_email)
      VALUES (?,?,?,?)
    `).run(id, PARTNER_TERMS_VERSION, email.split('@')[0], email);
  }
  return { Authorization: `Bearer ${token}` };
}

function createTestWallet(auth, balanceKes = 0) {
  const tokenHash = crypto.createHash('sha256')
    .update(auth.Authorization.slice('Bearer '.length)).digest('hex');
  const account = db.prepare('SELECT account_id AS accountId FROM account_sessions WHERE token_hash=?').get(tokenHash);
  assert.ok(account, 'Test auth must reference an account session.');
  const walletId = crypto.randomUUID();
  const phone = `2547${String(crypto.randomInt(0, 100000000)).padStart(8, '0')}`;
  db.prepare('INSERT INTO wallets (id,phone,account_type,account_id) VALUES (?,?,?,?)')
    .run(walletId, phone, 'buyer', account.accountId);
  if (balanceKes) {
    db.prepare(`
      INSERT INTO wallet_transactions (id,wallet_id,transaction_type,amount_kes,status,description,completed_at)
      VALUES (?,?,'deposit',?,'completed','Test wallet opening balance',datetime('now'))
    `).run(crypto.randomUUID(), walletId, balanceKes);
  }
  return { walletId, accountId: account.accountId };
}

function submitEvent(
  title = 'Test Live Festival',
  auth = createTestAccountAuth(`event-submitter-${crypto.randomUUID()}@example.com`),
  category = 'Festivals',
  tags = 'music, culture'
) {
  const future = Date.now() + 7 * 86400000;
  const starts = new Date(future).toISOString();
  const ends = new Date(future + 4 * 3600000).toISOString();
  const submission = request(app).post('/api/events/submissions')
    .field('title', title)
    .field('description', 'A live event description for a test festival.')
    .field('category', category)
    .field('format', 'Physical')
    .field('timezone', 'Africa/Nairobi')
    .field('startsAt', starts)
    .field('endsAt', ends)
    .field('venueName', 'Nairobi Hall')
    .field('city', 'Nairobi')
    .field('capacity', '30')
    .field('regularPrice', '1200')
    .field('earlyBirdPrice', '800')
    .field('earlyBirdEnds', new Date(future - 86400000).toISOString())
    .field('vipPrice', '2500')
    .field('slug', title.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
    .field('tags', tags)
    .field('organizerName', 'Event Organizer')
    .field('organizerEmail', 'organizer@example.com')
    .field('organizerPhone', '0712345678');
  return auth ? submission.set(auth) : submission;
}

function createStoredTestEvent(title, auth) {
  const token = auth.Authorization.slice('Bearer '.length);
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const account = db.prepare(`
    SELECT a.id,a.email FROM account_sessions s JOIN accounts a ON a.id=s.account_id
    WHERE s.token_hash=?
  `).get(tokenHash);
  const accountId = account.id;
  const id = crypto.randomUUID();
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const startsAt = new Date(Date.now() + 7 * 86400000).toISOString();
  const endsAt = new Date(Date.parse(startsAt) + 4 * 3600000).toISOString();
  db.prepare(`
    INSERT INTO events (
      id,slug,title,description,category,format,timezone,starts_at,ends_at,venue_name,city,
      regular_price,tags_json,organizer_name,organizer_email,organizer_phone,organizer_account_id,status
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'approved')
  `).run(
    id, slug, title, 'A live event description for tests.', 'Festivals', 'Physical', 'Africa/Nairobi',
    startsAt, endsAt, 'Nairobi Hall', 'Nairobi', 1200, '["music"]', 'Event Organizer',
    account.email, '0712345678', accountId
  );
  return { id, slug };
}

async function approveEvent(id) {
  return request(app).patch(`/api/events/admin/${id}/review`)
    .set(admin)
    .send({ status: 'approved' });
}

async function completePayment(checkoutRequestId, merchantRequestId, amount, receipt) {
  return request(app).post('/api/payhero/callback').send({
    forward_url: '',
    status: true,
    response: {
      Amount: amount,
      CheckoutRequestID: checkoutRequestId,
      ExternalReference: '',
      MerchantRequestID: merchantRequestId,
      MpesaReceiptNumber: receipt,
      Phone: '+254712345678',
      ResultCode: 0,
      ResultDesc: 'The service request is processed successfully.',
      Status: 'Success'
    }
  });
}

function stripeWebhook(session, type = 'checkout.session.completed') {
  return request(app).post('/api/stripe/webhook')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', 'test-stripe-signature')
    .send(JSON.stringify({
      id: `evt_${session.id}`,
      type,
      data: { object: session }
    }));
}

test('signed-in event submissions publish immediately and admins can unpublish them', async () => {
  const owner = createTestAccountAuth('organizer-owner@example.com');
  const otherAccount = createTestAccountAuth('different-organizer@example.com');
  const anonymous = await submitEvent('Anonymous Event', null);
  assert.equal(anonymous.status, 401);

  const created = await submitEvent().set(owner);
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'approved');
  assert.match(created.body.message, /now live/i);
  const publicEvents = await request(app).get('/api/events');
  assert.equal(publicEvents.body.events.length, 1);
  assert.equal(publicEvents.body.events[0].title, 'Test Live Festival');
  assert.equal(publicEvents.body.events[0].ticketsSold, 0);
  assert.equal((await request(app).get(`/api/events/by-slug/${created.body.slug}`)).status, 200);

  assert.equal((await request(app).get('/api/events/mine')).status, 401);
  const ownerEvents = await request(app).get('/api/events/mine').set(owner);
  assert.equal(ownerEvents.status, 200);
  const ownedEvent = ownerEvents.body.events.find((item) => item.id === created.body.id);
  assert.equal(ownedEvent.status, 'approved');
  assert.equal(ownedEvent.ticketsSold, 0);
  assert.equal(ownedEvent.checkedIn, 0);
  assert.equal(ownedEvent.grossKes, 0);
  const otherEvents = await request(app).get('/api/events/mine').set(otherAccount);
  assert.equal(otherEvents.body.events.some((item) => item.id === created.body.id), false);

  const unauthorized = await request(app).get('/api/events/admin/submissions');
  assert.equal(unauthorized.status, 401);
  const pending = await request(app).get('/api/events/admin/submissions?status=pending').set(admin);
  assert.equal(pending.status, 200);
  assert.equal(pending.body.events.some((item) => item.id === created.body.id), false);
  const listing = await request(app).get('/api/events');
  assert.equal(listing.body.events[0].tickets[0].name, 'Early bird');
  assert.equal(JSON.stringify(listing.body).includes('organizer@example.com'), false);

  const movieShowtime = new Date(Date.now() + 7 * 86400000 + 3600000).toISOString();
  const legacyPending = await submitEvent(
    'Legacy Pending Event',
    owner,
    'Movies & Cinema',
    `Showtime: ${movieShowtime}, premiere`
  );
  assert.equal(legacyPending.status, 201);
  db.prepare("UPDATE events SET status='pending' WHERE id=?").run(legacyPending.body.id);
  const pendingAfterLegacy = await request(app).get('/api/events/admin/submissions?status=pending').set(admin);
  assert.equal(pendingAfterLegacy.body.events[0].organizer.email, 'organizer@example.com');
  const approvedLegacy = await approveEvent(legacyPending.body.id);
  assert.equal(approvedLegacy.body.status, 'approved');
  const movieListing = await request(app).get(`/api/events/by-slug/${legacyPending.body.slug}`);
  assert.equal(movieListing.body.event.category, 'Movies & Cinema');
  assert.deepEqual(movieListing.body.event.tags, [`Showtime: ${movieShowtime}`, 'premiere']);

  const decision = await request(app).patch(`/api/events/admin/${legacyPending.body.id}/review`)
    .set(admin)
    .send({ status: 'rejected', reviewNote: 'Please update the event details.' });
  assert.equal(decision.status, 200);
  assert.equal(decision.body.status, 'rejected');
  assert.equal((await request(app).get(`/api/events/by-slug/${legacyPending.body.slug}`)).status, 404);
  assert.equal((await request(app).get(`/api/events/by-slug/${created.body.slug}`)).status, 200);
  assert.equal((await request(app).get('/api/events')).body.events.length, 1);
});

test('Kenyan M-Pesa phone formats normalize to Daraja international format', () => {
  for (const [input, expected] of [
    ['0712345678', '254712345678'],
    ['0712 345 678', '254712345678'],
    ['+254712345678', '254712345678'],
    ['+254 712-345-678', '254712345678'],
    ['0113665283', '254113665283'],
    ['011 366 5283', '254113665283'],
    ['+254113665283', '254113665283'],
    ['+254 113-665-283', '254113665283']
  ]) {
    assert.equal(normalizeKenyanPhone(input), expected, input);
  }
  for (const input of ['', '071234567', '254812345678', 'abc0712345678', '+254 712 345 678 ext 1']) {
    assert.equal(normalizeKenyanPhone(input), null, input);
  }
});

test('M-Pesa health diagnostics report the configured environment without credentials', () => {
  const originalEnvironment = process.env.MPESA_ENV;
  try {
    process.env.MPESA_ENV = 'sandbox';
    assert.equal(mpesa.environment(), 'sandbox');
    process.env.MPESA_ENV = 'production';
    assert.equal(mpesa.environment(), 'production');
  } finally {
    if (originalEnvironment === undefined) delete process.env.MPESA_ENV;
    else process.env.MPESA_ENV = originalEnvironment;
  }
});

test('admin dashboard origin can call its same-origin API', async () => {
  const response = await request(app).get('/api/health')
    .set('Host', '127.0.0.1')
    .set('Origin', 'http://127.0.0.1');
  assert.equal(response.status, 200);
  assert.equal(response.body.ticketEmailsConfigured, true);
  assert.equal(response.body.mpesaEnvironment, 'sandbox');
  assert.equal(response.headers['access-control-allow-origin'], 'http://127.0.0.1');
  const orders = await request(app).get('/api/orders/admin').set(admin);
  assert.equal(orders.status, 200);
  assert.deepEqual(orders.body.orders, []);
});

test('local development origins can read the public API', async () => {
  const response = await request(app).get('/api/events')
    .set('Origin', 'http://127.0.0.1:8877');
  assert.equal(response.status, 200);
  assert.equal(response.headers['access-control-allow-origin'], 'http://127.0.0.1:8877');
  const heroSlides = await request(app).get('/api/ads/hero')
    .set('Origin', 'http://127.0.0.1:8877');
  assert.equal(heroSlides.status, 200);
  assert.equal(heroSlides.headers['access-control-allow-origin'], 'http://127.0.0.1:8877');
  const heroHighlights = await request(app).get('/api/hero-highlights')
    .set('Origin', 'http://127.0.0.1:8877');
  assert.equal(heroHighlights.status, 200);
  assert.equal(heroHighlights.headers['access-control-allow-origin'], 'http://127.0.0.1:8877');
});

test('local development origins cannot use private API routes cross-origin', async () => {
  const response = await request(app).get('/api/auth/account')
    .set('Origin', 'http://127.0.0.1:8877');
  assert.notEqual(response.headers['access-control-allow-origin'], 'http://127.0.0.1:8877');
});

test('remote development origins cannot read the public API', async () => {
  const response = await request(app).get('/api/events')
    .set('Origin', 'http://example.com');
  assert.notEqual(response.headers['access-control-allow-origin'], 'http://example.com');
});

test('homepage hero slides are public, ordered, editable, and admin protected', async () => {
  const initial = await request(app).get('/api/ads/hero');
  assert.equal(initial.status, 200);
  assert.equal(initial.body.slides.length, 5);
  assert.equal(initial.body.slides[0].id, 'valor-sponsored-video-promo');
  assert.ok(initial.body.slides.every((slide) => slide.mediaType === 'video'));
  assert.deepEqual(initial.body.slides.map((slide) => slide.mediaUrl), [
    'videos/valor-sponsored-video.mp4',
    'videos/valor-ticket-buyer.mp4',
    'videos/valor-ads-organizer-intro.mp4',
    'videos/valor-featured-clip-002.mp4',
    'videos/valor-featured-clip-001.mp4'
  ]);
  const highlightsAlias = await request(app).get('/api/hero-highlights');
  assert.equal(highlightsAlias.status, 200);
  assert.deepEqual(highlightsAlias.body, initial.body);
  assert.deepEqual(initial.body.slides.slice(-2).map((slide) => slide.id), [
    'valor-featured-clip-002',
    'valor-featured-clip-001'
  ]);
  assert.deepEqual(initial.body.slides.slice(-2).map((slide) => slide.title), [
    'Discover Valor Africa',
    'Discover Valor Africa'
  ]);
  assert.deepEqual(initial.body.slides.slice(-2).map((slide) => slide.mediaUrl), [
    'videos/valor-featured-clip-002.mp4',
    'videos/valor-featured-clip-001.mp4'
  ]);
  assert.equal((await request(app).get('/api/ads/admin/hero-slides')).status, 401);

  const created = await request(app).post('/api/ads/admin/hero-slides').set(admin).send({
    title: 'Weekend festival spotlight',
    category: 'Featured events',
    description: 'Find your next live experience.',
    mediaType: 'image',
    mediaUrl: 'images/weekend-festival.jpg',
    posterUrl: '',
    linkUrl: 'events.html',
    ctaLabel: 'Browse events'
  });
  assert.equal(created.status, 201);
  const slideId = created.body.slide.id;
  assert.equal(created.body.slide.position, 5);

  const invalidDestination = await request(app).patch(`/api/ads/admin/hero-slides/${slideId}`)
    .set(admin).send({ linkUrl: 'javascript:alert(1)' });
  assert.equal(invalidDestination.status, 400);

  const allSlides = (await request(app).get('/api/ads/admin/hero-slides').set(admin)).body.slides;
  const reordered = await request(app).post('/api/ads/admin/hero-slides/reorder').set(admin)
    .send({ ids: [slideId, ...allSlides.filter((slide) => slide.id !== slideId).map((slide) => slide.id)] });
  assert.equal(reordered.status, 200);
  assert.equal((await request(app).get('/api/ads/hero')).body.slides[0].id, slideId);

  assert.equal((await request(app).patch(`/api/ads/admin/hero-slides/${slideId}`)
    .set(admin).send({ active: false })).body.slide.active, false);
  assert.equal((await request(app).get('/api/ads/hero')).body.slides.some((slide) => slide.id === slideId), false);
  assert.equal((await request(app).patch(`/api/ads/admin/hero-slides/${slideId}`)
    .set(admin).send({ active: true })).body.slide.active, true);

  const linkedVideo = await request(app).post('/api/ads/admin/hero-slides').set(admin).send({
    title: 'Linked video spotlight',
    mediaType: 'video',
    mediaUrl: 'videos/linked-promo.mp4',
    linkUrl: 'events.html',
    ctaLabel: 'Explore events'
  });
  assert.equal(linkedVideo.status, 201);
  assert.equal(linkedVideo.body.slide.mediaUrl, 'videos/linked-promo.mp4');

  const uploaded = await request(app).post('/api/ads/admin/hero-slides').set(admin)
    .field('title', 'Uploaded video spotlight')
    .field('mediaType', 'video')
    .field('linkUrl', 'events.html')
    .field('ctaLabel', 'Explore events')
    .attach('videoFile', Buffer.from([0,0,0,24,0x66,0x74,0x79,0x70,0x69,0x73,0x6f,0x6d]), {
      filename: 'spotlight.mp4',
      contentType: 'video/mp4'
    });
  assert.equal(uploaded.status, 201);
  assert.match(uploaded.body.slide.mediaUrl, /^\/uploads\/hero-ads\/[0-9a-f-]+\.mp4$/i);
  const videoResponse = await request(app).get(uploaded.body.slide.mediaUrl);
  assert.equal(videoResponse.status, 200);
  assert.match(videoResponse.headers['content-type'], /video\/mp4/);

  const pngSignature = Buffer.from([137,80,78,71,13,10,26,10]);
  const uploadedImage = await request(app).post('/api/ads/admin/hero-slides').set(admin)
    .field('title', 'Uploaded image spotlight')
    .field('mediaType', 'image')
    .field('linkUrl', 'events.html')
    .field('ctaLabel', 'Browse events')
    .attach('imageFile', pngSignature, { filename: 'spotlight.png', contentType: 'image/png' });
  assert.equal(uploadedImage.status, 201);
  assert.match(uploadedImage.body.slide.mediaUrl, /^\/uploads\/hero-ads\/[0-9a-f-]+\.png$/i);
  const imageResponse = await request(app).get(uploadedImage.body.slide.mediaUrl);
  assert.equal(imageResponse.status, 200);
  assert.match(imageResponse.headers['content-type'], /image\/png/);

  const wrongSlideType = await request(app).post('/api/ads/admin/hero-slides').set(admin)
    .field('title', 'Mismatched upload')
    .field('mediaType', 'video')
    .field('linkUrl', 'events.html')
    .field('ctaLabel', 'Browse events')
    .attach('imageFile', pngSignature, { filename: 'spotlight.png', contentType: 'image/png' });
  assert.equal(wrongSlideType.status, 400);
  assert.match(wrongSlideType.body.error, /image slides/i);

  const replacedWithImage = await request(app).patch(`/api/ads/admin/hero-slides/${uploaded.body.slide.id}`)
    .set(admin)
    .field('mediaType', 'image')
    .attach('imageFile', pngSignature, { filename: 'replacement.png', contentType: 'image/png' });
  assert.equal(replacedWithImage.status, 200);
  assert.match(replacedWithImage.body.slide.mediaUrl, /^\/uploads\/hero-ads\/[0-9a-f-]+\.png$/i);
  const replacedVideoGone = await request(app).get(uploaded.body.slide.mediaUrl);
  assert.equal(replacedVideoGone.status, 404);
});

test('event posters require valid image signatures', async () => {
  const response = await submitEvent('Poster Signature Test')
    .attach('eventImage', Buffer.from('not a real image'), { filename: 'poster.png', contentType: 'image/png' });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /not a supported image/i);
});

test('ticket checkout is unavailable until PayHero is configured', async () => {
  paymentGateway.enabled = false;
  const event = db.prepare("SELECT id FROM events WHERE slug='test-live-festival'").get();
  const payload = { eventId: event.id, ticketType: 'Early bird', buyerName: 'Buyer', phone: '0712345678', quantity: 1 };
  const anonymous = await request(app).post('/api/orders/tickets').send(payload);
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.body.error, /sign in/i);
  const response = await request(app).post('/api/orders/tickets').set(await ticketAccountAuth())
    .send(payload);
  assert.equal(response.status, 503);
  assert.equal(response.body.error.includes('PayHero'), true);
  stripeGateway.enabled = false;
  const unavailable = await request(app).post('/api/orders/tickets')
    .set(await ticketAccountAuth())
    .send({ ...payload, paymentMethod: 'stripe' });
  assert.equal(unavailable.status, 503);
  stripeGateway.enabled = true;
  paymentGateway.enabled = true;
});

test('Stripe ticket checkout issues QR tickets only after a verified matching webhook', async () => {
  const event = db.prepare("SELECT id FROM events WHERE slug='test-live-festival'").get();
  const accountAuth = await ticketAccountAuth();
  const checkout = await request(app).post('/api/orders/tickets').set(accountAuth).send({
    eventId: event.id,
    ticketType: 'Early bird',
    buyerName: 'Stripe Buyer',
    phone: '0712345678',
    quantity: 2,
    paymentMethod: 'stripe'
  });
  assert.equal(checkout.status, 201);
  assert.equal(checkout.body.paymentMethod, 'stripe');
  assert.match(checkout.body.checkoutUrl, /^https:\/\/checkout\.stripe\.test\//);
  const pending = db.prepare('SELECT * FROM orders WHERE id=?').get(checkout.body.orderId);
  assert.equal(pending.payment_method, 'stripe');
  assert.match(pending.stripe_session_id, /^cs_test_\d+$/);
  assert.ok(pending.stripe_session_expires_at);
  assert.equal((await request(app).get(`/api/orders/${checkout.body.orderId}`)
    .set(accountAuth).set('X-Order-Access', checkout.body.accessToken)).body.status, 'pending');

  const session = {
    id: pending.stripe_session_id,
    payment_status: 'paid',
    amount_total: 160000,
    currency: 'kes',
    metadata: { orderId: pending.id }
  };
  const invalidSignature = await request(app).post('/api/stripe/webhook')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', 'invalid')
    .send(JSON.stringify({ type: 'checkout.session.completed', data: { object: session } }));
  assert.equal(invalidSignature.status, 400);
  assert.equal((await request(app).get(`/api/orders/${checkout.body.orderId}`)
    .set(accountAuth).set('X-Order-Access', checkout.body.accessToken)).body.status, 'pending');

  ticketEmailGateway.failNext = true;
  assert.equal((await stripeWebhook(session)).status, 200);
  assert.equal(db.prepare('SELECT ticket_email_status FROM orders WHERE id=?').get(pending.id).ticket_email_status, 'failed');
  assert.equal((await stripeWebhook(session)).status, 200);
  db.prepare("UPDATE orders SET ticket_email_attempted_at='2000-01-01 00:00:00' WHERE id=?").run(pending.id);
  assert.equal(await app.locals.retryPendingTicketEmails(), 1);
  assert.equal(db.prepare('SELECT ticket_email_status FROM orders WHERE id=?').get(pending.id).ticket_email_status, 'sent');
  assert.equal(ticketEmailAttempts.filter((attempt) => attempt.orderId === pending.id).length, 2);
  assert.equal(ticketEmailAttempts.find((attempt) => attempt.orderId === pending.id).publicSiteUrl, 'https://valorafrica.co.ke');
  assert.equal((await stripeWebhook(session)).status, 200);
  assert.equal(ticketEmailAttempts.filter((attempt) => attempt.orderId === pending.id).length, 2);
  assert.equal(db.prepare('SELECT ticket_email_status FROM orders WHERE id=?').get(pending.id).ticket_email_status, 'sent');
  const originalFetch = global.fetch;
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.RESEND_FROM_EMAIL;
  let resendRequest;
  process.env.RESEND_API_KEY = 'test-resend-key';
  process.env.RESEND_FROM_EMAIL = 'Valor Africa <tickets@example.test>';
  global.fetch = async (url, options) => {
    resendRequest = { url, options, body: JSON.parse(options.body) };
    return { ok: true, status: 200, async json() { return { id: 'email_test_123' }; } };
  };
  try {
    await require('../src/ticket-email').sendConfirmation(pending.id, 'https://valorafrica.co.ke');
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalApiKey;
    if (originalFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = originalFrom;
  }
  assert.equal(resendRequest.url, 'https://api.resend.com/emails');
  assert.equal(resendRequest.body.to[0], 'google@example.com');
  assert.match(resendRequest.body.html, /Your tickets are confirmed/);
  assert.equal(resendRequest.body.attachments.length, 2);
  assert.ok(Buffer.from(resendRequest.body.attachments[0].content, 'base64')
    .subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
  assert.equal(resendRequest.options.headers['Idempotency-Key'], `valor-ticket-confirmation-${pending.id}`);
  const paid = await request(app).get(`/api/orders/${checkout.body.orderId}`)
    .set(accountAuth).set('X-Order-Access', checkout.body.accessToken);
  assert.equal(paid.body.status, 'paid');
  assert.equal(paid.body.paymentMethod, 'stripe');
  assert.equal(paid.body.tickets.length, 2);
  assert.match(paid.body.tickets[0].qr, /^data:image\/png;base64,/);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM tickets WHERE order_id=?').get(pending.id).total, 2);
});

test('Stripe webhook rejects mismatched totals and expires abandoned checkouts without issuing tickets', async () => {
  const event = db.prepare("SELECT id FROM events WHERE slug='test-live-festival'").get();
  const accountAuth = await ticketAccountAuth();
  const wrongTotal = await request(app).post('/api/orders/tickets').set(accountAuth).send({
    eventId: event.id,
    ticketType: 'Early bird',
    buyerName: 'Stripe Buyer',
    phone: '0712345678',
    quantity: 1,
    paymentMethod: 'stripe'
  });
  const wrongOrder = db.prepare('SELECT * FROM orders WHERE id=?').get(wrongTotal.body.orderId);
  const mismatch = await stripeWebhook({
    id: wrongOrder.stripe_session_id,
    payment_status: 'paid',
    amount_total: 1,
    currency: 'kes',
    metadata: { orderId: wrongOrder.id }
  });
  assert.equal(mismatch.status, 200);
  const reviewed = await request(app).get(`/api/orders/${wrongOrder.id}`)
    .set(accountAuth).set('X-Order-Access', wrongTotal.body.accessToken);
  assert.equal(reviewed.body.status, 'review');
  assert.equal(reviewed.body.tickets, undefined);

  const abandoned = await request(app).post('/api/orders/tickets').set(accountAuth).send({
    eventId: event.id,
    ticketType: 'Early bird',
    buyerName: 'Stripe Buyer',
    phone: '0712345678',
    quantity: 1,
    paymentMethod: 'stripe'
  });
  const abandonedOrder = db.prepare('SELECT stripe_session_id FROM orders WHERE id=?').get(abandoned.body.orderId);
  const expired = await stripeWebhook({
    id: abandonedOrder.stripe_session_id,
    metadata: { orderId: abandoned.body.orderId }
  }, 'checkout.session.expired');
  assert.equal(expired.status, 200);
  const failed = await request(app).get(`/api/orders/${abandoned.body.orderId}`)
    .set(accountAuth).set('X-Order-Access', abandoned.body.accessToken);
  assert.equal(failed.body.status, 'failed');
  assert.equal(failed.body.tickets, undefined);
});

test('NOWPayments issues tickets only after a signed, matching finished-payment notification', async () => {
  const event = db.prepare("SELECT id FROM events WHERE slug='test-live-festival'").get();
  const accountAuth = await ticketAccountAuth();
  const checkout = await request(app).post('/api/orders/tickets').set(accountAuth).send({
    eventId: event.id,
    ticketType: 'Early bird',
    buyerName: 'Crypto Buyer',
    quantity: 1,
    paymentMethod: 'nowpayments'
  });
  assert.equal(checkout.status, 201);
  assert.equal(checkout.body.paymentMethod, 'nowpayments');
  assert.match(checkout.body.checkoutUrl, /^https:\/\/nowpayments\.test\//);
  assert.equal(checkout.body.cryptoPriceAmountUsd, 6.15);
  assert.equal(nowpaymentsGateway.lastInvoice.amountKes, 800);
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(checkout.body.orderId);
  assert.equal(order.payment_method, 'nowpayments');
  assert.equal(order.phone, '');
  assert.equal(order.nowpayments_invoice_id, 'invoice-1');
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM tickets WHERE order_id=?').get(order.id).total, 0);

  const payload = {
    payment_id: 'payment-1',
    invoice_id: order.nowpayments_invoice_id,
    order_id: order.id,
    payment_status: 'finished',
    price_amount: '6.15',
    price_currency: 'usd'
  };
  const invalidSignature = await request(app).post('/api/nowpayments/ipn')
    .set('x-nowpayments-sig', 'invalid')
    .send(payload);
  assert.equal(invalidSignature.status, 400);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status, 'pending');

  const confirming = await request(app).post('/api/nowpayments/ipn')
    .set('x-nowpayments-sig', 'test-nowpayments-signature')
    .send({ ...payload, payment_status: 'confirming' });
  assert.equal(confirming.status, 200);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status, 'pending');

  const finished = await request(app).post('/api/nowpayments/ipn')
    .set('x-nowpayments-sig', 'test-nowpayments-signature')
    .send(payload);
  assert.equal(finished.status, 200);
  const paid = await request(app).get(`/api/orders/${order.id}`)
    .set(accountAuth).set('X-Order-Access', checkout.body.accessToken);
  assert.equal(paid.body.status, 'paid');
  assert.equal(paid.body.cryptoPriceAmountUsd, 6.15);
  assert.equal(paid.body.tickets.length, 1);

  await request(app).post('/api/nowpayments/ipn')
    .set('x-nowpayments-sig', 'test-nowpayments-signature')
    .send(payload);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM tickets WHERE order_id=?').get(order.id).total, 1);
});

test('PayPal ticket checkout reserves payment until capture and issues tickets once', async () => {
  const accountAuth = createTestAccountAuth('paypal-ticket-buyer@example.com');
  const event = createStoredTestEvent('PayPal Ticket Checkout', accountAuth);
  const checkout = await request(app).post('/api/orders/tickets').set(accountAuth).send({
    eventId: event.id,
    ticketType: 'Regular',
    buyerName: 'PayPal Ticket Buyer',
    quantity: 1,
    paymentMethod: 'paypal'
  });
  assert.equal(checkout.status, 201);
  assert.equal(checkout.body.paymentMethod, 'paypal');
  assert.match(checkout.body.checkoutUrl, /^https:\/\/paypal\.test\/approve\//);
  assert.equal(checkout.body.paypalAmountUsd, 9.23);
  const pending = db.prepare('SELECT * FROM orders WHERE id=?').get(checkout.body.orderId);
  assert.equal(pending.payment_method, 'paypal');
  assert.equal(pending.phone, '');
  assert.equal(pending.paypal_amount_usd, 9.23);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM tickets WHERE order_id=?').get(pending.id).total, 0);

  const invalidAccess = await request(app).post(`/api/orders/${pending.id}/paypal-capture`);
  assert.equal(invalidAccess.status, 404);

  const mismatchedCheckout = await request(app).post('/api/orders/tickets').set(accountAuth).send({
    eventId: event.id,
    ticketType: 'Regular',
    buyerName: 'PayPal Amount Review Buyer',
    quantity: 1,
    paymentMethod: 'paypal'
  });
  const mismatchedOrder = db.prepare('SELECT * FROM orders WHERE id=?').get(mismatchedCheckout.body.orderId);
  const originalCapture = paypalGateway.captureOrder;
  paypalGateway.captureOrder = async () => ({
    status: 'COMPLETED',
    customId: mismatchedOrder.id,
    captureStatus: 'COMPLETED',
    amountValue: 1,
    amountCurrency: 'USD'
  });
  let mismatchedCapture;
  try {
    mismatchedCapture = await request(app).post(`/api/orders/${mismatchedOrder.id}/paypal-capture`)
      .set('X-Order-Access', mismatchedCheckout.body.accessToken);
  } finally {
    paypalGateway.captureOrder = originalCapture;
  }
  assert.equal(mismatchedCapture.status, 409);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(mismatchedOrder.id).status, 'review');
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM tickets WHERE order_id=?').get(mismatchedOrder.id).total, 0);

  const captured = await request(app).post(`/api/orders/${pending.id}/paypal-capture`)
    .set('X-Order-Access', checkout.body.accessToken);
  assert.equal(captured.status, 200);
  assert.equal(captured.body.status, 'completed');
  const paid = await request(app).get(`/api/orders/${pending.id}`)
    .set(accountAuth).set('X-Order-Access', checkout.body.accessToken);
  assert.equal(paid.body.status, 'paid');
  assert.equal(paid.body.paymentMethod, 'paypal');
  assert.equal(paid.body.paypalAmountUsd, 9.23);
  assert.equal(paid.body.tickets.length, 1);

  const replay = await request(app).post(`/api/orders/${pending.id}/paypal-capture`)
    .set('X-Order-Access', checkout.body.accessToken);
  assert.equal(replay.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM tickets WHERE order_id=?').get(pending.id).total, 1);

  const webhookCheckout = await request(app).post('/api/orders/tickets').set(accountAuth).send({
    eventId: event.id,
    ticketType: 'Regular',
    buyerName: 'PayPal Webhook Buyer',
    quantity: 1,
    paymentMethod: 'paypal'
  });
  const webhookOrder = db.prepare('SELECT * FROM orders WHERE id=?').get(webhookCheckout.body.orderId);
  const webhook = await request(app).post('/api/paypal/webhook')
    .set('paypal-transmission-sig', 'test-paypal-signature')
    .send({
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        custom_id: webhookOrder.id,
        amount: { value: String(webhookOrder.paypal_amount_usd), currency_code: 'USD' }
      }
    });
  assert.equal(webhook.status, 200);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(webhookOrder.id).status, 'paid');
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM tickets WHERE order_id=?').get(webhookOrder.id).total, 1);
});

test('Google Pay ticket checkout charges the verified Braintree total before issuing tickets', async () => {
  const accountAuth = createTestAccountAuth('google-pay-ticket-buyer@example.com');
  const event = createStoredTestEvent('Google Pay Ticket Checkout', accountAuth);
  const noAccountToken = await request(app).post('/api/payments/googlepay/client-token');
  assert.equal(noAccountToken.status, 401);

  const clientToken = await request(app).post('/api/payments/googlepay/client-token').set(accountAuth);
  assert.equal(clientToken.status, 200);
  assert.equal(clientToken.body.clientToken, 'test-braintree-client-token');
  assert.equal(clientToken.body.environment, 'TEST');
  assert.equal(clientToken.body.googleMerchantId, 'google-merchant-test');
  assert.equal(JSON.stringify(clientToken.body).includes('private'), false);

  const amountBeforeInvalidQuote = db.prepare("SELECT COUNT(*) AS total FROM orders WHERE payment_method='googlepay'").get().total;
  const invalidQuote = await request(app).post('/api/orders/tickets').set(accountAuth).send({
    eventId: event.id,
    ticketType: 'Regular',
    buyerName: 'Google Pay Buyer',
    quantity: 1,
    paymentMethod: 'googlepay',
    googlePayQuotedAmountUsd: 1
  });
  assert.equal(invalidQuote.status, 409);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM orders WHERE payment_method='googlepay'").get().total, amountBeforeInvalidQuote);

  const checkout = await request(app).post('/api/orders/tickets').set(accountAuth).send({
    eventId: event.id,
    ticketType: 'Regular',
    buyerName: 'Google Pay Buyer',
    quantity: 1,
    paymentMethod: 'googlepay',
    googlePayQuotedAmountUsd: 9.23
  });
  assert.equal(checkout.status, 201);
  assert.equal(checkout.body.paymentMethod, 'googlepay');
  assert.equal(checkout.body.googlePayAmountUsd, 9.23);
  const pending = db.prepare('SELECT * FROM orders WHERE id=?').get(checkout.body.orderId);
  assert.equal(pending.payment_method, 'googlepay');
  assert.equal(pending.phone, '');
  assert.equal(pending.braintree_amount_usd, 9.23);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM tickets WHERE order_id=?').get(pending.id).total, 0);

  const invalidAccess = await request(app).post(`/api/orders/${pending.id}/googlepay-capture`)
    .set(accountAuth).send({ nonce: 'one-time-nonce' });
  assert.equal(invalidAccess.status, 404);
  assert.equal(googlePayTransactionCalls, 0);

  const captured = await request(app).post(`/api/orders/${pending.id}/googlepay-capture`)
    .set(accountAuth)
    .set('X-Order-Access', checkout.body.accessToken)
    .send({ nonce: 'one-time-nonce', deviceData: '{"correlationId":"test"}', postalCode: '00100' });
  assert.equal(captured.status, 200);
  assert.equal(captured.body.status, 'completed');
  assert.equal(braintreeGateway.lastTransaction.amountUsd, 9.23);
  assert.equal(braintreeGateway.lastTransaction.orderId, pending.id);
  assert.equal(braintreeGateway.lastTransaction.postalCode, '00100');

  const paid = await request(app).get(`/api/orders/${pending.id}`)
    .set(accountAuth).set('X-Order-Access', checkout.body.accessToken);
  assert.equal(paid.body.status, 'paid');
  assert.equal(paid.body.paymentMethod, 'googlepay');
  assert.equal(paid.body.googlePayAmountUsd, 9.23);
  assert.equal(paid.body.tickets.length, 1);
  assert.equal(db.prepare('SELECT braintree_transaction_id FROM orders WHERE id=?').get(pending.id).braintree_transaction_id,
    `BRAINTREE-${pending.id}`);

  const replay = await request(app).post(`/api/orders/${pending.id}/googlepay-capture`)
    .set(accountAuth)
    .set('X-Order-Access', checkout.body.accessToken)
    .send({ nonce: 'different-nonce' });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.status, 'paid');
  assert.equal(googlePayTransactionCalls, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM tickets WHERE order_id=?').get(pending.id).total, 1);

  const reviewCheckout = await request(app).post('/api/orders/tickets').set(accountAuth).send({
    eventId: event.id,
    ticketType: 'Regular',
    buyerName: 'Google Pay Review Buyer',
    quantity: 1,
    paymentMethod: 'googlepay',
    googlePayQuotedAmountUsd: 9.23
  });
  braintreeGateway.nextTransactionResult = {
    success: true,
    transactionId: 'BRAINTREE-WRONG-AMOUNT',
    amountUsd: 1
  };
  const mismatchedCapture = await request(app).post(`/api/orders/${reviewCheckout.body.orderId}/googlepay-capture`)
    .set(accountAuth)
    .set('X-Order-Access', reviewCheckout.body.accessToken)
    .send({ nonce: 'mismatched-amount-nonce' });
  assert.equal(mismatchedCapture.status, 409);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(reviewCheckout.body.orderId).status, 'review');
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM tickets WHERE order_id=?').get(reviewCheckout.body.orderId).total, 0);

  const declinedCheckout = await request(app).post('/api/orders/tickets').set(accountAuth).send({
    eventId: event.id,
    ticketType: 'Regular',
    buyerName: 'Google Pay Declined Buyer',
    quantity: 1,
    paymentMethod: 'googlepay',
    googlePayQuotedAmountUsd: 9.23
  });
  braintreeGateway.nextTransactionResult = {
    success: false,
    transactionId: 'BRAINTREE-DECLINED',
    amountUsd: 9.23
  };
  const declined = await request(app).post(`/api/orders/${declinedCheckout.body.orderId}/googlepay-capture`)
    .set(accountAuth)
    .set('X-Order-Access', declinedCheckout.body.accessToken)
    .send({ nonce: 'declined-nonce' });
  assert.equal(declined.status, 402);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(declinedCheckout.body.orderId).status, 'failed');
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM tickets WHERE order_id=?').get(declinedCheckout.body.orderId).total, 0);
});

test('Apple Pay ticket checkout stays gated until configured and charges the verified Braintree total once', async () => {
  const accountAuth = createTestAccountAuth('apple-pay-ticket-buyer@example.com');
  const event = createStoredTestEvent('Apple Pay Ticket Checkout', accountAuth);
  const noAccountToken = await request(app).post('/api/payments/applepay/client-token');
  assert.equal(noAccountToken.status, 401);

  braintreeGateway.applePayEnabled = false;
  const unavailable = await request(app).post('/api/payments/applepay/client-token').set(accountAuth);
  const unavailableHealth = await request(app).get('/api/health');
  braintreeGateway.applePayEnabled = true;
  assert.equal(unavailable.status, 503);
  assert.equal(unavailableHealth.body.applePayConfigured, false);

  const clientToken = await request(app).post('/api/payments/applepay/client-token').set(accountAuth);
  assert.equal(clientToken.status, 200);
  assert.equal(clientToken.body.clientToken, 'test-braintree-client-token');
  assert.equal(clientToken.body.environment, 'TEST');

  const amountBeforeInvalidQuote = db.prepare("SELECT COUNT(*) AS total FROM orders WHERE payment_method='applepay'").get().total;
  const invalidQuote = await request(app).post('/api/orders/tickets').set(accountAuth).send({
    eventId: event.id,
    ticketType: 'Regular',
    buyerName: 'Apple Pay Buyer',
    quantity: 1,
    paymentMethod: 'applepay',
    applePayQuotedAmountUsd: 1
  });
  assert.equal(invalidQuote.status, 409);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM orders WHERE payment_method='applepay'").get().total, amountBeforeInvalidQuote);

  const checkout = await request(app).post('/api/orders/tickets').set(accountAuth).send({
    eventId: event.id,
    ticketType: 'Regular',
    buyerName: 'Apple Pay Buyer',
    quantity: 1,
    paymentMethod: 'applepay',
    applePayQuotedAmountUsd: 9.23
  });
  assert.equal(checkout.status, 201);
  assert.equal(checkout.body.paymentMethod, 'applepay');
  assert.equal(checkout.body.applePayAmountUsd, 9.23);
  const pending = db.prepare('SELECT * FROM orders WHERE id=?').get(checkout.body.orderId);
  assert.equal(pending.payment_method, 'applepay');
  assert.equal(pending.phone, '');
  assert.equal(pending.braintree_amount_usd, 9.23);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM tickets WHERE order_id=?').get(pending.id).total, 0);

  const invalidAccess = await request(app).post(`/api/orders/${pending.id}/applepay-capture`)
    .set(accountAuth).send({ nonce: 'one-time-nonce' });
  assert.equal(invalidAccess.status, 404);
  assert.equal(applePayTransactionCalls, 0);

  const captured = await request(app).post(`/api/orders/${pending.id}/applepay-capture`)
    .set(accountAuth)
    .set('X-Order-Access', checkout.body.accessToken)
    .send({ nonce: 'one-time-nonce', deviceData: '{"correlationId":"test"}', postalCode: '00100' });
  assert.equal(captured.status, 200);
  assert.equal(captured.body.status, 'completed');
  assert.equal(braintreeGateway.lastTransaction.amountUsd, 9.23);
  assert.equal(braintreeGateway.lastTransaction.orderId, pending.id);
  assert.equal(braintreeGateway.lastTransaction.postalCode, '00100');

  const paid = await request(app).get(`/api/orders/${pending.id}`)
    .set(accountAuth).set('X-Order-Access', checkout.body.accessToken);
  assert.equal(paid.body.status, 'paid');
  assert.equal(paid.body.paymentMethod, 'applepay');
  assert.equal(paid.body.applePayAmountUsd, 9.23);
  assert.equal(paid.body.tickets.length, 1);
  assert.equal(db.prepare('SELECT braintree_transaction_id FROM orders WHERE id=?').get(pending.id).braintree_transaction_id,
    `BRAINTREE-${pending.id}`);

  const replay = await request(app).post(`/api/orders/${pending.id}/applepay-capture`)
    .set(accountAuth)
    .set('X-Order-Access', checkout.body.accessToken)
    .send({ nonce: 'different-nonce' });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.status, 'paid');
  assert.equal(applePayTransactionCalls, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM tickets WHERE order_id=?').get(pending.id).total, 1);
});

test('paid ticket order issues only after PayHero verifies the callback', async () => {
  const event = db.prepare("SELECT id FROM events WHERE slug='test-live-festival'").get();
  const accountAuth = await ticketAccountAuth();
  const checkout = await request(app).post('/api/orders/tickets').set(accountAuth)
    .send({ eventId: event.id, ticketType: 'Early bird', buyerName: 'Buyer', phone: '+254 113-665-283', quantity: 2 });
  assert.equal(checkout.status, 201);
  assert.equal(paymentGateway.lastOrder.phone, '254113665283');
  assert.equal(db.prepare('SELECT account_id FROM orders WHERE id=?').get(checkout.body.orderId).account_id,
    (await request(app).get('/api/auth/account').set(accountAuth)).body.account.id);
  assert.equal((await request(app).get(`/api/orders/${checkout.body.orderId}`)
    .set('X-Order-Access', checkout.body.accessToken)).status, 401);
  const otherAccountAuth = await ticketAccountAuth('another-google-token');
  assert.equal((await request(app).get(`/api/orders/${checkout.body.orderId}`)
    .set(otherAccountAuth).set('X-Order-Access', checkout.body.accessToken)).status, 404);
  const order = await request(app).get(`/api/orders/${checkout.body.orderId}`)
    .set(accountAuth).set('X-Order-Access', checkout.body.accessToken);
  assert.equal(order.body.status, 'pending');

  const verified = await completePayment('checkout-1', 'merchant-1', 1600, 'TEST123456');
  assert.equal(verified.status, 200);
  const paid = await request(app).get(`/api/orders/${checkout.body.orderId}`)
    .set(accountAuth).set('X-Order-Access', checkout.body.accessToken);
  assert.equal(paid.body.status, 'paid');
  assert.equal(paid.body.receipt, 'TEST123456');
  assert.equal(paid.body.tickets.length, 2);
  assert.match(paid.body.tickets[0].qr, /^data:image\/png;base64,/);
  const ticket = await request(app).get(`/api/tickets/${paid.body.tickets[0].code}/verify`);
  assert.equal(ticket.body.valid, true);
  assert.equal(ticket.body.eventTitle, 'Test Live Festival');
  await app.locals.retryPendingTicketEmails();
  assert.equal(db.prepare('SELECT ticket_email_status FROM orders WHERE id=?').get(checkout.body.orderId).ticket_email_status, 'sent');
});

test('forged success callbacks do not issue tickets without PayHero verification', async () => {
  const event = db.prepare("SELECT id FROM events WHERE slug='test-live-festival'").get();
  const accountAuth = await ticketAccountAuth();
  const checkout = await request(app).post('/api/orders/tickets').set(accountAuth)
    .send({ eventId: event.id, ticketType: 'Early bird', buyerName: 'Buyer', phone: '0712345678', quantity: 1 });
  paymentGateway.queryStkPush = async (checkoutRequestId) => ({
    CheckoutRequestID: checkoutRequestId,
    ResultCode: '1032',
    ResultDesc: 'The transaction has not succeeded'
  });
  await completePayment('checkout-2', 'merchant-2', 800, 'FORGED1');
  const unpaid = await request(app).get(`/api/orders/${checkout.body.orderId}`)
    .set(accountAuth).set('X-Order-Access', checkout.body.accessToken);
  assert.equal(unpaid.body.status, 'pending');
  assert.equal(unpaid.body.tickets, undefined);
  paymentGateway.queryStkPush = async (checkoutRequestId) => ({ CheckoutRequestID: checkoutRequestId, ResultCode: '0' });
});

test('organizers can pay for an admin-priced package and publish its event ad', async () => {
  const packageResponse = await request(app).post('/api/ads/admin/packages')
    .set(admin)
    .send({ name: 'Homepage feature', description: 'Featured home carousel.', placement: 'homepage', pricePerDayKes: 1875, minDays: 1, maxDays: 30 });
  assert.equal(packageResponse.status, 201);
  const event = db.prepare("SELECT id FROM events WHERE slug='test-live-festival'").get();
  const checkout = await request(app).post('/api/orders/ads')
    .send({
      eventId: event.id,
      packageId: packageResponse.body.id,
      days: 4,
      buyerName: 'Event Organizer',
      phone: '0712345678'
    });
  assert.equal(checkout.status, 201);
  const beforePayment = await request(app).get('/api/ads/featured');
  assert.equal(beforePayment.body.events.length, 0);
  await completePayment('checkout-3', 'merchant-3', 7500, 'AD12345678');
  const paidOrder = await request(app).get(`/api/orders/${checkout.body.orderId}`)
    .set('X-Order-Access', checkout.body.accessToken);
  assert.equal(paidOrder.body.status, 'paid');
  assert.equal(paidOrder.body.campaign.campaignStatus, 'active');
  const afterPayment = await request(app).get('/api/ads/featured');
  assert.equal(afterPayment.body.events.length, 1);
  assert.equal(afterPayment.body.events[0].title, 'Test Live Festival');
});

test('paid event ads do not consume ticket capacity', async () => {
  const submitted = await submitEvent('Separate Ad And Ticket Capacity');
  assert.equal(submitted.status, 201);
  db.prepare('UPDATE events SET capacity=1 WHERE id=?').run(submitted.body.id);
  const packageRow = db.prepare("SELECT id FROM ad_packages WHERE name='Homepage feature'").get();
  const ad = await request(app).post('/api/orders/ads').send({
    eventId: submitted.body.id,
    packageId: packageRow.id,
    days: 4,
    buyerName: 'Event Organizer',
    phone: '0712345678'
  });
  assert.equal(ad.status, 201);
  await completePayment('checkout-4', 'merchant-4', 7500, 'ADCAP12345');
  const ticket = await request(app).post('/api/orders/tickets').set(await ticketAccountAuth()).send({
    eventId: submitted.body.id,
    ticketType: 'Early bird',
    buyerName: 'Ticket Buyer',
    phone: '0712345678',
    quantity: 1
  });
  assert.equal(ticket.status, 201);
});

test('organizers can see daily page-view and ticket-sale analytics for their events, scoped to ads purchased', async () => {
  const organizerAuth = createTestAccountAuth('ad-analytics-organizer@example.com');
  const event = createStoredTestEvent('Ad Analytics Festival', organizerAuth);

  assert.equal((await request(app).post(`/api/events/${event.id}/views`)).status, 204);
  assert.equal((await request(app).post(`/api/events/${event.id}/views`)).status, 204);
  assert.equal((await request(app).post(`/api/events/${event.id}/views`)).status, 204);
  assert.equal((await request(app).post(`/api/events/${crypto.randomUUID()}/views`)).status, 404);

  const todayStr = new Date().toISOString().slice(0, 10);
  const noAdsYet = await request(app).get(`/api/events/mine/${event.id}/ad-analytics`).set(organizerAuth);
  assert.equal(noAdsYet.status, 200);
  assert.equal(noAdsYet.body.adBookings.length, 0);
  assert.equal(noAdsYet.body.daily.find((day) => day.date === todayStr).views, 3);
  assert.equal(noAdsYet.body.totals.views, 3);

  const otherOrganizerAuth = createTestAccountAuth('ad-analytics-other@example.com');
  const wrongOwner = await request(app).get(`/api/events/mine/${event.id}/ad-analytics`).set(otherOrganizerAuth);
  assert.equal(wrongOwner.status, 404);

  const packageResponse = await request(app).post('/api/ads/admin/packages')
    .set(admin)
    .send({ name: 'Analytics package', description: 'For analytics test.', placement: 'homepage', pricePerDayKes: 400, minDays: 1, maxDays: 30 });
  assert.equal(packageResponse.status, 201);
  const startsAt = new Date(Date.now() - 2 * 86400000).toISOString();
  const endsAt = new Date(Date.now() + 3 * 86400000).toISOString();
  db.prepare(`
    INSERT INTO ad_bookings (id,event_id,package_id,status,starts_at,ends_at,days,placement,total_price_kes)
    VALUES (?,?,?,'active',?,?,5,'homepage',2000)
  `).run(crypto.randomUUID(), event.id, packageResponse.body.id, startsAt, endsAt);

  const withAd = await request(app).get(`/api/events/mine/${event.id}/ad-analytics`).set(organizerAuth);
  assert.equal(withAd.status, 200);
  assert.equal(withAd.body.adBookings.length, 1);
  assert.equal(withAd.body.adBookings[0].packageName, 'Analytics package');
  assert.equal(withAd.body.adBookings[0].status, 'active');
  assert.ok(withAd.body.rangeStart <= startsAt.slice(0, 10));
  assert.ok(withAd.body.daily.some((day) => day.date === startsAt.slice(0, 10)));
  assert.equal(withAd.body.daily.find((day) => day.date === todayStr).views, 3);
});

test('organizers can edit and archive their events but cannot manage another account event', async () => {
  const ownerEmail = 'event-editor@example.com';
  const owner = createTestAccountAuth(ownerEmail);
  const other = createTestAccountAuth('event-not-owner@example.com');
  const created = createStoredTestEvent('Editable Festival', owner);
  const future = Date.now() + 14 * 86400000;
  const updated = await request(app).patch(`/api/events/mine/${created.id}`)
    .set(owner)
    .field('title', 'Updated Festival')
    .field('description', 'Updated description for the festival.')
    .field('category', 'Concerts')
    .field('format', 'Hybrid')
    .field('timezone', 'Africa/Nairobi')
    .field('startsAt', new Date(future).toISOString())
    .field('endsAt', new Date(future + 3 * 3600000).toISOString())
    .field('venueName', 'Updated Hall')
    .field('meetingUrl', 'https://meet.example.com/event')
    .field('city', 'Nairobi')
    .field('capacity', '40')
    .field('regularPrice', '1500')
    .field('earlyBirdPrice', '')
    .field('earlyBirdEnds', '')
    .field('vipPrice', '')
    .field('slug', 'updated-festival')
    .field('tags', 'live music')
    .field('organizerName', 'Event Organizer')
    .field('organizerEmail', 'organizer@example.com')
    .field('organizerPhone', '0712345678');
  assert.equal(updated.status, 200);
  assert.equal(updated.body.slug, 'updated-festival');
  assert.equal((await request(app).get('/api/events/by-slug/updated-festival')).body.event.title, 'Updated Festival');

  assert.equal((await request(app).patch(`/api/events/mine/${created.id}`)).status, 401);
  assert.equal((await request(app).patch(`/api/events/mine/${created.id}`).set(other).field('title', 'Not theirs')).status, 404);
  assert.equal((await request(app).delete(`/api/events/mine/${created.id}`).set(other)).status, 404);
  const archived = await request(app).delete(`/api/events/mine/${created.id}`).set(owner);
  assert.equal(archived.status, 200);
  assert.equal(archived.body.archived, true);
  assert.equal((await request(app).get('/api/events/by-slug/updated-festival')).status, 404);
  assert.equal((await request(app).get('/api/events')).body.events.some((event) => event.id === created.id), false);
  const dashboard = await request(app).get('/api/events/mine').set(owner);
  assert.equal(dashboard.body.events.find((event) => event.id === created.id).archived, true);
  assert.equal((await request(app).delete(`/api/events/mine/${created.id}`).set(owner)).status, 404);
});

test('events with ticket orders cannot be edited or removed by organizers', async () => {
  const ownerEmail = 'event-with-order@example.com';
  const owner = createTestAccountAuth(ownerEmail);
  const created = createStoredTestEvent('Event With Order', owner);
  db.prepare(`
    INSERT INTO orders (id,access_token_hash,order_type,event_id,buyer_name,phone,ticket_type,quantity,amount_kes)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(crypto.randomUUID(), 'test-access-hash', 'ticket', created.id, 'Ticket Buyer', '254712345678', 'Regular', 1, 1200);
  const pendingPublicEvent = (await request(app).get('/api/events')).body.events
    .find((event) => event.id === created.id);
  assert.equal(pendingPublicEvent.ticketsSold, 0);
  db.prepare("UPDATE orders SET status='paid' WHERE event_id=?").run(created.id);
  const paidPublicEvent = (await request(app).get('/api/events')).body.events
    .find((event) => event.id === created.id);
  assert.equal(paidPublicEvent.ticketsSold, 1);
  const ownerEvent = (await request(app).get('/api/events/mine').set(owner)).body.events
    .find((event) => event.id === created.id);
  assert.equal(ownerEvent.hasActiveOrders, true);
  const deleted = await request(app).delete(`/api/events/mine/${created.id}`).set(owner);
  assert.equal(deleted.status, 409);
  assert.match(deleted.body.error, /ticket orders/i);
  const edited = await request(app).patch(`/api/events/mine/${created.id}`).set(owner);
  assert.equal(edited.status, 409);
  assert.match(edited.body.error, /tickets sold/i);
});

test('free registrations require an account but do not require M-Pesa', async () => {
  const submitted = await submitEvent('Free Ticket Registration');
  assert.equal(submitted.status, 201);
  db.prepare(`
    UPDATE events SET capacity=2,regular_price=0,early_bird_price=NULL,
      early_bird_ends=NULL,vip_price=NULL WHERE id=?
  `).run(submitted.body.id);
  paymentGateway.enabled = false;
  const accountAuth = createTestAccountAuth(`free-ticket-buyer-${crypto.randomUUID()}@example.com`);
  const anonymous = await request(app).post('/api/orders/tickets').send({
    eventId: submitted.body.id,
    ticketType: 'Regular',
    buyerName: 'Free Ticket Buyer',
    phone: '0712345678',
    quantity: 1
  });
  assert.equal(anonymous.status, 401);
  const registration = await request(app).post('/api/orders/tickets').set(accountAuth).send({
    eventId: submitted.body.id,
    ticketType: 'Regular',
    buyerName: 'Free Ticket Buyer',
    phone: '0712345678',
    quantity: 1
  });
  assert.equal(registration.status, 201);
  assert.equal(registration.body.status, 'confirmed');
  await app.locals.retryPendingTicketEmails();
  assert.equal(db.prepare('SELECT ticket_email_status FROM orders WHERE id=?').get(registration.body.orderId).ticket_email_status, 'sent');
  const order = await request(app).get(`/api/orders/${registration.body.orderId}`)
    .set(accountAuth).set('X-Order-Access', registration.body.accessToken);
  assert.equal(order.body.status, 'confirmed');
  assert.equal(order.body.amountKes, 0);
  assert.equal(order.body.ticketEmailStatus, 'sent');
  assert.equal(order.body.tickets.length, 1);
  assert.equal(order.body.tickets[0].eventTitle, 'Free Ticket Registration');
  assert.equal(order.body.tickets[0].title, 'Free Ticket Registration');
  assert.match(order.body.tickets[0].qr, /^data:image\/png;base64,/);
  const accountTickets = await request(app).get('/api/account/tickets').set(accountAuth);
  assert.equal(accountTickets.status, 200);
  const accountTicket = accountTickets.body.tickets.find((ticket) => ticket.orderId === registration.body.orderId);
  assert.ok(accountTicket);
  assert.equal(accountTicket.ticketEmailStatus, 'sent');
  assert.equal(accountTicket.loved, 0);
  assert.match(accountTicket.qr, /^data:image\/png;base64,/);

  const unrelatedAuth = createTestAccountAuth('unrelated-ticket-owner@example.com');
  const noTicketFeedback = await request(app).get(`/api/account/events/${submitted.body.id}/feedback`)
    .set(unrelatedAuth);
  assert.equal(noTicketFeedback.status, 200);
  assert.equal(noTicketFeedback.body.hasTicket, false);

  const ticketFeedback = await request(app).get(`/api/account/events/${submitted.body.id}/feedback`)
    .set(accountAuth);
  assert.equal(ticketFeedback.status, 200);
  assert.equal(ticketFeedback.body.hasTicket, true);
  assert.ok(ticketFeedback.body.endsAt);

  const noTicketReview = await request(app).post(`/api/account/events/${submitted.body.id}/feedback`)
    .set(unrelatedAuth).send({ loved: true, rating: 5, review: 'I was not even there.' });
  assert.equal(noTicketReview.status, 403);
  assert.match(noTicketReview.body.error, /attended/i);

  const tooEarlyReview = await request(app).post(`/api/account/events/${submitted.body.id}/feedback`)
    .set(accountAuth).send({ loved: true, rating: 5, review: 'Reviewing before it even happened.' });
  assert.equal(tooEarlyReview.status, 403);
  assert.match(tooEarlyReview.body.error, /ended/i);

  db.prepare(`UPDATE events SET ends_at=datetime('now','-1 day') WHERE id=?`).run(submitted.body.id);

  const loved = await request(app).post(`/api/account/events/${submitted.body.id}/feedback`)
    .set(accountAuth).send({ loved: true, rating: 5, review: 'Really enjoyed this event.' });
  assert.equal(loved.status, 200);
  assert.deepEqual(loved.body, { loved: true, rating: 5, review: 'Really enjoyed this event.' });
  const updatedTicket = await request(app).get('/api/account/tickets').set(accountAuth);
  const reviewedTicket = updatedTicket.body.tickets.find((ticket) => ticket.orderId === registration.body.orderId);
  assert.equal(reviewedTicket.loved, 1);
  assert.equal(reviewedTicket.rating, 5);
  assert.ok(reviewedTicket.endsAt);
  const publicReviews = await request(app).get(`/api/events/${submitted.body.id}/reviews`);
  assert.equal(publicReviews.status, 200);
  assert.equal(publicReviews.body.ratingCount, 1);
  assert.equal(publicReviews.body.averageRating, 5);
  assert.equal(publicReviews.body.reviews.length, 1);
  assert.equal(publicReviews.body.reviews[0].review, 'Really enjoyed this event.');
  assert.equal(reviewedTicket.review, 'Really enjoyed this event.');
  const invalidReview = await request(app).post(`/api/account/events/${submitted.body.id}/feedback`)
    .set(accountAuth).send({ loved: true, rating: 6, review: '' });
  assert.equal(invalidReview.status, 400);
  const unauthorizedReview = await request(app).post(`/api/account/events/${submitted.body.id}/feedback`)
    .set(unrelatedAuth)
    .send({ loved: true, rating: null, review: '' });
  assert.equal(unauthorizedReview.status, 200);
  assert.deepEqual(unauthorizedReview.body, { loved: true, rating: null, review: '' });
  const unrelatedTickets = await request(app).get('/api/account/tickets')
    .set(unrelatedAuth);
  assert.equal(unrelatedTickets.body.tickets.some((ticket) => ticket.orderId === registration.body.orderId), false);

  const accountId = db.prepare(`
    SELECT account_id FROM account_sessions WHERE token_hash=?
  `).get(crypto.createHash('sha256').update(accountAuth.Authorization.slice('Bearer '.length)).digest('hex')).account_id;
  const legacyPhone = `2547${crypto.randomInt(10000000, 99999999)}`;
  db.prepare('INSERT INTO wallets (id,phone,account_type,account_id) VALUES (?,?,?,?)')
    .run(crypto.randomUUID(), legacyPhone, 'buyer', accountId);
  const legacyOrderId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO orders (
      id,access_token_hash,order_type,event_id,buyer_name,phone,ticket_type,quantity,
      amount_kes,payment_method,status
    ) VALUES (?,?,'ticket',?,'Legacy Buyer',?,'Regular',1,1200,'mpesa','paid')
  `).run(legacyOrderId, crypto.randomBytes(32).toString('hex'), submitted.body.id, `0${legacyPhone.slice(-9)}`);
  db.prepare('INSERT INTO tickets (code,order_id,event_id,ticket_type) VALUES (?,?,?,?)')
    .run(crypto.randomUUID(), legacyOrderId, submitted.body.id, 'Regular');
  const restoredTickets = await request(app).get('/api/account/tickets').set(accountAuth);
  assert.equal(restoredTickets.status, 200);
  assert.ok(restoredTickets.body.tickets.some((ticket) => ticket.orderId === legacyOrderId));
  const restoredFeedback = await request(app).post(`/api/account/events/${submitted.body.id}/feedback`)
    .set(accountAuth).send({ loved: true, rating: 4, review: 'Loved this older ticket.' });
  assert.equal(restoredFeedback.status, 200);
  db.prepare(`UPDATE events SET starts_at=datetime('now','+1 day'),ends_at=datetime('now','+2 day') WHERE id=?`)
    .run(submitted.body.id);
  const futureEventReviews = await request(app).get(`/api/events/${submitted.body.id}/reviews`);
  assert.equal(futureEventReviews.body.loveCount, 2);
  assert.equal(futureEventReviews.body.ratingCount, 0);
  assert.equal(futureEventReviews.body.averageRating, null);
  assert.equal(futureEventReviews.body.reviewCount, 0);
  assert.equal(futureEventReviews.body.reviews.length, 0);

  const verification = await request(app).get(`/api/tickets/${order.body.tickets[0].code}/verify`);
  assert.equal(verification.body.valid, true);
  paymentGateway.enabled = true;
});

test('account sign-in links existing phone wallet and pays verified deposits, tickets, and promotions', async () => {
  const legacyWalletId = 'legacy-phone-wallet';
  db.prepare("INSERT INTO wallets (id,phone,account_type) VALUES (?,'254712345678','organizer')").run(legacyWalletId);
  db.prepare(`
    INSERT INTO wallet_transactions (id,wallet_id,transaction_type,amount_kes,status,receipt,description,completed_at)
    VALUES ('legacy-deposit',?,'deposit',1200,'completed','LEGACY123','Existing phone-wallet balance',datetime('now'))
  `).run(legacyWalletId);

  const accountLogin = await request(app).post('/api/auth/google').send({ idToken: 'wallet-google-token' });
  assert.equal(accountLogin.status, 200);
  const walletAuth = { Authorization: `Bearer ${accountLogin.body.accessToken}` };
  assert.equal((await request(app).get('/api/wallet').set(walletAuth)).body.linked, false);
  assert.equal((await request(app).post('/api/wallet/otp').send({ phone: '0712345678' })).status, 404);
  assert.equal((await request(app).get('/api/wallet')).status, 401);

  const otp = await request(app).post('/api/account/phone/otp').set(walletAuth).send({ phone: '0712345678' });
  assert.equal(otp.status, 202);
  const code = smsCodes.get('254712345678');
  assert.match(code, /^\d{6}$/);
  assert.equal((await request(app).post('/api/account/phone/verify').set(walletAuth).send({
    phone: '0712345678',
    code: '000000',
    accountType: 'organizer'
  })).status, 401);
  const linked = await request(app).post('/api/account/phone/verify').set(walletAuth).send({
    phone: '0712345678',
    code,
    accountType: 'organizer'
  });
  assert.equal(linked.status, 200);
  assert.equal(linked.body.wallet.accountType, 'organizer');
  assert.equal(linked.body.balanceKes, 1200);
  assert.equal(db.prepare('SELECT account_id FROM wallets WHERE id=?').get(legacyWalletId).account_id, accountLogin.body.account.id);

  const anotherAccount = await request(app).post('/api/auth/google').send({ idToken: 'another-google-token' });
  const anotherAuth = { Authorization: 'Bearer ' + anotherAccount.body.accessToken };
  assert.equal((await request(app).post('/api/account/phone/otp').set(anotherAuth)
    .send({ phone: '0712345678' })).status, 409);

  const event = db.prepare("SELECT id FROM events WHERE slug='test-live-festival'").get();
  const insufficient = await request(app).post('/api/orders/tickets').set(walletAuth).send({
    eventId: event.id,
    ticketType: 'Early bird',
    buyerName: 'Organizer Buyer',
    quantity: 2,
    paymentMethod: 'wallet'
  });
  assert.equal(insufficient.status, 402);

  const deposit = await request(app).post('/api/wallet/deposits').set(walletAuth).send({ amountKes: 5000 });
  assert.equal(deposit.status, 201);
  const unsupportedDeposit = await request(app).post('/api/wallet/deposits').set(walletAuth).send({
    amountKes: 5000,
    paymentMethod: 'applepay'
  });
  assert.equal(unsupportedDeposit.status, 400);
  assert.equal((await request(app).get('/api/wallet').set(walletAuth)).body.balanceKes, 1200);
  await completePayment('checkout-6', 'merchant-6', 5000, 'WALLET1234');
  const funded = await request(app).get('/api/wallet').set(walletAuth);
  assert.equal(funded.body.balanceKes, 6200);
  await completePayment('checkout-6', 'merchant-6', 5000, 'WALLET1234');
  assert.equal((await request(app).get('/api/wallet').set(walletAuth)).body.balanceKes, 6200);

  const ticketOrder = await request(app).post('/api/orders/tickets').set(walletAuth).send({
    eventId: event.id,
    ticketType: 'Early bird',
    buyerName: 'Organizer Buyer',
    quantity: 2,
    paymentMethod: 'wallet'
  });
  assert.equal(ticketOrder.status, 201);
  assert.equal(ticketOrder.body.status, 'paid');
  const paidTickets = await request(app).get(`/api/orders/${ticketOrder.body.orderId}`)
    .set(walletAuth).set('X-Order-Access', ticketOrder.body.accessToken);
  assert.equal(paidTickets.body.tickets.length, 2);
  assert.equal((await request(app).get('/api/wallet').set(walletAuth)).body.balanceKes, 4600);

  const secondDeposit = await request(app).post('/api/wallet/deposits').set(walletAuth).send({ amountKes: 10000 });
  assert.equal(secondDeposit.status, 201);
  await completePayment('checkout-7', 'merchant-7', 10000, 'WALLET5678');
  const packageRow = db.prepare("SELECT id FROM ad_packages WHERE name='Homepage feature'").get();
  const adOrder = await request(app).post('/api/orders/ads').set(walletAuth).send({
    eventId: event.id,
    packageId: packageRow.id,
    days: 4,
    buyerName: 'Event Organizer',
    paymentMethod: 'wallet'
  });
  assert.equal(adOrder.status, 201);
  const paidAd = await request(app).get(`/api/orders/${adOrder.body.orderId}`)
    .set('X-Order-Access', adOrder.body.accessToken);
  assert.equal(paidAd.body.campaign.campaignStatus, 'active');
  assert.equal((await request(app).get('/api/wallet').set(walletAuth)).body.balanceKes, 7100);

  const publicProducts = await request(app).get('/api/shop/products');
  assert.equal(publicProducts.status, 200);
  assert.equal(publicProducts.body.products.some((product) => product.id === 'valor-tote'), true);
  assert.equal((await request(app).get('/api/shop/admin/products')).status, 401);
  const product = await request(app).post('/api/shop/admin/products').set(admin).send({
    name: 'Limited event pin',
    description: 'A limited-run enamel pin.',
    priceKes: 350,
    imageUrl: '/images/one.jpg',
    stock: 1
  });
  assert.equal(product.status, 201);
  const merchandiseOrder = {
    items: [{ productId: product.body.id, quantity: 1, priceKes: 1 }],
    customerName: 'Organizer Buyer',
    phone: '0712345678',
    deliveryAddress: 'Nairobi, Westlands',
    clientRequestId: '30000000-0000-4000-8000-000000000001'
  };
  assert.equal((await request(app).post('/api/orders/merchandise').send(merchandiseOrder)).status, 401);
  assert.equal((await request(app).post('/api/orders/merchandise').set(walletAuth).send({
    ...merchandiseOrder,
    items: [{ productId: product.body.id, quantity: 11 }]
  })).status, 400);
  const unsupportedMerchandisePayment = await request(app).post('/api/orders/merchandise').set(walletAuth).send({
    ...merchandiseOrder,
    paymentMethod: 'crypto'
  });
  assert.equal(unsupportedMerchandisePayment.status, 400);
  const purchase = await request(app).post('/api/orders/merchandise').set(walletAuth).send(merchandiseOrder);
  assert.equal(purchase.status, 201);
  assert.equal(purchase.body.status, 'paid');
  assert.equal(purchase.body.amountKes, 350);
  assert.equal(purchase.body.balanceKes, 6750);
  const repeatPurchase = await request(app).post('/api/orders/merchandise').set(walletAuth).send(merchandiseOrder);
  assert.equal(repeatPurchase.status, 200);
  assert.equal(repeatPurchase.body.orderId, purchase.body.orderId);
  assert.equal((await request(app).get('/api/wallet').set(walletAuth)).body.balanceKes, 6750);
  assert.equal(db.prepare('SELECT stock FROM merchandise_products WHERE id=?').get(product.body.id).stock, 0);
  const soldOut = await request(app).post('/api/orders/merchandise').set(walletAuth).send({
    ...merchandiseOrder,
    clientRequestId: '30000000-0000-4000-8000-000000000002'
  });
  assert.equal(soldOut.status, 409);
  const expensive = await request(app).post('/api/shop/admin/products').set(admin).send({
    name: 'Premium event banner',
    priceKes: 100000,
    stock: null
  });
  assert.equal(expensive.status, 201);
  const insufficientFunds = await request(app).post('/api/orders/merchandise').set(walletAuth).send({
    ...merchandiseOrder,
    items: [{ productId: expensive.body.id, quantity: 1 }],
    clientRequestId: '30000000-0000-4000-8000-000000000003'
  });
  assert.equal(insufficientFunds.status, 402);
  assert.equal((await request(app).get('/api/wallet').set(walletAuth)).body.balanceKes, 6750);
  const adminOrders = await request(app).get('/api/orders/admin').set(admin);
  const recordedOrder = adminOrders.body.orders.find((order) => order.id === purchase.body.orderId);
  assert.equal(recordedOrder.orderType, 'merchandise');
  assert.equal(recordedOrder.items[0].name, 'Limited event pin');
  assert.equal(recordedOrder.deliveryAddress, 'Nairobi, Westlands');

  assert.equal((await request(app).post('/api/auth/account/logout').set(walletAuth)).status, 200);
  assert.equal((await request(app).get('/api/wallet').set(walletAuth)).status, 401);
});

test('email verification, password reset, and Google sign-in create separate account sessions', async () => {
  const config = await request(app).get('/api/auth/config');
  assert.equal(config.status, 200);
  assert.equal(config.body.emailAuthConfigured, true);

  const email = 'member@example.com';
  const tooShortPassword = await request(app).post('/api/auth/email/register').send({
    email: 'short-password@example.com',
    displayName: 'Email Member',
    password: 'short7!'
  }).set('X-Forwarded-For', '198.51.100.30');
  assert.equal(tooShortPassword.status, 400);
  assert.match(tooShortPassword.body.error, /8 and 128/);
  const register = await request(app).post('/api/auth/email/register').send({
    email: '  MEMBER@example.com ',
    displayName: 'Email Member',
    password: 'Short8!!'
  });
  assert.equal(register.status, 202);
  assert.equal((await request(app).post('/api/auth/email/login').send({
    email,
    password: 'Short8!!'
  })).status, 403);

  const verifyCode = emailCodes.get(`${email}:verify`);
  assert.equal((await request(app).post('/api/auth/email/verify').send({ email, code: '000000' })).status, 401);
  const verified = await request(app).post('/api/auth/email/verify').send({ email, code: verifyCode });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.account.displayName, 'Email Member');
  const originalSession = { Authorization: `Bearer ${verified.body.accessToken}` };
  assert.equal((await request(app).get('/api/auth/account').set(originalSession)).body.account.email, email);

  assert.equal((await request(app).post('/api/auth/email/forgot-password').send({ email })).status, 202);
  const resetCode = emailCodes.get(`${email}:reset`);
  const tooShortResetPassword = await request(app).post('/api/auth/email/reset-password').send({
    email,
    code: resetCode,
    password: 'short7!'
  });
  assert.equal(tooShortResetPassword.status, 400);
  assert.match(tooShortResetPassword.body.error, /8 and 128/);
  const reset = await request(app).post('/api/auth/email/reset-password').send({
    email,
    code: resetCode,
    password: 'Reset8!!'
  });
  assert.equal(reset.status, 200);
  assert.equal((await request(app).get('/api/auth/account').set(originalSession)).status, 401);
  assert.equal((await request(app).post('/api/auth/email/login').send({
    email,
    password: 'Reset8!!'
  })).status, 200);

  const google = await request(app).post('/api/auth/google').send({ idToken: 'valid-google-token' });
  assert.equal(google.status, 200);
  assert.equal(google.body.account.email, 'google@example.com');
  const googleAuth = { Authorization: 'Bearer ' + google.body.accessToken };
  const emptyWallet = await request(app).get('/api/wallet').set(googleAuth);
  assert.equal(emptyWallet.status, 200);
  assert.equal(emptyWallet.body.linked, false);
  assert.equal((await request(app).post('/api/wallet/deposits').send({ amountKes: 1000 })).status, 401);
  assert.equal((await request(app).get('/api/wallet')).status, 401);

  emailGateway.enabled = false;
  assert.equal((await request(app).post('/api/auth/email/register')
    .set('X-Forwarded-For', '198.51.100.18')
    .send({
      email: 'disabled@example.com',
      password: 'a-long-test-password-123'
    })).status, 503);
  emailGateway.enabled = true;
});

test('partner terms acknowledgement is authenticated and required before partner actions', async () => {
  const current = await request(app).get('/api/partner-terms/current');
  assert.equal(current.status, 200);
  assert.equal(current.body.version, PARTNER_TERMS_VERSION);
  assert.equal(current.body.status, 'draft');

  assert.equal((await request(app).get('/api/partner-terms/me')).status, 401);
  assert.equal((await request(app).post('/api/partner-terms/acknowledge').send({})).status, 401);
  assert.equal((await request(app).get('/api/sponsorships/me')).status, 401);
  assert.equal((await request(app).post('/api/sponsorships').send({
    tier: 'community', brandName: 'Signed In Required', buyerName: 'Member', paymentMethod: 'paypal'
  })).status, 401);

  const auth = createTestAccountAuth('terms-applicant@example.com', { acknowledgeTerms: false });
  const status = await request(app).get('/api/partner-terms/me').set(auth);
  assert.equal(status.status, 200);
  assert.equal(status.body.acknowledgement, null);
  assert.equal((await request(app).post('/api/partners/apply').set(auth).send({})).status, 428);
  assert.equal((await request(app).post('/api/partnership-applications').set(auth).send({
    type: 'investment',
    organizationName: 'Interested Investor',
    applicationDetails: 'I would like to explore a non-binding investment discussion.'
  })).status, 428);
  assert.equal((await request(app).post('/api/sponsorships').set(auth).send({
    tier: 'community', brandName: 'Terms Required', buyerName: 'Terms Applicant', paymentMethod: 'paypal'
  })).status, 428);
  assert.equal((await request(app).post('/api/partner-terms/acknowledge').set(auth).send({
    version: PARTNER_TERMS_VERSION,
    signerName: 'Terms Applicant',
    acknowledged: false
  })).status, 400);
  assert.equal((await request(app).post('/api/partner-terms/acknowledge').set(auth).send({
    version: 'old-version',
    signerName: 'Terms Applicant',
    acknowledged: true
  })).status, 409);

  const acknowledged = await request(app).post('/api/partner-terms/acknowledge').set(auth).send({
    version: PARTNER_TERMS_VERSION,
    signerName: 'Terms Applicant',
    acknowledged: true
  });
  assert.equal(acknowledged.status, 201);
  assert.equal(acknowledged.body.acknowledgement.version, PARTNER_TERMS_VERSION);
  assert.equal((await request(app).get('/api/partner-terms/me').set(auth)).body.acknowledgement.signerName, 'Terms Applicant');
  assert.equal((await request(app).get('/api/sponsorships/me').set(auth)).status, 200);
});

test('creator partners activate immediately at 5% and earn attributable commissions only on paid ticket orders', async () => {
  const creatorAuth = createTestAccountAuth('creator-partner@example.com');
  assert.equal((await request(app).post('/api/partners/apply').send({})).status, 401);
  const invalidApplication = await request(app).post('/api/partners/apply').set(creatorAuth).send({
    socialPlatform: 'Instagram',
    profileUrl: 'http://instagram.example/creator',
    audienceDescription: 'I share events with my local community.'
  });

  assert.equal(invalidApplication.status, 400);
  const application = await request(app).post('/api/partners/apply').set(creatorAuth).send({
    socialPlatform: 'Instagram',
    profileUrl: 'https://instagram.example/creator',
    audienceDescription: 'I share Nairobi music and community events with my local audience.'
  });
  assert.equal(application.status, 201);
  assert.equal(application.body.status, 'approved');
  assert.equal(application.body.commissionPercent, 5);
  const creatorDashboardBeforePayment = await request(app).get('/api/partners/me').set(creatorAuth);
  assert.equal(creatorDashboardBeforePayment.body.partner.status, 'approved');
  assert.equal(creatorDashboardBeforePayment.body.partner.commissionPercent, 5);
  const partnerId = db.prepare('SELECT id FROM affiliate_partners WHERE account_id=?')
    .get(db.prepare('SELECT id FROM accounts WHERE email=?').get('creator-partner@example.com').id).id;
  const referralCode = creatorDashboardBeforePayment.body.partner.referralCode;
  assert.match(referralCode, /^[A-F0-9]{10}$/);
  db.prepare("UPDATE affiliate_partners SET status='pending',commission_percent=NULL WHERE id=?").run(partnerId);
  const legacyPartner = await request(app).get('/api/partners/me').set(creatorAuth);
  assert.equal(legacyPartner.body.partner.status, 'approved');
  assert.equal(legacyPartner.body.partner.commissionPercent, 5);
  assert.equal(legacyPartner.body.partner.referralCode, referralCode);
  const updatedCreator = await request(app).post('/api/partners/apply').set(creatorAuth).send({
    socialPlatform: 'TikTok',
    profileUrl: 'https://tiktok.example/creator',
    audienceDescription: 'I share local music events and ticket offers with my TikTok community.'
  });
  assert.equal(updatedCreator.status, 200);
  assert.equal(updatedCreator.body.referralCode, referralCode);
  assert.equal(updatedCreator.body.commissionPercent, 5);
  assert.equal((await request(app).get('/api/partners/admin')).status, 401);
  const adminPartnerList = await request(app).get('/api/partners/admin').set(admin);
  assert.equal(adminPartnerList.status, 200);
  assert.equal(adminPartnerList.body.partners.find((partner) => partner.id === partnerId).commissionPercent, 5);

  const visit = await request(app).post('/api/partners/visit').send({ code: referralCode });
  assert.equal(visit.status, 201);
  const inactiveVisit = await request(app).post('/api/partners/visit').send({ code: '0000000000' });
  assert.equal(inactiveVisit.status, 404);
  const submitted = await submitEvent('Creator Referral Festival')
    .set('X-Forwarded-For', '198.51.100.44');
  assert.equal(submitted.status, 201);
  const buyerAuth = createTestAccountAuth('referred-buyer@example.com');
  const ticketOrder = await request(app).post('/api/orders/tickets').set(buyerAuth).send({
    eventId: submitted.body.id,
    ticketType: 'Regular',
    quantity: 2,
    buyerName: 'Referred Buyer',
    phone: '0712345678',
    paymentMethod: 'mpesa',
    affiliateReferralToken: visit.body.referralToken
  });
  assert.equal(ticketOrder.status, 201);
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(ticketOrder.body.orderId);
  assert.equal(order.affiliate_partner_id, partnerId);
  assert.equal(order.affiliate_commission_percent, 5);
  assert.equal((await request(app).get('/api/partners/me').set(creatorAuth)).body.partner.earnedKes, 0);
  const paid = await completePayment(order.checkout_request_id, order.merchant_request_id, 2400, 'AFFILIATE01');
  assert.equal(paid.status, 200);
  const creatorDashboard = await request(app).get('/api/partners/me').set(creatorAuth);
  assert.equal(creatorDashboard.body.partner.clicks, 1);
  assert.equal(creatorDashboard.body.partner.conversions, 1);
  assert.equal(creatorDashboard.body.partner.earnedKes, 120);
  assert.equal(creatorDashboard.body.partner.dueKes, 120);

  const excessPayout = await request(app).post(`/api/partners/admin/${partnerId}/payout`).set(admin).send({
    amountKes: 121,
    reference: 'MPESA-REF-1'
  });
  assert.equal(excessPayout.status, 409);
  const payout = await request(app).post(`/api/partners/admin/${partnerId}/payout`).set(admin).send({
    amountKes: 100,
    reference: 'MPESA-REF-1',
    note: 'Manual payout test'
  });
  assert.equal(payout.status, 201);
  const afterPayout = await request(app).get('/api/partners/me').set(creatorAuth);
  assert.equal(afterPayout.body.partner.paidKes, 100);
  assert.equal(afterPayout.body.partner.dueKes, 20);
  const finalAdminPartner = await request(app).get('/api/partners/admin').set(admin);
  assert.equal(finalAdminPartner.body.partners.find((partner) => partner.id === partnerId).dueKes, 20);
  const duplicatePayout = await request(app).post(`/api/partners/admin/${partnerId}/payout`).set(admin).send({
    amountKes: 1,
    reference: 'mpesa-ref-1'
  });
  assert.equal(duplicatePayout.status, 409);

  const selfOrder = await request(app).post('/api/orders/tickets').set(creatorAuth).send({
    eventId: submitted.body.id,
    ticketType: 'Regular',
    quantity: 1,
    buyerName: 'Creator Self Purchase',
    phone: '0712345678',
    paymentMethod: 'mpesa',
    affiliateReferralToken: visit.body.referralToken
  });
  assert.equal(selfOrder.status, 201);
  const selfOrderRow = db.prepare('SELECT * FROM orders WHERE id=?').get(selfOrder.body.orderId);
  assert.equal(selfOrderRow.affiliate_partner_id, null);
});

test('artists publish searchable services, take booking deposits, and receive recorded manual payouts', async () => {
  const artistAuth = createTestAccountAuth(`artist-${crypto.randomUUID()}@example.com`);
  const organizerAuth = createTestAccountAuth(`organizer-${crypto.randomUUID()}@example.com`);
  const unacknowledgedAuth = createTestAccountAuth(`artist-terms-${crypto.randomUUID()}@example.com`, { acknowledgeTerms: false });
  assert.equal((await request(app).put('/api/artists/me').set(unacknowledgedAuth).send({})).status, 428);
  const profileResponse = await request(app).put('/api/artists/me').set(artistAuth).send({
    displayName: 'Nairobi Test Artist',
    artistType: 'both',
    bio: 'A professional event performer available for festivals and private events.',
    city: 'Nairobi',
    genres: 'Afrobeats, Amapiano',
    socialPlatform: 'Instagram',
    socialProfileUrl: 'https://www.instagram.com/test.artist/',
    portfolioUrl: 'https://artist.example.com',
    profileImageUrl: '',
    availabilityNote: 'Available weekends.'
  });
  assert.equal(profileResponse.status, 201);
  assert.match(profileResponse.body.referralUrl, /events\.html\?ref=/);
  assert.equal(profileResponse.body.profile.status, 'active');
  const artistDashboard = await request(app).get('/api/artists/me').set(artistAuth);
  assert.equal(artistDashboard.body.profile.slug, profileResponse.body.profile.slug);
  assert.equal(artistDashboard.body.referralStats.clicks, 0);

  const serviceResponse = await request(app).post('/api/artists/services').set(artistAuth).send({
    title: 'Festival DJ set',
    description: 'A high-energy DJ set for festivals, corporate events, and private celebrations.',
    category: 'DJ performance',
    priceKes: 1000,
    durationMinutes: 120,
    cancellationPolicy: 'Cancel at least seven days before the event for a full deposit refund.'
  });
  assert.equal(serviceResponse.status, 201);
  const serviceId = serviceResponse.body.service.id;
  const directory = await request(app).get('/api/artists?search=Afrobeats&city=Nairobi');
  assert.equal(directory.status, 200);
  assert.equal(directory.body.artists.length, 1);
  const publicProfile = await request(app).get(`/api/artists/${profileResponse.body.profile.slug}`);
  assert.equal(publicProfile.status, 200);
  assert.equal(publicProfile.body.artist.services[0].id, serviceId);

  const clientRequestId = crypto.randomUUID();
  const bookingResponse = await request(app).post('/api/artist-bookings').set(organizerAuth).send({
    serviceId,
    clientRequestId,
    eventName: 'Nairobi launch party',
    eventDate: new Date(Date.now() + 10 * 86400000).toISOString(),
    eventLocation: 'Nairobi',
    message: 'We would like to book you for our upcoming launch party.'
  });
  assert.equal(bookingResponse.status, 201);
  const bookingId = bookingResponse.body.booking.id;
  assert.equal(bookingResponse.body.booking.depositAmountKes, 400);
  await new Promise((resolve) => setImmediate(resolve));
  const requestEmail = db.prepare(`
    SELECT n.status,a.email FROM artist_booking_email_notifications n
    JOIN accounts a ON a.id=n.recipient_account_id
    WHERE n.booking_id=? AND n.notification_type='request'
  `).get(bookingId);
  assert.equal(requestEmail.status, 'sent');
  assert.equal(requestEmail.email, db.prepare('SELECT email FROM accounts WHERE id=?')
    .get(db.prepare('SELECT account_id FROM artist_profiles WHERE id=?').get(profileResponse.body.profile.id).account_id).email);
  assert.ok(artistBookingEmailAttempts.some((email) =>
    email.subject === 'New booking request: Nairobi launch party' && email.html.includes('Festival DJ set')));
  assert.equal((await request(app).post('/api/artist-bookings').set(organizerAuth).send({
    serviceId,
    clientRequestId,
    eventName: 'Nairobi launch party',
    eventDate: new Date(Date.now() + 10 * 86400000).toISOString(),
    eventLocation: 'Nairobi',
    message: 'We would like to book you for our upcoming launch party.'
  })).body.duplicate, true);
  assert.equal((await request(app).post(`/api/artist-bookings/${bookingId}/respond`)
    .set(organizerAuth).send({ decision: 'accept' })).status, 404);
  artistBookingEmailGateway.failNext = true;
  assert.equal((await request(app).post(`/api/artist-bookings/${bookingId}/respond`)
    .set(artistAuth).send({ decision: 'accept' })).status, 200);
  await new Promise((resolve) => setImmediate(resolve));
  const failedAcceptanceEmail = db.prepare(`
    SELECT id,status FROM artist_booking_email_notifications
    WHERE booking_id=? AND notification_type='accepted'
  `).get(bookingId);
  assert.equal(failedAcceptanceEmail.status, 'failed');
  db.prepare("UPDATE artist_booking_email_notifications SET attempted_at=datetime('now','-2 hours') WHERE id=?")
    .run(failedAcceptanceEmail.id);
  assert.equal(await app.locals.retryPendingArtistBookingEmails(), 1);
  assert.equal(db.prepare('SELECT status FROM artist_booking_email_notifications WHERE id=?')
    .get(failedAcceptanceEmail.id).status, 'sent');

  const paymentDisabledApp = createApp({ artistBookingsPaymentsEnabled: false });
  assert.equal((await request(paymentDisabledApp).get('/api/artist-bookings/payment-status')).body.enabled, false);
  assert.equal((await request(paymentDisabledApp).post(`/api/artist-bookings/${bookingId}/deposit`)
    .set(organizerAuth).send({ phone: '0712345678', acceptedCancellationPolicy: true })).status, 503);
  const payheroUnavailableApp = createApp({ payhero: { isConfigured: () => false } });
  assert.equal((await request(payheroUnavailableApp).get('/api/artist-bookings/payment-status')).body.enabled, false);
  const previousPaymentsSetting = process.env.ARTIST_BOOKINGS_PAYMENTS_ENABLED;
  try {
    delete process.env.ARTIST_BOOKINGS_PAYMENTS_ENABLED;
    const defaultPaymentsApp = createApp({ payhero: paymentGateway });
    assert.equal((await request(defaultPaymentsApp).get('/api/artist-bookings/payment-status')).body.enabled, true);
    process.env.ARTIST_BOOKINGS_PAYMENTS_ENABLED = 'false';
    const pausedPaymentsApp = createApp({ payhero: paymentGateway });
    assert.equal((await request(pausedPaymentsApp).get('/api/artist-bookings/payment-status')).body.enabled, false);
  } finally {
    if (previousPaymentsSetting === undefined) delete process.env.ARTIST_BOOKINGS_PAYMENTS_ENABLED;
    else process.env.ARTIST_BOOKINGS_PAYMENTS_ENABLED = previousPaymentsSetting;
  }

  const missingPolicy = await request(app).post(`/api/artist-bookings/${bookingId}/deposit`)
    .set(organizerAuth).send({ phone: '0712345678' });
  assert.equal(missingPolicy.status, 400);
  const depositResponse = await request(app).post(`/api/artist-bookings/${bookingId}/deposit`)
    .set(organizerAuth).send({ phone: '0712345678', acceptedCancellationPolicy: true });
  assert.equal(depositResponse.status, 200);
  assert.equal(depositResponse.body.amountKes, 400);
  assert.equal(paymentGateway.lastOrder.amountKes, 400);
  const callback = await request(app).post('/api/payhero/callback').send({
    response: {
      CheckoutRequestID: db.prepare('SELECT checkout_request_id FROM artist_bookings WHERE id=?').get(bookingId).checkout_request_id,
      ResultCode: 0,
      Amount: 400,
      MpesaReceiptNumber: 'ARTISTBOOKINGTEST'
    }
  });
  assert.equal(callback.status, 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM artist_booking_email_notifications
    WHERE booking_id=? AND notification_type='deposit_paid' AND status='sent'
  `).get(bookingId).count, 2);
  const organizerBookings = await request(app).get('/api/artist-bookings/me').set(organizerAuth);
  assert.equal(organizerBookings.body.bookings[0].status, 'deposit_paid');
  assert.equal(organizerBookings.body.bookings[0].valorFeeKes, 32);
  assert.equal(organizerBookings.body.bookings[0].artistPayoutKes, 368);
  assert.match(organizerBookings.body.bookings[0].cancellationPolicy, /seven days/);

  assert.equal((await request(app).post(`/api/artist-bookings/${bookingId}/complete`)
    .set(artistAuth).send({})).status, 409);
  db.prepare('UPDATE artist_bookings SET event_date=? WHERE id=?')
    .run(new Date(Date.now() - 3 * 3600000).toISOString(), bookingId);
  assert.equal((await request(app).post(`/api/artist-bookings/${bookingId}/complete`)
    .set(artistAuth).send({})).body.status, 'service_completed');
  assert.equal((await request(app).post(`/api/artist-bookings/${bookingId}/complete`)
    .set(organizerAuth).send({})).body.status, 'completed');
  const payout = await request(app).post(`/api/artist-bookings/admin/${bookingId}/payout`)
    .set(admin).send({ reference: 'ARTIST-TRANSFER-1', note: 'Artist deposit paid after event completion.' });
  assert.equal(payout.status, 201);
  assert.equal(payout.body.amountKes, 368);
  assert.equal((await request(app).post(`/api/artist-bookings/admin/${bookingId}/payout`)
    .set(admin).send({ reference: 'ARTIST-TRANSFER-2', note: 'Duplicate payout check.' })).status, 409);

  const refundBookingResponse = await request(app).post('/api/artist-bookings').set(organizerAuth).send({
    serviceId,
    clientRequestId: crypto.randomUUID(),
    eventName: 'Nairobi community event',
    eventDate: new Date(Date.now() + 12 * 86400000).toISOString(),
    eventLocation: 'Nairobi',
    message: 'We would like to book you for a community event.'
  });
  const refundBookingId = refundBookingResponse.body.booking.id;
  assert.equal((await request(app).post(`/api/artist-bookings/${refundBookingId}/respond`)
    .set(artistAuth).send({ decision: 'accept' })).status, 200);
  await request(app).post(`/api/artist-bookings/${refundBookingId}/deposit`)
    .set(organizerAuth).send({ phone: '0712345678', acceptedCancellationPolicy: true });
  await request(app).post('/api/payhero/callback').send({
    response: {
      CheckoutRequestID: db.prepare('SELECT checkout_request_id FROM artist_bookings WHERE id=?').get(refundBookingId).checkout_request_id,
      ResultCode: 0,
      Amount: 400,
      MpesaReceiptNumber: 'ARTISTBOOKINGTEST2'
    }
  });
  assert.equal((await request(app).post(`/api/artist-bookings/${refundBookingId}/cancel`)
    .set(organizerAuth).send({})).body.status, 'cancellation_review');
  const refund = await request(app).post(`/api/artist-bookings/admin/${refundBookingId}/refund`)
    .set(admin).send({ amountKes: 400, reference: 'ARTIST-REFUND-1', note: 'Refund sent under the listing policy.' });
  assert.equal(refund.status, 201);
  assert.equal(db.prepare('SELECT status FROM artist_bookings WHERE id=?').get(refundBookingId).status, 'refunded');

  assert.equal((await request(app).get('/api/artists/admin')).status, 401);
  const adminArtists = await request(app).get('/api/artists/admin').set(admin);
  assert.equal(adminArtists.status, 200);
  assert.equal(adminArtists.body.profiles[0].id, profileResponse.body.profile.id);
  const unlist = await request(app).patch(`/api/artists/admin/${profileResponse.body.profile.id}`)
    .set(admin).send({ status: 'suspended' });
  assert.equal(unlist.status, 200);
  assert.equal((await request(app).get(`/api/artists/${profileResponse.body.profile.slug}`)).status, 404);
});

test('organizer and sponsor partnership applications support secure follow-up and resubmission', async () => {
  const applicantAuth = createTestAccountAuth('partnership-applicant@example.com');
  assert.equal((await request(app).get('/api/partnership-applications/me')).status, 401);
  const invalidWebsite = await request(app).post('/api/partnership-applications')
    .set(applicantAuth)
    .set('X-Forwarded-For', '198.51.100.50')
    .send({
      type: 'sponsor',
      organizationName: 'Sample Brand',
      websiteUrl: 'http://brand.example',
      sponsorshipTier: 'city',
      applicationDetails: 'We want to reach local event communities with a campaign.'
    });
  assert.equal(invalidWebsite.status, 400);

  const customProposal = await request(app).post('/api/partnership-applications')
    .set(createTestAccountAuth('custom-sponsor-proposal@example.com'))
    .set('X-Forwarded-For', '198.51.100.50')
    .send({
      type: 'sponsor',
      organizationName: 'Custom Proposal Brand',
      applicationDetails: 'We want to discuss a bespoke sponsorship outside the standard packages.'
    });
  assert.equal(customProposal.status, 201);
  assert.equal(customProposal.body.status, 'approved');

  const invalidTier = await request(app).post('/api/partnership-applications')
    .set(applicantAuth)
    .set('X-Forwarded-For', '198.51.100.50')
    .send({
      type: 'sponsor',
      organizationName: 'Sample Brand',
      sponsorshipTier: 'platinum',
      applicationDetails: 'We want to reach local event communities with a brand campaign and discuss possible activations.'
    });
  assert.equal(invalidTier.status, 400);

  const organizer = await request(app).post('/api/partnership-applications')
    .set(applicantAuth)
    .set('X-Forwarded-For', '198.51.100.50')
    .send({
      type: 'organizer',
      organizationName: 'Nairobi Events Collective',
      websiteUrl: 'https://events.example',
      applicationDetails: 'We organize regular community and music events in Nairobi and would like to discuss listing and promotion.',
      requestedSupport: 'Event discovery and launch promotion.'
    });
  assert.equal(organizer.status, 201);
  assert.equal(organizer.body.status, 'approved');
  assert.match(organizer.body.message, /active immediately.*no manual application review/i);
  const duplicate = await request(app).post('/api/partnership-applications')
    .set(applicantAuth)
    .set('X-Forwarded-For', '198.51.100.50')
    .send({
      type: 'organizer',
      organizationName: 'Nairobi Events Collective',
      applicationDetails: 'We organize regular community and music events in Nairobi and would like to discuss listing and promotion.'
    });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.status, 'approved');

  const sponsor = await request(app).post('/api/partnership-applications')
    .set(applicantAuth)
    .set('X-Forwarded-For', '198.51.100.50')
    .send({
      type: 'sponsor',
      organizationName: 'Sample Brand',
      sponsorshipTier: 'premium',
      applicationDetails: 'We want to reach local event communities with a brand campaign and discuss possible activations.',
      requestedSupport: 'Nairobi event sponsorship and brand activations.'
    });
  assert.equal(sponsor.status, 201);
  assert.equal(sponsor.body.status, 'approved');
    const artist = await request(app).post('/api/partnership-applications')
      .set(applicantAuth)
      .send({
        type: 'artist',
        organizationName: 'DJ Example',
        applicationDetails: 'I would like a profile to showcase my DJ work and event performance history.'
      });
    assert.equal(artist.status, 201);
      assert.equal(artist.body.status, 'approved');
    const branding = await request(app).post('/api/partnership-applications')
      .set(applicantAuth)
      .send({
        type: 'branding',
        organizationName: 'Nairobi Summer Fest',
        applicationDetails: 'We need event branding materials and a quote for a December event in Nairobi.'
      });
    assert.equal(branding.status, 201);
      assert.equal(branding.body.status, 'approved');
    const investment = await request(app).post('/api/partnership-applications')
      .set(applicantAuth)
      .send({
        type: 'investment',
        organizationName: 'Interested Investor',
        applicationDetails: 'I would like to explore a non-binding investment discussion with the company.'
      });
    assert.equal(investment.status, 201);
      assert.equal(investment.body.status, 'received');
    assert.match(investment.body.message, /not an investment offer or commitment/);
      assert.match(investment.body.message, /without an application review/);
  db.prepare("UPDATE partnership_applications SET status='pending' WHERE id=?").run(organizer.body.id);
  const mine = await request(app).get('/api/partnership-applications/me').set(applicantAuth);
  assert.equal(mine.status, 200);
    assert.deepEqual(mine.body.applications.map((application) => application.type), ['artist','branding','investment','organizer','sponsor']);
  const mineSponsor = mine.body.applications.find((application) => application.type === 'sponsor');
  assert.equal(mineSponsor.sponsorshipTier, 'premium');
  const mineOrganizer = mine.body.applications.find((application) => application.type === 'organizer');
  assert.equal(mineOrganizer.sponsorshipTier, '');
  assert.equal(mineOrganizer.status, 'approved');
  assert.equal(mine.body.applications.find((application) => application.type === 'investment').status, 'received');

  assert.equal((await request(app).get('/api/partnership-applications/admin')).status, 401);
  const adminList = await request(app).get('/api/partnership-applications/admin').set(admin);
  assert.equal(adminList.status, 200);
  assert.equal(adminList.body.applications.length, 6);
  assert.equal(adminList.body.applications.find((application) => application.organizationName === 'Sample Brand').sponsorshipTier, 'premium');
  assert.equal((await request(app).get('/api/partnership-applications/admin?type=sponsor').set(admin)).body.applications.length, 2);

  const tiers = await request(app).get('/api/partnership-applications/sponsorship-tiers');
  assert.equal(tiers.status, 200);
  assert.deepEqual(tiers.body.tiers.map((tier) => tier.priceKes), [25000, 75000, 200000]);
  const invalidStatus = await request(app)
    .patch(`/api/partnership-applications/admin/${organizer.body.id}`)
    .set(admin).send({ status: 'paid' });
  assert.equal(invalidStatus.status, 400);
  const contacted = await request(app)
    .patch(`/api/partnership-applications/admin/${organizer.body.id}`)
    .set(admin).send({ status: 'contacted', adminNote: 'We will email to arrange a call.' });
  assert.equal(contacted.status, 200);
  const visibleToApplicant = await request(app).get('/api/partnership-applications/me').set(applicantAuth);
  const organizerStatus = visibleToApplicant.body.applications.find((application) => application.type === 'organizer');
  assert.equal(organizerStatus.status, 'contacted');
  assert.equal(organizerStatus.adminNote, 'We will email to arrange a call.');

  const rejected = await request(app)
    .patch(`/api/partnership-applications/admin/${sponsor.body.id}`)
    .set(admin).send({ status: 'rejected', adminNote: 'Please provide a campaign date range.' });
  assert.equal(rejected.status, 200);
  const resubmittedSponsor = await request(app).post('/api/partnership-applications')
    .set(applicantAuth)
    .set('X-Forwarded-For', '198.51.100.50')
    .send({
      type: 'sponsor',
      organizationName: 'Sample Brand',
      sponsorshipTier: 'community',
      applicationDetails: 'We want to reach local event communities with a brand campaign and discuss possible activations.',
      requestedSupport: 'Nairobi event sponsorship and brand activations.'
    });
  assert.equal(resubmittedSponsor.status, 200);
  const updatedSponsor = (await request(app).get('/api/partnership-applications/me')
    .set(applicantAuth)).body.applications.find((application) => application.type === 'sponsor');
  assert.equal(updatedSponsor.status, 'approved');
  assert.equal(updatedSponsor.adminNote, '');
  assert.equal(updatedSponsor.sponsorshipTier, 'community');
});

test('Valor gift cards charge, retry, redeem once, and support reviewed wallet refunds', async () => {
  const purchaserAuth = createTestAccountAuth(`gift-purchaser-${crypto.randomUUID()}@example.com`);
  const purchaser = createTestWallet(purchaserAuth, 1500);
  const purchasePayload = {
    amountKes: 1000,
    recipientName: 'Gift Recipient',
    recipientContact: 'recipient@example.com',
    message: 'Enjoy this!',
    paymentMethod: 'wallet',
    clientRequestId: crypto.randomUUID()
  };
  const purchase = await request(app).post('/api/gift-cards/purchase').set(purchaserAuth).send(purchasePayload);
  assert.equal(purchase.status, 201);
  assert.equal(purchase.body.status, 'paid');
  assert.equal((await request(app).get('/api/wallet').set(purchaserAuth)).body.balanceKes, 500);
  const repeat = await request(app).post('/api/gift-cards/purchase').set(purchaserAuth).send(purchasePayload);
  assert.equal(repeat.status, 200);
  assert.equal(repeat.body.purchaseId, purchase.body.purchaseId);
  assert.equal((await request(app).get('/api/wallet').set(purchaserAuth)).body.balanceKes, 500);

  const card = (await request(app).get('/api/gift-cards/mine').set(purchaserAuth)).body.purchases[0];
  assert.equal(card.status, 'paid');
  assert.equal(card.cardStatus, 'issued');
  assert.match(card.code, /^VA(?:-[0-9A-F]{6}){6}$/);
  assert.equal(db.prepare('SELECT code_ciphertext FROM gift_cards WHERE id=?').get(card.giftCardId).code_ciphertext.includes(card.code), false);

  const recipientAuth = createTestAccountAuth(`gift-recipient-${crypto.randomUUID()}@example.com`);
  createTestWallet(recipientAuth);
  const redeemed = await request(app).post('/api/gift-cards/redeem').set(recipientAuth).send({ code: card.code });
  assert.equal(redeemed.status, 200);
  assert.equal(redeemed.body.amountKes, 1000);
  assert.equal(redeemed.body.balanceKes, 1000);
  assert.equal((await request(app).post('/api/gift-cards/redeem').set(recipientAuth).send({ code: card.code })).status, 404);
  assert.equal((await request(app).get('/api/wallet').set(recipientAuth)).body.balanceKes, 1000);

  const refundablePayload = { ...purchasePayload, amountKes: 500, clientRequestId: crypto.randomUUID() };
  const refundablePurchase = await request(app).post('/api/gift-cards/purchase').set(purchaserAuth).send(refundablePayload);
  assert.equal(refundablePurchase.status, 201);
  const refund = await request(app).post('/api/gift-refunds').set(purchaserAuth).send({
    instrumentType: 'gift_card',
    instrumentId: refundablePurchase.body.purchaseId,
    reason: 'Bought this in error before sharing the code.'
  });
  assert.equal(refund.status, 201);
  const approved = await request(app).patch(`/api/gift-refunds/admin/${refund.body.requestId}`)
    .set(admin).send({ status: 'approved', adminNote: 'Unused credit returned to wallet.' });
  assert.equal(approved.status, 200);
  assert.equal((await request(app).get('/api/wallet').set(purchaserAuth)).body.balanceKes, 500);
  const refunded = (await request(app).get('/api/gift-cards/mine').set(purchaserAuth)).body.purchases
    .find((item) => item.purchaseId === refundablePurchase.body.purchaseId);
  assert.equal(refunded.status, 'refunded');
  assert.equal(refunded.code, '');
  assert.equal(db.prepare('SELECT status FROM gift_cards WHERE purchase_id=?').get(refundablePurchase.body.purchaseId).status, 'refunded');
  assert.ok(purchaser.walletId);
});

test('M-Pesa gift card remains unavailable until its matching payment callback is confirmed', async () => {
  const buyerAuth = createTestAccountAuth(`mpesa-gift-buyer-${crypto.randomUUID()}@example.com`);
  const purchase = await request(app).post('/api/gift-cards/purchase').set(buyerAuth).send({
    amountKes: 1500,
    recipientName: 'M-Pesa Recipient',
    paymentMethod: 'mpesa',
    phone: '0712345678',
    clientRequestId: crypto.randomUUID()
  });
  assert.equal(purchase.status, 201);
  assert.equal(purchase.body.status, 'pending');
  const pending = db.prepare(`
    SELECT checkout_request_id AS checkoutRequestId,merchant_request_id AS merchantRequestId
    FROM gift_card_purchases WHERE id=?
  `).get(purchase.body.purchaseId);
  assert.equal(db.prepare('SELECT status FROM gift_cards WHERE purchase_id=?').get(purchase.body.purchaseId).status, 'pending');
  const confirmed = await completePayment(pending.checkoutRequestId, pending.merchantRequestId, 1500, 'GIFTCARD123');
  assert.equal(confirmed.status, 200);
  const paidCard = (await request(app).get('/api/gift-cards/mine').set(buyerAuth)).body.purchases[0];
  assert.equal(paidCard.status, 'paid');
  assert.equal(paidCard.cardStatus, 'issued');
  assert.ok(paidCard.code);
});

test('verified merchants can load one-time vouchers, fulfill wallet orders, confirm refunds, and record payouts', async () => {
  const merchantAuth = createTestAccountAuth(`gift-merchant-${crypto.randomUUID()}@example.com`);
  const merchantWallet = createTestWallet(merchantAuth);
  const application = await request(app).post('/api/gift-merchants/applications').set(merchantAuth).send({
    businessName: 'Nairobi Coffee House',
    websiteUrl: 'https://coffee.example',
    contactName: 'Amina Merchant',
    contactPhone: `07${String(crypto.randomInt(10000000, 99999999))}`,
    details: 'Independent coffee shop offering prepaid drinks and cafe experiences.'
  });
  assert.equal(application.status, 201);
  assert.equal((await request(app).get('/api/gift-merchants/admin').set(admin)).body.merchants
    .some((item) => item.id === application.body.merchantId && item.status === 'pending'), true);
  const approvedMerchant = await request(app).patch(`/api/gift-merchants/admin/${application.body.merchantId}`)
    .set(admin).send({ status: 'approved', adminNote: 'Business contact verified.' });
  assert.equal(approvedMerchant.status, 200);

  const listing = await request(app).post('/api/gift-merchants/vouchers').set(merchantAuth).send({
    title: 'Coffee & pastry',
    description: 'One coffee and pastry of your choice.',
    faceValueKes: 1000,
    salePriceKes: 750,
    redemptionInstructions: 'Present this code at the counter.',
    terms: 'One redemption per code.'
  });
  assert.equal(listing.status, 201);
  const codes = ['CAFE-ONE-TIME-001', 'CAFE-ONE-TIME-002'].join('\n');
  const inventory = await request(app).post(`/api/gift-merchants/vouchers/${listing.body.voucherId}/inventory`)
    .set(merchantAuth).send({ codes });
  assert.equal(inventory.status, 201);
  assert.equal(inventory.body.added, 2);
  assert.equal((await request(app).get('/api/gift-vouchers')).body.vouchers[0].stock, 2);
  assert.equal(db.prepare('SELECT code_ciphertext FROM merchant_voucher_codes WHERE voucher_id=?').get(listing.body.voucherId).code_ciphertext.includes('CAFE-ONE-TIME'), false);
  const secondListing = await request(app).post('/api/gift-merchants/vouchers').set(merchantAuth).send({
    title: 'Coffee tasting',
    description: 'A second offer from the same cafe.',
    faceValueKes: 1500,
    salePriceKes: 1000,
    redemptionInstructions: 'Present this code at the counter.'
  });
  assert.equal(secondListing.status, 201);
  const reusedCode = await request(app).post(`/api/gift-merchants/vouchers/${secondListing.body.voucherId}/inventory`)
    .set(merchantAuth).send({ codes: 'CAFE-ONE-TIME-001' });
  assert.equal(reusedCode.status, 409);

  const buyerAuth = createTestAccountAuth(`voucher-buyer-${crypto.randomUUID()}@example.com`);
  const buyerWallet = createTestWallet(buyerAuth, 5000);
  const orderPayload = {
    voucherId: listing.body.voucherId,
    buyerName: 'Voucher Buyer',
    paymentMethod: 'wallet',
    clientRequestId: crypto.randomUUID()
  };
  const order = await request(app).post('/api/merchant-voucher-orders').set(buyerAuth).send(orderPayload);
  assert.equal(order.status, 201);
  assert.equal(order.body.status, 'paid');
  assert.equal(order.body.amountKes, 750);
  assert.equal((await request(app).get('/api/wallet').set(buyerAuth)).body.balanceKes, 4250);
  const duplicate = await request(app).post('/api/merchant-voucher-orders').set(buyerAuth).send(orderPayload);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.orderId, order.body.orderId);
  assert.equal((await request(app).get('/api/wallet').set(buyerAuth)).body.balanceKes, 4250);
  const buyerOrder = (await request(app).get('/api/merchant-voucher-orders/mine').set(buyerAuth)).body.orders[0];
  assert.ok(codes.split('\n').includes(buyerOrder.code));

  const refund = await request(app).post('/api/gift-refunds').set(buyerAuth).send({
    instrumentType: 'merchant_voucher',
    instrumentId: order.body.orderId,
    reason: 'The voucher has not been used.'
  });
  assert.equal(refund.status, 201);
  assert.equal((await request(app).get('/api/merchant-voucher-orders/mine').set(buyerAuth))
    .body.orders.find((item) => item.orderId === order.body.orderId).refundStatus, 'pending');
  const merchantRefunds = await request(app).get('/api/gift-merchants/mine').set(merchantAuth);
  assert.equal(merchantRefunds.body.refundRequests.length, 1);
  assert.equal(merchantRefunds.body.refundRequests[0].requestId, refund.body.requestId);
  const prematureApproval = await request(app).patch(`/api/gift-refunds/admin/${refund.body.requestId}`)
    .set(admin).send({ status: 'approved' });
  assert.equal(prematureApproval.status, 409);
  const confirmedUnused = await request(app).post(`/api/gift-merchants/refunds/${refund.body.requestId}/confirm-unused`)
    .set(merchantAuth);
  assert.equal(confirmedUnused.status, 200);
  const approvedRefund = await request(app).patch(`/api/gift-refunds/admin/${refund.body.requestId}`)
    .set(admin).send({ status: 'approved', adminNote: 'Merchant confirmed the code is unused.' });
  assert.equal(approvedRefund.status, 200);
  assert.equal((await request(app).get('/api/merchant-voucher-orders/mine').set(buyerAuth))
    .body.orders.find((item) => item.orderId === order.body.orderId).refundStatus, 'approved');
  assert.equal((await request(app).get('/api/wallet').set(buyerAuth)).body.balanceKes, 5000);
  assert.equal(db.prepare('SELECT status FROM merchant_voucher_codes WHERE order_id=?').get(order.body.orderId).status, 'retired');

  const secondOrder = await request(app).post('/api/merchant-voucher-orders').set(buyerAuth).send({
    ...orderPayload,
    clientRequestId: crypto.randomUUID()
  });
  assert.equal(secondOrder.status, 201);
  const secondBuyerOrder = (await request(app).get('/api/merchant-voucher-orders/mine').set(buyerAuth)).body.orders
    .find((item) => item.orderId === secondOrder.body.orderId);
  assert.ok(secondBuyerOrder.code);
  assert.notEqual(secondBuyerOrder.code, buyerOrder.code);
  const payout = await request(app).post(`/api/gift-payouts/admin/${application.body.merchantId}`)
    .set(admin).send({ amountKes: 500, reference: `GIFT-PAYOUT-${crypto.randomUUID()}`, note: 'Verified manual settlement.' });
  assert.equal(payout.status, 201);
  const payoutTotals = (await request(app).get('/api/gift-payouts/admin').set(admin)).body.merchants
    .find((item) => item.merchantId === application.body.merchantId);
  assert.equal(payoutTotals.paidOutKes, 500);
  assert.equal(payoutTotals.dueKes, 250);
  assert.equal((await request(app).get('/api/gift-merchants/mine').set(merchantAuth)).body.dueKes, 250);
  assert.equal(db.prepare(`
    SELECT COALESCE(SUM(amount_kes),0) AS balanceKes
    FROM merchant_voucher_ledger WHERE merchant_id=?
  `).get(application.body.merchantId).balanceKes, 250);
  assert.ok(merchantWallet.walletId);
  assert.ok(buyerWallet.walletId);
});

test('ticket countdown reminders send once per threshold and the admin trigger reports a summary', async () => {
  const buyerAuth = createTestAccountAuth('reminder-buyer@example.com');
  const buyerTokenHash = crypto.createHash('sha256').update(buyerAuth.Authorization.slice('Bearer '.length)).digest('hex');
  const buyerAccountId = db.prepare('SELECT account_id FROM account_sessions WHERE token_hash=?').get(buyerTokenHash).account_id;
  const organizerAuth = createTestAccountAuth(`reminder-organizer-${crypto.randomUUID()}@example.com`);
  const soonEvent = createStoredTestEvent('Reminder Countdown Festival', organizerAuth);
  db.prepare('UPDATE events SET starts_at=? WHERE id=?')
    .run(new Date(Date.now() + 6 * 86400000).toISOString(), soonEvent.id);

  const checkout = await request(app).post('/api/orders/tickets').set(buyerAuth).send({
    eventId: soonEvent.id, ticketType: 'Regular', buyerName: 'Reminder Buyer', phone: '0712345678',
    quantity: 2, paymentMethod: 'stripe'
  });
  assert.equal(checkout.status, 201);
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(checkout.body.orderId);
  await stripeWebhook({
    id: order.stripe_session_id, payment_status: 'paid', amount_total: order.amount_kes * 100,
    currency: 'kes', metadata: { orderId: order.id }
  });
  assert.match(db.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status, /paid|confirmed/);

  const unauthorizedTrigger = await request(app).post('/api/reminders/admin/send');
  assert.equal(unauthorizedTrigger.status, 401);

  const firstRun = await request(app).post('/api/reminders/admin/send').set(admin);
  assert.equal(firstRun.status, 200);
  assert.equal(firstRun.body.configured, true);
  assert.equal(firstRun.body.ticketRemindersSent >= 1, true);
  const log = db.prepare('SELECT * FROM ticket_reminder_log WHERE account_id=? AND event_id=? AND days_before=7')
    .get(buyerAccountId, soonEvent.id);
  assert.equal(log.status, 'sent');
  const sentAttempt = reminderEmailAttempts.find((attempt) =>
    attempt.type === 'ticket' && attempt.email === 'reminder-buyer@example.com');
  assert.ok(sentAttempt);
  assert.equal(sentAttempt.ticketCount, 2);
  assert.equal(sentAttempt.daysRemaining, 6);

  const attemptsBeforeRetry = reminderEmailAttempts.length;
  const secondRun = await request(app).post('/api/reminders/admin/send').set(admin);
  assert.equal(secondRun.status, 200);
  assert.equal(reminderEmailAttempts.length, attemptsBeforeRetry);

  reminderEmailGateway.enabled = false;
  const unconfiguredRun = await request(app).post('/api/reminders/admin/send').set(admin);
  assert.equal(unconfiguredRun.body.configured, false);
  assert.equal(unconfiguredRun.body.ticketRemindersSent, 0);
  reminderEmailGateway.enabled = true;
});

test('event view reminders respect opt-out, exclude ticket holders, and support one-click unsubscribe', async () => {
  const viewerAuth = createTestAccountAuth('reminder-viewer@example.com');
  const viewerTokenHash = crypto.createHash('sha256').update(viewerAuth.Authorization.slice('Bearer '.length)).digest('hex');
  const viewerAccountId = db.prepare('SELECT account_id FROM account_sessions WHERE token_hash=?').get(viewerTokenHash).account_id;
  const organizerAuth = createTestAccountAuth(`reminder-organizer-${crypto.randomUUID()}@example.com`);
  const browsedEvent = createStoredTestEvent('Reminder Browse Event', organizerAuth);

  const anonymousView = await request(app).post(`/api/account/events/${browsedEvent.id}/view`);
  assert.equal(anonymousView.status, 401);
  const viewResponse = await request(app).post(`/api/account/events/${browsedEvent.id}/view`).set(viewerAuth);
  assert.equal(viewResponse.status, 204);

  const tooSoonRun = await request(app).post('/api/reminders/admin/send').set(admin);
  assert.equal(tooSoonRun.body.viewRemindersSent, 0);
  assert.equal(db.prepare('SELECT view_reminder_status FROM event_views WHERE account_id=? AND event_id=?')
    .get(viewerAccountId, browsedEvent.id).view_reminder_status, 'not_sent');

  db.prepare("UPDATE event_views SET last_viewed_at=datetime('now','-2 days') WHERE account_id=? AND event_id=?")
    .run(viewerAccountId, browsedEvent.id);
  const secondRun = await request(app).post('/api/reminders/admin/send').set(admin);
  assert.equal(secondRun.body.viewRemindersSent >= 1, true);
  assert.equal(db.prepare('SELECT view_reminder_status FROM event_views WHERE account_id=? AND event_id=?')
    .get(viewerAccountId, browsedEvent.id).view_reminder_status, 'sent');
  const viewAttempt = reminderEmailAttempts.find((attempt) =>
    attempt.type === 'view' && attempt.email === 'reminder-viewer@example.com');
  assert.ok(viewAttempt);
  assert.match(viewAttempt.unsubscribeUrl, /\/unsubscribe\.html\?token=/);

  const attemptsBeforeRerun = reminderEmailAttempts.length;
  await request(app).post('/api/reminders/admin/send').set(admin);
  assert.equal(reminderEmailAttempts.length, attemptsBeforeRerun);

  const optOutAuth = createTestAccountAuth('reminder-optout@example.com');
  const optOutTokenHash = crypto.createHash('sha256').update(optOutAuth.Authorization.slice('Bearer '.length)).digest('hex');
  const optOutAccountId = db.prepare('SELECT account_id FROM account_sessions WHERE token_hash=?').get(optOutTokenHash).account_id;
  const prefsResponse = await request(app).post('/api/account/preferences').set(optOutAuth)
    .send({ marketingEmailsOptOut: true });
  assert.equal(prefsResponse.status, 200);
  assert.equal(prefsResponse.body.marketingEmailsOptOut, true);
  await request(app).post(`/api/account/events/${browsedEvent.id}/view`).set(optOutAuth);
  db.prepare("UPDATE event_views SET last_viewed_at=datetime('now','-2 days') WHERE account_id=? AND event_id=?")
    .run(optOutAccountId, browsedEvent.id);
  await request(app).post('/api/reminders/admin/send').set(admin);
  assert.equal(reminderEmailAttempts.some((attempt) =>
    attempt.type === 'view' && attempt.email === 'reminder-optout@example.com'), false);

  const ticketedEvent = createStoredTestEvent('Reminder Browse Ticketed Event', organizerAuth);
  const checkout = await request(app).post('/api/orders/tickets').set(viewerAuth).send({
    eventId: ticketedEvent.id, ticketType: 'Regular', buyerName: 'Viewer Buyer', phone: '0712345678',
    quantity: 1, paymentMethod: 'stripe'
  });
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(checkout.body.orderId);
  await stripeWebhook({
    id: order.stripe_session_id, payment_status: 'paid', amount_total: order.amount_kes * 100,
    currency: 'kes', metadata: { orderId: order.id }
  });
  await request(app).post(`/api/account/events/${ticketedEvent.id}/view`).set(viewerAuth);
  db.prepare("UPDATE event_views SET last_viewed_at=datetime('now','-2 days') WHERE account_id=? AND event_id=?")
    .run(viewerAccountId, ticketedEvent.id);
  await request(app).post('/api/reminders/admin/send').set(admin);
  assert.equal(db.prepare('SELECT view_reminder_status FROM event_views WHERE account_id=? AND event_id=?')
    .get(viewerAccountId, ticketedEvent.id).view_reminder_status, 'not_sent');

  const invalidUnsubscribe = await request(app).post('/api/account/unsubscribe').send({ token: 'not-a-real-token' });
  assert.equal(invalidUnsubscribe.status, 401);
  const wrongPurposeToken = jwt.sign({ sub: viewerAccountId, purpose: 'something-else' }, process.env.JWT_SECRET);
  const wrongPurpose = await request(app).post('/api/account/unsubscribe').send({ token: wrongPurposeToken });
  assert.equal(wrongPurpose.status, 401);
  assert.equal(db.prepare('SELECT marketing_emails_opt_out FROM accounts WHERE id=?').get(viewerAccountId).marketing_emails_opt_out, 0);
  const validToken = jwt.sign({ sub: viewerAccountId, purpose: 'unsubscribe-marketing' }, process.env.JWT_SECRET);
  const validUnsubscribe = await request(app).post('/api/account/unsubscribe').send({ token: validToken });
  assert.equal(validUnsubscribe.status, 200);
  assert.equal(validUnsubscribe.body.unsubscribed, true);
  assert.equal(db.prepare('SELECT marketing_emails_opt_out FROM accounts WHERE id=?').get(viewerAccountId).marketing_emails_opt_out, 1);
});

test('wallet transaction history supports filtering, pagination, and CSV export', async () => {
  const auth = createTestAccountAuth('wallet-history@example.com');
  const { walletId } = createTestWallet(auth, 5000);

  const insert = db.prepare(`
    INSERT INTO wallet_transactions (id,wallet_id,transaction_type,amount_kes,status,receipt,description,created_at,completed_at)
    VALUES (?,?,?,?,?,?,?,?,?)
  `);
  insert.run(crypto.randomUUID(), walletId, 'deposit', 2000, 'completed', 'DEP0001', 'M-Pesa deposit', '2026-01-05 10:00:00', '2026-01-05 10:00:00');
  insert.run(crypto.randomUUID(), walletId, 'ticket_purchase', -1500, 'completed', null, 'Ticket purchase', '2026-02-10 10:00:00', '2026-02-10 10:00:00');
  insert.run(crypto.randomUUID(), walletId, 'deposit', 1000, 'failed', null, 'Failed M-Pesa deposit', '2026-02-15 10:00:00', null);

  const unauthenticated = await request(app).get('/api/wallet/transactions');
  assert.equal(unauthenticated.status, 401);

  const all = await request(app).get('/api/wallet/transactions').set(auth);
  assert.equal(all.status, 200);
  assert.equal(all.body.total, 4);
  assert.equal(all.body.transactions.length, 4);
  assert.equal(all.body.hasMore, false);

  const paged = await request(app).get('/api/wallet/transactions?limit=2&offset=0').set(auth);
  assert.equal(paged.body.transactions.length, 2);
  assert.equal(paged.body.total, 4);
  assert.equal(paged.body.hasMore, true);

  const byType = await request(app).get('/api/wallet/transactions?type=deposit').set(auth);
  assert.equal(byType.body.total, 3);
  assert.ok(byType.body.transactions.every((transaction) => transaction.type === 'deposit'));

  const byStatus = await request(app).get('/api/wallet/transactions?status=failed').set(auth);
  assert.equal(byStatus.body.total, 1);
  assert.equal(byStatus.body.transactions[0].description, 'Failed M-Pesa deposit');

  const byDateRange = await request(app).get('/api/wallet/transactions?from=2026-02-01&to=2026-02-28').set(auth);
  assert.equal(byDateRange.body.total, 2);

  const badType = await request(app).get('/api/wallet/transactions?type=not-a-real-type').set(auth);
  assert.equal(badType.status, 400);
  const badDate = await request(app).get('/api/wallet/transactions?from=not-a-date').set(auth);
  assert.equal(badDate.status, 400);

  const exportResponse = await request(app).get('/api/wallet/transactions/export?type=deposit').set(auth);
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers['content-type'], /text\/csv/);
  assert.match(exportResponse.headers['content-disposition'], /attachment; filename="valor-wallet-transactions-/);
  const csvLines = exportResponse.text.trim().split('\r\n');
  assert.equal(csvLines[0], 'Date,Type,Description,Amount (KES),Status,M-Pesa receipt');
  assert.equal(csvLines.length, 4);
  assert.ok(csvLines.slice(1).every((line) => line.split(',')[1] === 'deposit'));
  assert.ok(csvLines.slice(1).some((line) => line.includes('Failed M-Pesa deposit')));

  const noWalletAuth = createTestAccountAuth('wallet-history-nowallet@example.com');
  const noWalletList = await request(app).get('/api/wallet/transactions').set(noWalletAuth);
  assert.equal(noWalletList.status, 200);
  assert.deepEqual(noWalletList.body, { transactions: [], total: 0, hasMore: false });
  const noWalletExport = await request(app).get('/api/wallet/transactions/export').set(noWalletAuth);
  assert.equal(noWalletExport.status, 409);
});

test('email verification links a new wallet and can also claim an existing wallet balance', async () => {
  const newWalletAuth = createTestAccountAuth('wallet-email-new@example.com');
  const newPhone = `2547${String(crypto.randomInt(0, 100000000)).padStart(8, '0')}`;

  const badPhone = await request(app).post('/api/account/wallet/email-code').set(newWalletAuth).send({ phone: '123' });
  assert.equal(badPhone.status, 400);

  const codeRequest = await request(app).post('/api/account/wallet/email-code').set(newWalletAuth).send({ phone: newPhone });
  assert.equal(codeRequest.status, 202);
  assert.match(codeRequest.body.message, /wallet-email-new@example\.com/);
  const sentCode = emailCodes.get('wallet-email-new@example.com:wallet_link');
  assert.match(sentCode, /^\d{6}$/);

  const wrongCode = await request(app).post('/api/account/wallet/email-verify').set(newWalletAuth)
    .send({ phone: newPhone, code: '000000', accountType: 'buyer' });
  assert.equal(wrongCode.status, 401);

  const verified = await request(app).post('/api/account/wallet/email-verify').set(newWalletAuth)
    .send({ phone: newPhone, code: sentCode, accountType: 'buyer' });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.linked, true);
  assert.equal(verified.body.wallet.phone, newPhone);
  assert.equal(verified.body.balanceKes, 0);

  const alreadyLinked = await request(app).post('/api/account/wallet/email-code').set(newWalletAuth).send({ phone: newPhone });
  assert.equal(alreadyLinked.status, 409);

  const existingPhone = `2547${String(crypto.randomInt(0, 100000000)).padStart(8, '0')}`;
  const legacyWalletId = crypto.randomUUID();
  db.prepare("INSERT INTO wallets (id,phone,account_type) VALUES (?,?,'buyer')").run(legacyWalletId, existingPhone);
  db.prepare(`
    INSERT INTO wallet_transactions (id,wallet_id,transaction_type,amount_kes,status,receipt,description,completed_at)
    VALUES (?,?,'deposit',9000,'completed','LEGACY999','Pre-existing phone-wallet balance',datetime('now'))
  `).run(crypto.randomUUID(), legacyWalletId);

  const claimantAuth = createTestAccountAuth('wallet-email-claim@example.com');
  await request(app).post('/api/account/wallet/email-code').set(claimantAuth).send({ phone: existingPhone });
  const claimCode = emailCodes.get('wallet-email-claim@example.com:wallet_link');
  const claimed = await request(app).post('/api/account/wallet/email-verify').set(claimantAuth)
    .send({ phone: existingPhone, code: claimCode, accountType: 'buyer' });
  assert.equal(claimed.status, 200);
  assert.equal(claimed.body.balanceKes, 9000);
  assert.equal(db.prepare('SELECT account_id FROM wallets WHERE id=?').get(legacyWalletId).account_id,
    db.prepare('SELECT account_id FROM account_sessions WHERE token_hash=?')
      .get(crypto.createHash('sha256').update(claimantAuth.Authorization.slice('Bearer '.length)).digest('hex')).account_id);
});

test('wallet deposits accept NOWPayments and credit the balance only after a signed, matching finished notification', async () => {
  const auth = createTestAccountAuth('wallet-crypto@example.com');
  createTestWallet(auth, 0);

  const noWalletAuth = createTestAccountAuth('wallet-crypto-nowallet@example.com');
  const noWallet = await request(app).post('/api/wallet/deposits').set(noWalletAuth)
    .send({ amountKes: 500, paymentMethod: 'nowpayments' });
  assert.equal(noWallet.status, 409);

  const badMethod = await request(app).post('/api/wallet/deposits').set(auth)
    .send({ amountKes: 500, paymentMethod: 'applepay' });
  assert.equal(badMethod.status, 400);

  const deposit = await request(app).post('/api/wallet/deposits').set(auth)
    .send({ amountKes: 800, paymentMethod: 'nowpayments' });
  assert.equal(deposit.status, 201);
  assert.equal(deposit.body.paymentMethod, 'nowpayments');
  assert.match(deposit.body.checkoutUrl, /^https:\/\/nowpayments\.test\//);
  assert.equal(deposit.body.cryptoPriceAmountUsd, 6.15);
  const pending = db.prepare('SELECT * FROM wallet_transactions WHERE id=?').get(deposit.body.transactionId);
  assert.equal(pending.status, 'pending');
  assert.ok(pending.nowpayments_invoice_id);
  assert.equal(pending.nowpayments_price_amount_usd, 6.15);

  const mismatchedPayload = {
    payment_id: 'payment-wallet-1',
    invoice_id: pending.nowpayments_invoice_id,
    order_id: pending.id,
    payment_status: 'finished',
    price_amount: '1.00',
    price_currency: 'usd'
  };
  await request(app).post('/api/nowpayments/ipn')
    .set('x-nowpayments-sig', 'test-nowpayments-signature')
    .send(mismatchedPayload);
  assert.equal(db.prepare('SELECT status FROM wallet_transactions WHERE id=?').get(pending.id).status, 'review');

  db.prepare("UPDATE wallet_transactions SET status='pending' WHERE id=?").run(pending.id);
  const payload = { ...mismatchedPayload, price_amount: '6.15' };
  const confirming = await request(app).post('/api/nowpayments/ipn')
    .set('x-nowpayments-sig', 'test-nowpayments-signature')
    .send({ ...payload, payment_status: 'confirming' });
  assert.equal(confirming.status, 200);
  assert.equal(db.prepare('SELECT status FROM wallet_transactions WHERE id=?').get(pending.id).status, 'pending');

  const finished = await request(app).post('/api/nowpayments/ipn')
    .set('x-nowpayments-sig', 'test-nowpayments-signature')
    .send(payload);
  assert.equal(finished.status, 200);
  assert.equal(db.prepare('SELECT status FROM wallet_transactions WHERE id=?').get(pending.id).status, 'completed');
  const balance = await request(app).get('/api/wallet').set(auth);
  assert.equal(balance.body.balanceKes, 800);

  await request(app).post('/api/nowpayments/ipn')
    .set('x-nowpayments-sig', 'test-nowpayments-signature')
    .send(payload);
  const balanceAfterReplay = await request(app).get('/api/wallet').set(auth);
  assert.equal(balanceAfterReplay.body.balanceKes, 800);
});

test('wallet deposits accept PayPal, crediting only on a matched capture or a verified webhook', async () => {
  const auth = createTestAccountAuth('wallet-paypal@example.com');
  createTestWallet(auth, 0);

  const deposit = await request(app).post('/api/wallet/deposits').set(auth)
    .send({ amountKes: 650, paymentMethod: 'paypal' });
  assert.equal(deposit.status, 201);
  assert.equal(deposit.body.paymentMethod, 'paypal');
  assert.match(deposit.body.checkoutUrl, /^https:\/\/paypal\.test\/approve\//);
  assert.equal(deposit.body.cryptoPriceAmountUsd, 5);
  const pending = db.prepare('SELECT * FROM wallet_transactions WHERE id=?').get(deposit.body.transactionId);
  assert.equal(pending.status, 'pending');
  assert.ok(pending.paypal_order_id);
  assert.equal(pending.paypal_amount_usd, 5);

  const otherAuth = createTestAccountAuth('wallet-paypal-other@example.com');
  const wrongOwner = await request(app).post(`/api/wallet/deposits/${pending.id}/paypal-capture`).set(otherAuth);
  assert.equal(wrongOwner.status, 404);

  const originalCapture = paypalGateway.captureOrder;
  paypalGateway.captureOrder = async () => ({
    status: 'COMPLETED', customId: 'someone-elses-deposit', captureStatus: 'COMPLETED', amountValue: 5, amountCurrency: 'USD'
  });
  const mismatchedCapture = await request(app).post(`/api/wallet/deposits/${pending.id}/paypal-capture`).set(auth);
  assert.equal(mismatchedCapture.status, 409);
  assert.equal(db.prepare('SELECT status FROM wallet_transactions WHERE id=?').get(pending.id).status, 'review');
  paypalGateway.captureOrder = originalCapture;

  db.prepare("UPDATE wallet_transactions SET status='pending' WHERE id=?").run(pending.id);
  const captured = await request(app).post(`/api/wallet/deposits/${pending.id}/paypal-capture`).set(auth);
  assert.equal(captured.status, 200);
  assert.equal(captured.body.status, 'completed');
  assert.equal((await request(app).get('/api/wallet').set(auth)).body.balanceKes, 650);

  const replay = await request(app).post(`/api/wallet/deposits/${pending.id}/paypal-capture`).set(auth);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.status, 'completed');
  assert.equal((await request(app).get('/api/wallet').set(auth)).body.balanceKes, 650);

  const webhookDeposit = await request(app).post('/api/wallet/deposits').set(auth)
    .send({ amountKes: 390, paymentMethod: 'paypal' });
  const webhookPending = db.prepare('SELECT * FROM wallet_transactions WHERE id=?').get(webhookDeposit.body.transactionId);
  const eventFor = (overrides) => ({
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: { custom_id: webhookPending.id, amount: { value: String(webhookPending.paypal_amount_usd), currency_code: 'USD' } },
    ...overrides
  });

  const badSignature = await request(app).post('/api/paypal/webhook')
    .set('paypal-transmission-sig', 'invalid').send(eventFor());
  assert.equal(badSignature.status, 400);
  assert.equal(db.prepare('SELECT status FROM wallet_transactions WHERE id=?').get(webhookPending.id).status, 'pending');

  const mismatchedAmount = await request(app).post('/api/paypal/webhook')
    .set('paypal-transmission-sig', 'test-paypal-signature')
    .send(eventFor({ resource: { custom_id: webhookPending.id, amount: { value: '1.00', currency_code: 'USD' } } }));
  assert.equal(mismatchedAmount.status, 200);
  assert.equal(db.prepare('SELECT status FROM wallet_transactions WHERE id=?').get(webhookPending.id).status, 'review');

  db.prepare("UPDATE wallet_transactions SET status='pending' WHERE id=?").run(webhookPending.id);
  const finished = await request(app).post('/api/paypal/webhook')
    .set('paypal-transmission-sig', 'test-paypal-signature').send(eventFor());
  assert.equal(finished.status, 200);
  assert.equal(db.prepare('SELECT status FROM wallet_transactions WHERE id=?').get(webhookPending.id).status, 'completed');
  assert.equal((await request(app).get('/api/wallet').set(auth)).body.balanceKes, 1040);

  await request(app).post('/api/paypal/webhook')
    .set('paypal-transmission-sig', 'test-paypal-signature').send(eventFor());
  assert.equal((await request(app).get('/api/wallet').set(auth)).body.balanceKes, 1040);

  const deniedDeposit = await request(app).post('/api/wallet/deposits').set(auth)
    .send({ amountKes: 260, paymentMethod: 'paypal' });
  const deniedPending = db.prepare('SELECT * FROM wallet_transactions WHERE id=?').get(deniedDeposit.body.transactionId);
  await request(app).post('/api/paypal/webhook')
    .set('paypal-transmission-sig', 'test-paypal-signature')
    .send({
      event_type: 'PAYMENT.CAPTURE.DENIED',
      resource: { custom_id: deniedPending.id, amount: { value: String(deniedPending.paypal_amount_usd), currency_code: 'USD' } }
    });
  assert.equal(db.prepare('SELECT status FROM wallet_transactions WHERE id=?').get(deniedPending.id).status, 'failed');
});

test('advertising tiers price by day, enforce day limits, and gate placement by paid tier', async () => {
  const organizerAuth = createTestAccountAuth('ad-tiers-organizer@example.com');
  const event = createStoredTestEvent('Ad Tiers Festival', organizerAuth);

  const invalidPlacement = await request(app).post('/api/ads/admin/packages').set(admin)
    .send({ name: 'Bad tier', description: '', placement: 'not-a-real-placement', pricePerDayKes: 100, minDays: 1, maxDays: 30 });
  assert.equal(invalidPlacement.status, 400);

  const invalidDayRange = await request(app).post('/api/ads/admin/packages').set(admin)
    .send({ name: 'Bad days', description: '', placement: 'listing', pricePerDayKes: 100, minDays: 10, maxDays: 5 });
  assert.equal(invalidDayRange.status, 400);

  const listingTier = db.prepare(`
    SELECT id,price_per_day_kes AS pricePerDayKes,min_days AS minDays,max_days AS maxDays
    FROM ad_packages WHERE placement='listing'
  `).get();
  const homepageTier = db.prepare(`
    SELECT id,price_per_day_kes AS pricePerDayKes FROM ad_packages WHERE placement='homepage'
  `).get();
  assert.ok(listingTier);
  assert.ok(homepageTier);

  const packages = await request(app).get('/api/ads/packages');
  assert.equal(packages.status, 200);
  assert.ok(packages.body.packages.length >= 4);
  assert.ok(packages.body.packages.every((tier) => Number.isInteger(tier.pricePerDayKes) && tier.placement));
  const prices = packages.body.packages.map((tier) => tier.pricePerDayKes);
  assert.deepEqual(prices, [...prices].sort((left, right) => left - right));

  const tooFewDays = await request(app).post('/api/orders/ads').send({
    eventId: event.id, packageId: listingTier.id, days: 0, buyerName: 'Organizer', phone: '0712345678'
  });
  assert.equal(tooFewDays.status, 400);

  const tooManyDays = await request(app).post('/api/orders/ads').send({
    eventId: event.id, packageId: listingTier.id, days: listingTier.maxDays + 1, buyerName: 'Organizer', phone: '0712345678'
  });
  assert.equal(tooManyDays.status, 400);

  function realCheckoutIds(orderId) {
    const row = db.prepare('SELECT checkout_request_id AS checkoutRequestId, merchant_request_id AS merchantRequestId FROM orders WHERE id=?').get(orderId);
    return [row.checkoutRequestId, row.merchantRequestId];
  }

  const listingOrder = await request(app).post('/api/orders/ads').send({
    eventId: event.id, packageId: listingTier.id, days: 3, buyerName: 'Organizer', phone: '0712345678'
  });
  assert.equal(listingOrder.status, 201);
  const expectedListingTotal = 3 * listingTier.pricePerDayKes;
  await completePayment(...realCheckoutIds(listingOrder.body.orderId), expectedListingTotal, 'ADTIER001');
  const listingBooking = db.prepare("SELECT * FROM ad_bookings WHERE event_id=? AND placement='listing'").get(event.id);
  assert.equal(listingBooking.days, 3);
  assert.equal(listingBooking.total_price_kes, expectedListingTotal);
  assert.equal(listingBooking.status, 'active');

  const homepageOrder = await request(app).post('/api/orders/ads').send({
    eventId: event.id, packageId: homepageTier.id, days: 2, buyerName: 'Organizer', phone: '0712345678'
  });
  assert.equal(homepageOrder.status, 201);
  await completePayment(...realCheckoutIds(homepageOrder.body.orderId), 2 * homepageTier.pricePerDayKes, 'ADTIER002');

  const allFeatured = await request(app).get('/api/ads/featured');
  assert.ok(allFeatured.body.events.some((item) => item.id === event.id));
  const homepageFeatured = await request(app).get('/api/ads/featured?placement=homepage');
  assert.ok(homepageFeatured.body.events.some((item) => item.id === event.id));

  const listingOnlyEvent = createStoredTestEvent('Listing Only Festival', organizerAuth);
  const listingOnlyOrder = await request(app).post('/api/orders/ads').send({
    eventId: listingOnlyEvent.id, packageId: listingTier.id, days: 1, buyerName: 'Organizer', phone: '0712345678'
  });
  assert.equal(listingOnlyOrder.status, 201);
  await completePayment(...realCheckoutIds(listingOnlyOrder.body.orderId), listingTier.pricePerDayKes, 'ADTIER003');

  const allFeaturedAfter = await request(app).get('/api/ads/featured');
  assert.ok(allFeaturedAfter.body.events.some((item) => item.id === listingOnlyEvent.id));
  const homepageFeaturedAfter = await request(app).get('/api/ads/featured?placement=homepage');
  assert.ok(!homepageFeaturedAfter.body.events.some((item) => item.id === listingOnlyEvent.id));
});

test('advertising orders also accept NOWPayments and PayPal, activating the booking only once paid', async () => {
  const organizerAuth = createTestAccountAuth('ad-payment-methods-organizer@example.com');
  const event = createStoredTestEvent('Ad Payment Methods Festival', organizerAuth);
  const listingTier = db.prepare("SELECT id,price_per_day_kes AS pricePerDayKes FROM ad_packages WHERE placement='listing'").get();

  const cryptoOrder = await request(app).post('/api/orders/ads').send({
    eventId: event.id, packageId: listingTier.id, days: 2, buyerName: 'Organizer', paymentMethod: 'nowpayments'
  });
  assert.equal(cryptoOrder.status, 201);
  assert.equal(cryptoOrder.body.paymentMethod, 'nowpayments');
  assert.ok(cryptoOrder.body.checkoutUrl);
  const cryptoBookingBefore = db.prepare(`
    SELECT b.status FROM ad_bookings b JOIN orders o ON o.ad_booking_id=b.id WHERE o.id=?
  `).get(cryptoOrder.body.orderId);
  assert.equal(cryptoBookingBefore.status, 'pending_payment');

  const cryptoOrderRow = db.prepare('SELECT nowpayments_invoice_id,amount_kes FROM orders WHERE id=?').get(cryptoOrder.body.orderId);
  const cryptoPriceUsd = Math.round((cryptoOrderRow.amount_kes / 130) * 100) / 100;
  const ipn = await request(app).post('/api/nowpayments/ipn')
    .set('x-nowpayments-sig', 'test-nowpayments-signature')
    .send({
      order_id: cryptoOrder.body.orderId,
      invoice_id: cryptoOrderRow.nowpayments_invoice_id,
      payment_status: 'finished',
      price_amount: String(cryptoPriceUsd),
      price_currency: 'usd'
    });
  assert.equal(ipn.status, 200);
  const cryptoBookingAfter = db.prepare(`
    SELECT b.status FROM ad_bookings b JOIN orders o ON o.ad_booking_id=b.id WHERE o.id=?
  `).get(cryptoOrder.body.orderId);
  assert.equal(cryptoBookingAfter.status, 'active');

  const paypalOrder = await request(app).post('/api/orders/ads').send({
    eventId: event.id, packageId: listingTier.id, days: 1, buyerName: 'Organizer', paymentMethod: 'paypal'
  });
  assert.equal(paypalOrder.status, 201);
  assert.equal(paypalOrder.body.paymentMethod, 'paypal');
  assert.ok(paypalOrder.body.checkoutUrl);

  const captured = await request(app).post(`/api/orders/${paypalOrder.body.orderId}/paypal-capture`)
    .set('X-Order-Access', paypalOrder.body.accessToken);
  assert.equal(captured.status, 200);
  assert.equal(captured.body.status, 'completed');
  const paypalBooking = db.prepare(`
    SELECT b.status FROM ad_bookings b JOIN orders o ON o.ad_booking_id=b.id WHERE o.id=?
  `).get(paypalOrder.body.orderId);
  assert.equal(paypalBooking.status, 'active');

  const replay = await request(app).post(`/api/orders/${paypalOrder.body.orderId}/paypal-capture`)
    .set('X-Order-Access', paypalOrder.body.accessToken);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.status, 'paid');
});

test('signed-in sponsors can pay directly for packages and manage their own sponsorships', async () => {
  function realSponsorshipCheckoutIds(id) {
    const row = db.prepare(`
      SELECT checkout_request_id AS checkoutRequestId, merchant_request_id AS merchantRequestId
      FROM sponsorship_purchases WHERE id=?
    `).get(id);
    return [row.checkoutRequestId, row.merchantRequestId];
  }

  const tiers = await request(app).get('/api/sponsorships/tiers');
  assert.equal(tiers.status, 200);
  assert.deepEqual(tiers.body.tiers.map((tier) => tier.priceKes), [25000, 75000, 200000]);
  assert.deepEqual(tiers.body.tiers.map((tier) => tier.days), [14, 30, 60]);

  const sponsorAuth = createTestAccountAuth('sponsorship-account@example.com');
  assert.equal((await request(app).post('/api/sponsorships').send({
    tier: 'community', brandName: 'Signed In Required', buyerName: 'Jane', paymentMethod: 'mpesa', phone: '0712345678'
  })).status, 401);

  const invalidTier = await request(app).post('/api/sponsorships').set(sponsorAuth).send({
    tier: 'platinum', brandName: 'Acme', buyerName: 'Jane', paymentMethod: 'mpesa', phone: '0712345678'
  });
  assert.equal(invalidTier.status, 400);

  const badLogo = await request(app).post('/api/sponsorships').set(sponsorAuth).send({
    tier: 'community', brandName: 'Acme', logoUrl: 'not-a-url', buyerName: 'Jane', paymentMethod: 'mpesa', phone: '0712345678'
  });
  assert.equal(badLogo.status, 400);

  const mpesaPurchase = await request(app).post('/api/sponsorships').set(sponsorAuth).send({
    tier: 'community', brandName: 'Acme Coffee', websiteUrl: 'https://acme.example',
    logoUrl: 'https://acme.example/logo.png', buyerName: 'Jane Doe', paymentMethod: 'mpesa', phone: '0712345678'
  });
  assert.equal(mpesaPurchase.status, 201);
  assert.equal(mpesaPurchase.body.status, 'pending');
  const beforeActive = await request(app).get('/api/sponsorships/active');
  assert.ok(!beforeActive.body.sponsors.some((sponsor) => sponsor.brandName === 'Acme Coffee'));
  const pendingImpression = await request(app)
    .post(`/api/sponsorships/${mpesaPurchase.body.purchaseId}/viewable-impressions`)
    .send({ impressionId: crypto.randomUUID(), placement: 'home-sponsor-strip' });
  assert.equal(pendingImpression.status, 404);

  await completePayment(...realSponsorshipCheckoutIds(mpesaPurchase.body.purchaseId), 25000, 'SPONSOR001');
  const purchaseStatus = await request(app).get(`/api/sponsorships/${mpesaPurchase.body.purchaseId}`)
    .set('X-Order-Access', mpesaPurchase.body.accessToken);
  assert.equal(purchaseStatus.status, 200);
  assert.equal(purchaseStatus.body.status, 'active');
  const publicSponsors = await request(app).get('/api/sponsorships/active');
  const activeSponsor = publicSponsors.body.sponsors.find((sponsor) => sponsor.brandName === 'Acme Coffee');
  assert.equal(activeSponsor.trackingId, mpesaPurchase.body.purchaseId);
  const impressionId = crypto.randomUUID();
  const impression = await request(app)
    .post(`/api/sponsorships/${activeSponsor.trackingId}/viewable-impressions`)
    .send({ impressionId, placement: 'home-sponsor-strip' });
  assert.equal(impression.status, 202);
  assert.equal(impression.body.recorded, true);
  const duplicateImpression = await request(app)
    .post(`/api/sponsorships/${activeSponsor.trackingId}/viewable-impressions`)
    .send({ impressionId, placement: 'home-sponsor-strip' });
  assert.equal(duplicateImpression.status, 202);
  assert.equal(duplicateImpression.body.recorded, false);
  const invalidPlacement = await request(app)
    .post(`/api/sponsorships/${activeSponsor.trackingId}/viewable-impressions`)
    .send({ impressionId: crypto.randomUUID(), placement: 'unsupported' });
  assert.equal(invalidPlacement.status, 400);
  const ownedPurchases = await request(app).get('/api/sponsorships/me').set(sponsorAuth);
  assert.equal(ownedPurchases.status, 200);
  assert.deepEqual(ownedPurchases.body.purchases.map((purchase) => purchase.purchaseId), [mpesaPurchase.body.purchaseId]);
  assert.equal(ownedPurchases.body.purchases[0].viewableImpressions, 1);
  assert.deepEqual((await request(app).get('/api/sponsorships/me')
    .set(createTestAccountAuth('other-sponsorship-account@example.com'))).body.purchases, []);
  const afterActive = await request(app).get('/api/sponsorships/active');
  assert.ok(afterActive.body.sponsors.some((sponsor) => sponsor.brandName === 'Acme Coffee' && sponsor.tier === 'community'));

  const walletAuth = createTestAccountAuth('sponsor-wallet-buyer@example.com');
  createTestWallet(walletAuth, 100000);
  const walletPurchase = await request(app).post('/api/sponsorships').set(walletAuth).send({
    tier: 'city', brandName: 'Wallet Wear', buyerName: 'Wallet Buyer', paymentMethod: 'wallet'
  });
  assert.equal(walletPurchase.status, 201);
  assert.equal(walletPurchase.body.status, 'active');
  assert.equal((await request(app).get('/api/wallet').set(walletAuth)).body.balanceKes, 25000);

  const cryptoPurchase = await request(app).post('/api/sponsorships').set(sponsorAuth).send({
    tier: 'city', brandName: 'City Threads', buyerName: 'John Doe', paymentMethod: 'nowpayments'
  });
  assert.equal(cryptoPurchase.status, 201);
  assert.equal(cryptoPurchase.body.paymentMethod, 'nowpayments');
  assert.ok(cryptoPurchase.body.checkoutUrl);
  const cryptoRow = db.prepare('SELECT nowpayments_invoice_id,amount_kes FROM sponsorship_purchases WHERE id=?').get(cryptoPurchase.body.purchaseId);
  const cryptoPriceUsd = Math.round((cryptoRow.amount_kes / 130) * 100) / 100;
  const ipn = await request(app).post('/api/nowpayments/ipn')
    .set('x-nowpayments-sig', 'test-nowpayments-signature')
    .send({
      order_id: cryptoPurchase.body.purchaseId,
      invoice_id: cryptoRow.nowpayments_invoice_id,
      payment_status: 'finished',
      price_amount: String(cryptoPriceUsd),
      price_currency: 'usd'
    });
  assert.equal(ipn.status, 200);
  assert.equal(db.prepare('SELECT status FROM sponsorship_purchases WHERE id=?').get(cryptoPurchase.body.purchaseId).status, 'active');

  const paypalPurchase = await request(app).post('/api/sponsorships').set(sponsorAuth).send({
    tier: 'premium', brandName: 'Premium Motors', buyerName: 'Amina', paymentMethod: 'paypal'
  });
  assert.equal(paypalPurchase.status, 201);
  assert.equal(paypalPurchase.body.paymentMethod, 'paypal');
  const captured = await request(app).post(`/api/sponsorships/${paypalPurchase.body.purchaseId}/paypal-capture`)
    .set('X-Order-Access', paypalPurchase.body.accessToken);
  assert.equal(captured.status, 200);
  assert.equal(captured.body.status, 'active');

  const finalActive = await request(app).get('/api/sponsorships/active');
  assert.equal(finalActive.body.sponsors[0].tier, 'premium');

  assert.equal((await request(app).get('/api/sponsorships/admin')).status, 401);
  const adminList = await request(app).get('/api/sponsorships/admin').set(admin);
  assert.equal(adminList.status, 200);
  assert.ok(adminList.body.purchases.length >= 4);

  const cancel = await request(app).patch(`/api/sponsorships/admin/${mpesaPurchase.body.purchaseId}`)
    .set(admin).send({ status: 'cancelled' });
  assert.equal(cancel.status, 200);
  const afterCancel = await request(app).get('/api/sponsorships/active');
  assert.ok(!afterCancel.body.sponsors.some((sponsor) => sponsor.brandName === 'Acme Coffee'));
  const doubleCancel = await request(app).patch(`/api/sponsorships/admin/${mpesaPurchase.body.purchaseId}`)
    .set(admin).send({ status: 'cancelled' });
  assert.equal(doubleCancel.status, 409);
});

test('sponsor campaign links attribute paid orders and organizers submit verifiable delivery reports', async () => {
  const sponsorAuth = createTestAccountAuth(`campaign-sponsor-${crypto.randomUUID()}@example.com`);
  const organizerAuth = createTestAccountAuth(`campaign-organizer-${crypto.randomUUID()}@example.com`);
  const buyerAuth = createTestAccountAuth(`campaign-buyer-${crypto.randomUUID()}@example.com`);
  const event = createStoredTestEvent('Sponsor Attribution Showcase', organizerAuth);
  const purchase = await request(app).post('/api/sponsorships').set(sponsorAuth).send({
    tier: 'community',
    brandName: 'Campaign Brand',
    websiteUrl: 'https://campaign-brand.example',
    buyerName: 'Campaign Sponsor',
    paymentMethod: 'mpesa',
    phone: '0712345678'
  });
  assert.equal(purchase.status, 201);
  const sponsorPayment = db.prepare(`
    SELECT checkout_request_id AS checkoutRequestId,merchant_request_id AS merchantRequestId
    FROM sponsorship_purchases WHERE id=?
  `).get(purchase.body.purchaseId);
  await completePayment(sponsorPayment.checkoutRequestId, sponsorPayment.merchantRequestId, 25000, 'CAMPAIGN001');
  db.prepare(`
    UPDATE sponsorship_purchases SET starts_at=?,ends_at=? WHERE id=?
  `).run(
    new Date(Date.now() - 3 * 86400000).toISOString(),
    new Date(Date.now() + 11 * 86400000).toISOString(),
    purchase.body.purchaseId
  );

  const selectedEvents = await request(app)
    .put(`/api/sponsorships/${purchase.body.purchaseId}/events`)
    .set(sponsorAuth)
    .send({ eventIds: [event.id] });
  assert.equal(selectedEvents.status, 200);
  const externalClick = await request(app)
    .get(`/api/sponsorships/${purchase.body.purchaseId}/click?placement=home-sponsor-strip`);
  assert.equal(externalClick.status, 302);
  assert.equal(externalClick.headers.location, 'https://campaign-brand.example/');
  const eventClick = await request(app)
    .get(`/api/sponsorships/${purchase.body.purchaseId}/events/${event.id}/click`);
  assert.equal(eventClick.status, 302);
  const eventLanding = new URL(eventClick.headers.location);
  const clickId = eventLanding.searchParams.get('sponsor_click');
  assert.ok(clickId);
  assert.equal(eventLanding.searchParams.get('sponsor_event'), event.id);
  assert.equal((await request(app).get(`/api/sponsorships/${purchase.body.purchaseId}/events/${crypto.randomUUID()}/click`)).status, 404);

  const invalidAttribution = await request(app).post('/api/orders/tickets').set(buyerAuth).send({
    eventId: event.id,
    ticketType: 'Regular',
    buyerName: 'Test Buyer',
    phone: '0712345678',
    paymentMethod: 'mpesa',
    sponsorshipClickId: crypto.randomUUID()
  });
  assert.equal(invalidAttribution.status, 409);

  const ticketOrder = await request(app).post('/api/orders/tickets').set(buyerAuth).send({
    eventId: event.id,
    ticketType: 'Regular',
    buyerName: 'Test Buyer',
    phone: '0712345678',
    paymentMethod: 'mpesa',
    sponsorshipClickId: clickId
  });
  assert.equal(ticketOrder.status, 201);
  const orderPayment = db.prepare(`
    SELECT checkout_request_id AS checkoutRequestId,merchant_request_id AS merchantRequestId
    FROM orders WHERE id=?
  `).get(ticketOrder.body.orderId);
  await completePayment(orderPayment.checkoutRequestId, orderPayment.merchantRequestId, 1200, 'CAMPAIGNTICKET001');
  const attributedOrder = db.prepare(`
    SELECT sponsorship_purchase_id AS campaignId,sponsorship_click_id AS clickId
    FROM orders WHERE id=?
  `).get(ticketOrder.body.orderId);
  assert.equal(attributedOrder.campaignId, purchase.body.purchaseId);
  assert.equal(attributedOrder.clickId, clickId);

  const eventStartsAt = new Date(Date.now() - 5 * 3600000).toISOString();
  const eventEndsAt = new Date(Date.now() - 3600000).toISOString();
  db.prepare('UPDATE events SET starts_at=?,ends_at=? WHERE id=?').run(eventStartsAt, eventEndsAt, event.id);
  const unauthorizedDelivery = await request(app)
    .post(`/api/events/mine/${event.id}/sponsorship-deliveries`)
    .set(createTestAccountAuth(`unrelated-organizer-${crypto.randomUUID()}@example.com`))
    .send({
      campaignId: purchase.body.purchaseId,
      attendanceCount: 250,
      checkInCount: 180,
      samplesRedeemed: 90
    });
  assert.equal(unauthorizedDelivery.status, 404);

  const delivery = await request(app)
    .post(`/api/events/mine/${event.id}/sponsorship-deliveries`)
    .set(organizerAuth)
    .send({
      campaignId: purchase.body.purchaseId,
      attendanceCount: 250,
      checkInCount: 180,
      samplesRedeemed: 90,
      otherDeliverables: 'Stage banner displayed and sponsor mention delivered.'
    });
  assert.equal(delivery.status, 201);
  assert.equal(delivery.body.status, 'pending');
  const reviewed = await request(app)
    .patch(`/api/sponsorship-deliveries/admin/${delivery.body.deliveryId}`)
    .set(admin)
    .send({ status: 'verified', verificationNote: 'Event-day photos reviewed.' });
  assert.equal(reviewed.status, 200);

  const today = new Date().toISOString().slice(0, 10);
  const report = await request(app)
    .get(`/api/sponsorships/${purchase.body.purchaseId}/report?startDate=${today}&endDate=${today}`)
    .set(sponsorAuth);
  assert.equal(report.status, 200);
  assert.equal(report.body.metrics.clicks, 2);
  assert.equal(report.body.metrics.eventLinkClicks, 1);
  assert.equal(report.body.metrics.attributedPaidOrders, 1);
  assert.equal(report.body.metrics.attributedTickets, 1);
  assert.equal(report.body.metrics.attributedSalesKes, 1200);
  assert.equal(report.body.metrics.ticketConversionRate, 1);
  assert.equal(report.body.metrics.costPerClickKes, 12500);
  const homePlacement = report.body.placements.find((placement) => placement.placement === 'home-sponsor-strip');
  assert.equal(homePlacement.clicks, 1);
  const verifiedDelivery = report.body.deliveries[0];
  assert.equal(verifiedDelivery.status, 'verified');
  assert.equal(verifiedDelivery.verifiedBy, 'test-admin');
  assert.equal(verifiedDelivery.attendanceCount, 250);
});

test('premium sponsors can run a tracked homepage billboard video', async () => {
  const fakeMp4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.alloc(8)]);
  const fakePng = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(8)]);

  const communityAuth = createTestAccountAuth(`billboard-community-${crypto.randomUUID()}@example.com`);
  createTestWallet(communityAuth, 100000);
  const notPremium = await request(app).post('/api/sponsorships').set(communityAuth).send({
    tier: 'community', brandName: 'Too Small', websiteUrl: 'https://small.example',
    videoUrl: 'https://small.example/ad.mp4', buyerName: 'Sam', paymentMethod: 'wallet'
  });
  assert.equal(notPremium.status, 400);
  assert.match(notPremium.body.error, /Premium Partner/);

  const premiumAuth = createTestAccountAuth(`billboard-premium-${crypto.randomUUID()}@example.com`);
  createTestWallet(premiumAuth, 500000);
  const noWebsite = await request(app).post('/api/sponsorships').set(premiumAuth)
    .field('tier', 'premium').field('brandName', 'No Site').field('buyerName', 'Ann').field('paymentMethod', 'wallet')
    .attach('videoFile', fakeMp4, { filename: 'ad.mp4', contentType: 'video/mp4' });
  assert.equal(noWebsite.status, 400);
  assert.match(noWebsite.body.error, /website link/);

  const purchase = await request(app).post('/api/sponsorships').set(premiumAuth)
    .field('tier', 'premium').field('brandName', 'EABL').field('websiteUrl', 'https://eabl.example')
    .field('tagline', 'Proud partner of Kenyan live events').field('buyerName', 'Ann').field('paymentMethod', 'wallet')
    .attach('videoFile', fakeMp4, { filename: 'ad.mp4', contentType: 'video/mp4' })
    .attach('imageFile', fakePng, { filename: 'poster.png', contentType: 'image/png' });
  assert.equal(purchase.status, 201);
  assert.equal(purchase.body.status, 'active');
  const purchaseId = purchase.body.purchaseId;

  const billboard = await request(app).get('/api/sponsorships/featured-billboard');
  assert.equal(billboard.status, 200);
  const slide = billboard.body.sponsors.find((sponsor) => sponsor.id === purchaseId);
  assert.ok(slide);
  assert.equal(slide.brandName, 'EABL');
  assert.equal(slide.tagline, 'Proud partner of Kenyan live events');
  assert.match(slide.videoUrl, new RegExp(`/uploads/sponsorships/${purchaseId}\\.mp4$`));
  assert.match(slide.videoPosterUrl, new RegExp(`/uploads/sponsorships/${purchaseId}-poster\\.png$`));
  const servedVideo = await request(app).get(`/uploads/sponsorships/${purchaseId}.mp4`);
  assert.equal(servedVideo.status, 200);
  assert.ok(!billboard.body.sponsors.some((sponsor) => sponsor.brandName === 'Too Small'));

  const click = await request(app).get(`/api/sponsorships/${purchaseId}/click?placement=homepage-billboard`);
  assert.equal(click.status, 302);
  assert.equal(click.headers.location, 'https://eabl.example/');
  const impression = await request(app).post(`/api/sponsorships/${purchaseId}/viewable-impressions`)
    .send({ impressionId: crypto.randomUUID(), placement: 'homepage-billboard' });
  assert.equal(impression.status, 202);
  assert.equal(impression.body.recorded, true);

  const report = await request(app).get(`/api/sponsorships/${purchaseId}/report`).set(premiumAuth);
  assert.equal(report.status, 200);
  const billboardPlacement = report.body.placements.find((placement) => placement.placement === 'homepage-billboard');
  assert.equal(billboardPlacement.impressions, 1);
  assert.equal(billboardPlacement.clicks, 1);
  assert.equal(billboardPlacement.clickThroughRate, 1);

  const mine = await request(app).get('/api/sponsorships/me').set(premiumAuth);
  assert.equal(mine.body.purchases[0].tagline, 'Proud partner of Kenyan live events');
  assert.ok(mine.body.purchases[0].videoUrl);
  const adminList = await request(app).get('/api/sponsorships/admin').set(admin);
  assert.ok(adminList.body.purchases.find((row) => row.id === purchaseId).videoUrl);

  const cancel = await request(app).patch(`/api/sponsorships/admin/${purchaseId}`).set(admin).send({ status: 'cancelled' });
  assert.equal(cancel.status, 200);
  const afterCancel = await request(app).get('/api/sponsorships/featured-billboard');
  assert.ok(!afterCancel.body.sponsors.some((sponsor) => sponsor.id === purchaseId));
});

test('event pages report sold-out status and homepage review highlights include other reviewed events', async () => {
  const soldOutAuth = createTestAccountAuth(`sold-out-attendee-${crypto.randomUUID()}@example.com`);
  const soldOutEvent = createStoredTestEvent('Sold Out Showcase', soldOutAuth);
  db.prepare(`
    UPDATE events SET capacity=1,regular_price=0,early_bird_price=NULL,early_bird_ends=NULL,vip_price=NULL WHERE id=?
  `).run(soldOutEvent.id);

  const openAuth = createTestAccountAuth(`not-sold-out-attendee-${crypto.randomUUID()}@example.com`);
  const openEvent = createStoredTestEvent('Still Has Room Showcase', openAuth);
  db.prepare(`
    UPDATE events SET capacity=10,regular_price=0,early_bird_price=NULL,early_bird_ends=NULL,vip_price=NULL WHERE id=?
  `).run(openEvent.id);

  const beforeSale = await request(app).get(`/api/events/by-slug/${soldOutEvent.slug}`);
  assert.equal(beforeSale.body.event.soldOut, false);
  assert.equal(beforeSale.body.event.ticketsSold, 0);

  const soldOutRegistration = await request(app).post('/api/orders/tickets').set(soldOutAuth).send({
    eventId: soldOutEvent.id, ticketType: 'Regular', buyerName: 'Sold Out Attendee', phone: '0712345678', quantity: 1
  });
  assert.equal(soldOutRegistration.status, 201);

  const openRegistration = await request(app).post('/api/orders/tickets').set(openAuth).send({
    eventId: openEvent.id, ticketType: 'Regular', buyerName: 'Open Attendee', phone: '0712345679', quantity: 1
  });
  assert.equal(openRegistration.status, 201);

  const afterSale = await request(app).get(`/api/events/by-slug/${soldOutEvent.slug}`);
  assert.equal(afterSale.body.event.soldOut, true);
  assert.equal(afterSale.body.event.ticketsSold, 1);
  const stillOpen = await request(app).get(`/api/events/by-slug/${openEvent.slug}`);
  assert.equal(stillOpen.body.event.soldOut, false);

  db.prepare(`UPDATE events SET ends_at=datetime('now','-1 day') WHERE id IN (?,?)`)
    .run(soldOutEvent.id, openEvent.id);

  const soldOutReview = await request(app).post(`/api/account/events/${soldOutEvent.id}/feedback`)
    .set(soldOutAuth).send({ loved: true, rating: 5, review: 'Packed house, incredible energy all night.' });
  assert.equal(soldOutReview.status, 200);

  const openReview = await request(app).post(`/api/account/events/${openEvent.id}/feedback`)
    .set(openAuth).send({ loved: true, rating: 5, review: 'Good event but not sold out.' });
  assert.equal(openReview.status, 200);

  const highlights = await request(app).get('/api/reviews/highlights');
  assert.equal(highlights.status, 200);
  assert.ok(highlights.body.highlights.some((item) => item.review === 'Packed house, incredible energy all night.'
    && item.rating === 5 && item.eventSlug === soldOutEvent.slug));
  assert.ok(highlights.body.highlights.some((item) => item.review === 'Good event but not sold out.'
    && item.rating === 5 && item.eventSlug === openEvent.slug));

  db.prepare(`UPDATE events SET starts_at=datetime('now','+1 day'),ends_at=datetime('now','+2 day') WHERE id=?`)
    .run(openEvent.id);
  const afterReschedule = await request(app).get('/api/reviews/highlights');
  assert.ok(!afterReschedule.body.highlights.some((item) => item.eventSlug === openEvent.slug));
  assert.ok(afterReschedule.body.highlights.some((item) => item.eventSlug === soldOutEvent.slug));
});

test('the events sitemap lists only approved events as absolute public-site URLs', async () => {
  const owner = createTestAccountAuth('sitemap-owner@example.com');
  const approved = createStoredTestEvent('Sitemap Test Festival', owner);
  const pending = createStoredTestEvent('Sitemap Pending Festival', owner);
  db.prepare("UPDATE events SET status='pending' WHERE id=?").run(pending.id);

  const sitemap = await request(app).get('/sitemap-events.xml');
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.headers['content-type'], /xml/);
  assert.match(sitemap.text, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(
    sitemap.text,
    new RegExp(`<loc>https://valorafrica\\.co\\.ke/event\\.html\\?slug=${approved.slug}</loc>`)
  );
  assert.equal(sitemap.text.includes(pending.slug), false);
  assert.match(sitemap.text, /<loc>https:\/\/valorafrica\.co\.ke\/events\.html\?city=Nairobi<\/loc>/);
  assert.equal(sitemap.text.includes('city=Malindi'), false);
});

test('the share preview page server-renders event-specific meta tags and redirects browsers onward', async () => {
  const owner = createTestAccountAuth('share-owner@example.com');
  const approved = createStoredTestEvent('Share Preview Festival', owner);
  db.prepare("UPDATE events SET description=? WHERE id=?").run('A real description for sharing.', approved.id);

  const page = await request(app).get(`/share/event/${approved.slug}`);
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /html/);
  assert.match(page.text, /<title>Share Preview Festival \| Valor Africa Events<\/title>/);
  assert.match(page.text, /<meta property="og:title" content="Share Preview Festival \| Valor Africa Events">/);
  assert.match(page.text, /<meta property="og:description" content="A real description for sharing\.">/);
  assert.match(
    page.text,
    new RegExp(`<meta property="og:url" content="https://valorafrica\\.co\\.ke/event\\.html\\?slug=${approved.slug}">`)
  );
  assert.match(page.text, /<meta name="robots" content="noindex, follow">/);
  assert.match(page.text, new RegExp(`location\\.replace\\("https://valorafrica\\.co\\.ke/event\\.html\\?slug=${approved.slug}"\\)`));

  const pending = createStoredTestEvent('Share Pending Festival', owner);
  db.prepare("UPDATE events SET status='pending' WHERE id=?").run(pending.id);
  const missing = await request(app).get(`/share/event/${pending.slug}`);
  assert.equal(missing.status, 302);
  assert.equal(missing.headers.location, 'https://valorafrica.co.ke/events.html');
});

test('hero-slide and ad-package admin routes are also reachable without "/ads/" in the path', async () => {
  // Ad blockers commonly drop any request whose path contains "/ads/", so the admin
  // dashboard's own fetch calls need a path that avoids that pattern entirely.
  assert.equal((await request(app).get('/api/admin/hero-slides')).status, 401);
  const createdSlide = await request(app).post('/api/admin/hero-slides').set(admin).send({
    title: 'Ad-blocker-safe slide',
    category: 'Featured events',
    description: 'Reachable without /ads/ in the path.',
    mediaType: 'image',
    mediaUrl: 'images/weekend-festival.jpg',
    posterUrl: '',
    linkUrl: 'events.html',
    ctaLabel: 'Browse events'
  });
  assert.equal(createdSlide.status, 201);
  const listed = await request(app).get('/api/admin/hero-slides').set(admin);
  assert.ok(listed.body.slides.some((slide) => slide.id === createdSlide.body.slide.id));

  const createdPackage = await request(app).post('/api/admin/packages').set(admin).send({
    name: 'Ad-blocker-safe tier', placement: 'listing', pricePerDayKes: 500, minDays: 1, maxDays: 30
  });
  assert.equal(createdPackage.status, 201);
  const listedPackages = await request(app).get('/api/admin/packages').set(admin);
  assert.ok(listedPackages.body.packages.some((pkg) => pkg.id === createdPackage.body.id));
});

after(() => {
  db.close();
  fs.rmSync(path.join(__dirname, '..', '.test-uploads'), { recursive: true, force: true });
});
