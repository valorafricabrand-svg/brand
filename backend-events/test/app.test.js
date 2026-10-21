process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.UPLOAD_DIR = require('path').join(__dirname, '..', '.test-uploads');
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
const db = require('../src/db');
const { createApp, initializeAdmin } = require('../src/app');
const { login } = require('../src/auth');
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
const app = createApp({
  mpesa: paymentGateway,
  stripe: stripeGateway,
  sms: smsGateway,
  email: emailGateway,
  ticketEmail: ticketEmailGateway,
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

function createTestAccountAuth(email) {
  const id = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare(`
    INSERT INTO accounts (id,email,display_name,email_verified_at)
    VALUES (?,?,?,datetime('now'))
  `).run(id, email, email.split('@')[0]);
  db.prepare(`
    INSERT INTO account_sessions (token_hash,account_id,expires_at)
    VALUES (?,?,datetime('now','+12 hours'))
  `).run(tokenHash, id);
  return { Authorization: `Bearer ${token}` };
}

function submitEvent(title = 'Test Live Festival', auth = createTestAccountAuth(`event-submitter-${crypto.randomUUID()}@example.com`)) {
  const future = Date.now() + 7 * 86400000;
  const starts = new Date(future).toISOString();
  const ends = new Date(future + 4 * 3600000).toISOString();
  const submission = request(app).post('/api/events/submissions')
    .field('title', title)
    .field('description', 'A live event description for a test festival.')
    .field('category', 'Festivals')
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
    .field('tags', 'music, culture')
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
  return request(app).post('/api/mpesa/callback').send({
    Body: { stkCallback: {
      CheckoutRequestID: checkoutRequestId,
      MerchantRequestID: merchantRequestId,
      ResultCode: 0,
      ResultDesc: 'The service request is processed successfully',
      CallbackMetadata: { Item: [
        { Name: 'Amount', Value: amount },
        { Name: 'MpesaReceiptNumber', Value: receipt }
      ] }
    } }
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

  const legacyPending = await submitEvent('Legacy Pending Event', owner);
  assert.equal(legacyPending.status, 201);
  db.prepare("UPDATE events SET status='pending' WHERE id=?").run(legacyPending.body.id);
  const pendingAfterLegacy = await request(app).get('/api/events/admin/submissions?status=pending').set(admin);
  assert.equal(pendingAfterLegacy.body.events[0].organizer.email, 'organizer@example.com');
  const approvedLegacy = await approveEvent(legacyPending.body.id);
  assert.equal(approvedLegacy.body.status, 'approved');

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

test('admin dashboard origin can call its same-origin API', async () => {
  const response = await request(app).get('/api/health')
    .set('Host', '127.0.0.1')
    .set('Origin', 'http://127.0.0.1');
  assert.equal(response.status, 200);
  assert.equal(response.body.ticketEmailsConfigured, true);
  assert.equal(response.headers['access-control-allow-origin'], 'http://127.0.0.1');
  const orders = await request(app).get('/api/orders/admin').set(admin);
  assert.equal(orders.status, 200);
  assert.deepEqual(orders.body.orders, []);
});

test('event posters require valid image signatures', async () => {
  const response = await submitEvent('Poster Signature Test')
    .attach('eventImage', Buffer.from('not a real image'), { filename: 'poster.png', contentType: 'image/png' });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /not a supported image/i);
});

test('ticket checkout is unavailable until Daraja is configured', async () => {
  paymentGateway.enabled = false;
  const event = db.prepare("SELECT id FROM events WHERE slug='test-live-festival'").get();
  const payload = { eventId: event.id, ticketType: 'Early bird', buyerName: 'Buyer', phone: '0712345678', quantity: 1 };
  const anonymous = await request(app).post('/api/orders/tickets').send(payload);
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.body.error, /sign in/i);
  const response = await request(app).post('/api/orders/tickets').set(await ticketAccountAuth())
    .send(payload);
  assert.equal(response.status, 503);
  assert.equal(response.body.error.includes('Daraja'), true);
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

test('paid ticket order issues only after Daraja verifies the callback', async () => {
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

test('forged success callbacks do not issue tickets without Daraja verification', async () => {
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
    .send({ name: 'Homepage feature', description: 'Featured home carousel.', durationDays: 4, priceKes: 7500 });
  assert.equal(packageResponse.status, 201);
  const event = db.prepare("SELECT id FROM events WHERE slug='test-live-festival'").get();
  const checkout = await request(app).post('/api/orders/ads')
    .send({
      eventId: event.id,
      packageId: packageResponse.body.id,
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
  const accountAuth = await ticketAccountAuth();
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
  assert.equal(order.body.tickets.length, 1);
  assert.match(order.body.tickets[0].qr, /^data:image\/png;base64,/);
  const accountTickets = await request(app).get('/api/account/tickets').set(accountAuth);
  assert.equal(accountTickets.status, 200);
  const accountTicket = accountTickets.body.tickets.find((ticket) => ticket.orderId === registration.body.orderId);
  assert.ok(accountTicket);
  assert.equal(accountTicket.ticketEmailStatus, 'sent');
  assert.match(accountTicket.qr, /^data:image\/png;base64,/);
  const unrelatedTickets = await request(app).get('/api/account/tickets')
    .set(createTestAccountAuth('unrelated-ticket-owner@example.com'));
  assert.equal(unrelatedTickets.body.tickets.some((ticket) => ticket.orderId === registration.body.orderId), false);
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
    paymentMethod: 'paypal'
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

test('creator partners earn attributable commissions only on paid ticket orders and admins record payouts', async () => {
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
  assert.equal((await request(app).get('/api/partners/me').set(creatorAuth)).body.partner.status, 'pending');
  const partnerId = db.prepare('SELECT id FROM affiliate_partners WHERE account_id=?')
    .get(db.prepare('SELECT id FROM accounts WHERE email=?').get('creator-partner@example.com').id).id;
  const missingRate = await request(app).patch(`/api/partners/admin/${partnerId}`).set(admin).send({ status: 'approved' });
  assert.equal(missingRate.status, 400);
  const approval = await request(app).patch(`/api/partners/admin/${partnerId}`).set(admin).send({
    status: 'approved',
    commissionPercent: 10
  });
  assert.equal(approval.status, 200);
  assert.match(approval.body.referralCode, /^[A-F0-9]{10}$/);
  assert.equal((await request(app).get('/api/partners/admin')).status, 401);
  const adminPartnerList = await request(app).get('/api/partners/admin').set(admin);
  assert.equal(adminPartnerList.status, 200);
  assert.equal(adminPartnerList.body.partners.find((partner) => partner.id === partnerId).commissionPercent, 10);

  const visit = await request(app).post('/api/partners/visit').send({ code: approval.body.referralCode });
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
  assert.equal(order.affiliate_commission_percent, 10);
  assert.equal((await request(app).get('/api/partners/me').set(creatorAuth)).body.partner.earnedKes, 0);
  const updatedRate = await request(app).patch(`/api/partners/admin/${partnerId}`).set(admin).send({
    status: 'approved',
    commissionPercent: 15
  });
  assert.equal(updatedRate.status, 200);
  const paid = await completePayment(order.checkout_request_id, order.merchant_request_id, 2400, 'AFFILIATE01');
  assert.equal(paid.status, 200);
  const creatorDashboard = await request(app).get('/api/partners/me').set(creatorAuth);
  assert.equal(creatorDashboard.body.partner.clicks, 1);
  assert.equal(creatorDashboard.body.partner.conversions, 1);
  assert.equal(creatorDashboard.body.partner.earnedKes, 240);
  assert.equal(creatorDashboard.body.partner.dueKes, 240);

  const excessPayout = await request(app).post(`/api/partners/admin/${partnerId}/payout`).set(admin).send({
    amountKes: 241,
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
  assert.equal(afterPayout.body.partner.dueKes, 140);
  const finalAdminPartner = await request(app).get('/api/partners/admin').set(admin);
  assert.equal(finalAdminPartner.body.partners.find((partner) => partner.id === partnerId).dueKes, 140);
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
      applicationDetails: 'We want to reach local event communities with a campaign.'
    });
  assert.equal(invalidWebsite.status, 400);

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
  assert.equal(organizer.body.status, 'pending');
  assert.match(organizer.body.message, /no package or price is committed/);
  const duplicate = await request(app).post('/api/partnership-applications')
    .set(applicantAuth)
    .set('X-Forwarded-For', '198.51.100.50')
    .send({
      type: 'organizer',
      organizationName: 'Nairobi Events Collective',
      applicationDetails: 'We organize regular community and music events in Nairobi and would like to discuss listing and promotion.'
    });
  assert.equal(duplicate.status, 409);

  const sponsor = await request(app).post('/api/partnership-applications')
    .set(applicantAuth)
    .set('X-Forwarded-For', '198.51.100.50')
    .send({
      type: 'sponsor',
      organizationName: 'Sample Brand',
      applicationDetails: 'We want to reach local event communities with a brand campaign and discuss possible activations.',
      requestedSupport: 'Nairobi event sponsorship and brand activations.'
    });
  assert.equal(sponsor.status, 201);
  const mine = await request(app).get('/api/partnership-applications/me').set(applicantAuth);
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.applications.map((application) => application.type), ['organizer','sponsor']);

  assert.equal((await request(app).get('/api/partnership-applications/admin')).status, 401);
  const adminList = await request(app).get('/api/partnership-applications/admin').set(admin);
  assert.equal(adminList.status, 200);
  assert.equal(adminList.body.applications.length, 2);
  assert.equal((await request(app).get('/api/partnership-applications/admin?type=sponsor').set(admin)).body.applications.length, 1);
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
      applicationDetails: 'We want to reach local event communities with a brand campaign and discuss possible activations.',
      requestedSupport: 'Nairobi event sponsorship and brand activations.'
    });
  assert.equal(resubmittedSponsor.status, 201);
  const updatedSponsor = (await request(app).get('/api/partnership-applications/me')
    .set(applicantAuth)).body.applications.find((application) => application.type === 'sponsor');
  assert.equal(updatedSponsor.status, 'pending');
  assert.equal(updatedSponsor.adminNote, '');
});

after(() => {
  db.close();
  fs.rmSync(path.join(__dirname, '..', '.test-uploads'), { recursive: true, force: true });
});
