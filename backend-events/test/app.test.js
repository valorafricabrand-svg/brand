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
const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const request = require('supertest');
const db = require('../src/db');
const { createApp, initializeAdmin } = require('../src/app');
const { login } = require('../src/auth');

initializeAdmin();

let checkoutNumber = 0;
const paymentGateway = {
  enabled: true,
  async initiateStkPush(order) {
    checkoutNumber += 1;
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
const app = createApp({
  mpesa: paymentGateway,
  sms: smsGateway,
  email: emailGateway,
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

function submitEvent(title = 'Test Live Festival') {
  const future = Date.now() + 7 * 86400000;
  const starts = new Date(future).toISOString();
  const ends = new Date(future + 4 * 3600000).toISOString();
  return request(app).post('/api/events/submissions')
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

test('event submissions remain private until an admin approves them', async () => {
  const created = await submitEvent();
  assert.equal(created.status, 202);
  assert.equal(created.body.status, 'pending');
  assert.equal((await request(app).get('/api/events')).body.events.length, 0);
  assert.equal((await request(app).get(`/api/events/by-slug/${created.body.slug}`)).status, 404);

  const unauthorized = await request(app).get('/api/events/admin/submissions');
  assert.equal(unauthorized.status, 401);
  const pending = await request(app).get('/api/events/admin/submissions?status=pending').set(admin);
  assert.equal(pending.status, 200);
  assert.equal(pending.body.events[0].organizer.email, 'organizer@example.com');

  const approved = await approveEvent(created.body.id);
  assert.equal(approved.body.status, 'approved');
  const listing = await request(app).get('/api/events');
  assert.equal(listing.body.events.length, 1);
  assert.equal(listing.body.events[0].title, 'Test Live Festival');
  assert.equal(listing.body.events[0].tickets[0].name, 'Early bird');
  assert.equal(JSON.stringify(listing.body).includes('organizer@example.com'), false);
  assert.equal((await request(app).get(`/api/events/by-slug/${created.body.slug}`)).body.event.slug, created.body.slug);

  const rejected = await submitEvent('Rejected Test Event');
  const decision = await request(app).patch(`/api/events/admin/${rejected.body.id}/review`)
    .set(admin)
    .send({ status: 'rejected', reviewNote: 'Please update the event details.' });
  assert.equal(decision.status, 200);
  assert.equal(decision.body.status, 'rejected');
  assert.equal((await request(app).get(`/api/events/by-slug/${rejected.body.slug}`)).status, 404);
  assert.equal((await request(app).get('/api/events')).body.events.length, 1);
});

test('admin dashboard origin can call its same-origin API', async () => {
  const response = await request(app).get('/api/health')
    .set('Host', '127.0.0.1')
    .set('Origin', 'http://127.0.0.1');
  assert.equal(response.status, 200);
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
  paymentGateway.enabled = true;
});

test('paid ticket order issues only after Daraja verifies the callback', async () => {
  const event = db.prepare("SELECT id FROM events WHERE slug='test-live-festival'").get();
  const accountAuth = await ticketAccountAuth();
  const checkout = await request(app).post('/api/orders/tickets').set(accountAuth)
    .send({ eventId: event.id, ticketType: 'Early bird', buyerName: 'Buyer', phone: '0712345678', quantity: 2 });
  assert.equal(checkout.status, 201);
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
  assert.equal(submitted.status, 202);
  db.prepare('UPDATE events SET capacity=1 WHERE id=?').run(submitted.body.id);
  assert.equal((await approveEvent(submitted.body.id)).status, 200);
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

test('free registrations require an account but do not require M-Pesa', async () => {
  const submitted = await submitEvent('Free Ticket Registration');
  assert.equal(submitted.status, 202);
  db.prepare(`
    UPDATE events SET capacity=2,regular_price=0,early_bird_price=NULL,
      early_bird_ends=NULL,vip_price=NULL WHERE id=?
  `).run(submitted.body.id);
  assert.equal((await approveEvent(submitted.body.id)).status, 200);
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
  const order = await request(app).get(`/api/orders/${registration.body.orderId}`)
    .set(accountAuth).set('X-Order-Access', registration.body.accessToken);
  assert.equal(order.body.status, 'confirmed');
  assert.equal(order.body.amountKes, 0);
  assert.equal(order.body.tickets.length, 1);
  assert.match(order.body.tickets[0].qr, /^data:image\/png;base64,/);
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

  assert.equal((await request(app).post('/api/auth/account/logout').set(walletAuth)).status, 200);
  assert.equal((await request(app).get('/api/wallet').set(walletAuth)).status, 401);
});

test('email verification, password reset, and Google sign-in create separate account sessions', async () => {
  const config = await request(app).get('/api/auth/config');
  assert.equal(config.status, 200);
  assert.equal(config.body.emailAuthConfigured, true);

  const email = 'member@example.com';
  const register = await request(app).post('/api/auth/email/register').send({
    email: '  MEMBER@example.com ',
    displayName: 'Email Member',
    password: 'a-long-test-password-123'
  });
  assert.equal(register.status, 202);
  assert.equal((await request(app).post('/api/auth/email/login').send({
    email,
    password: 'a-long-test-password-123'
  })).status, 403);

  const verifyCode = emailCodes.get(`${email}:verify`);
  assert.equal((await request(app).post('/api/auth/email/verify').send({ email, code: '000000' })).status, 401);
  const verified = await request(app).post('/api/auth/email/verify').send({ email, code: verifyCode });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.account.displayName, 'Email Member');
  const originalSession = { Authorization: `Bearer ${verified.body.accessToken}` };
  assert.equal((await request(app).get('/api/auth/account').set(originalSession)).body.account.email, email);

  assert.equal((await request(app).post('/api/auth/email/forgot-password').send({ email })).status, 202);
  const reset = await request(app).post('/api/auth/email/reset-password').send({
    email,
    code: emailCodes.get(`${email}:reset`),
    password: 'another-long-password-456'
  });
  assert.equal(reset.status, 200);
  assert.equal((await request(app).get('/api/auth/account').set(originalSession)).status, 401);
  assert.equal((await request(app).post('/api/auth/email/login').send({
    email,
    password: 'another-long-password-456'
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

after(() => {
  db.close();
  fs.rmSync(path.join(__dirname, '..', '.test-uploads'), { recursive: true, force: true });
});
