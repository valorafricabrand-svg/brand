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
const app = createApp({ mpesa: paymentGateway, publicSiteUrl: 'https://valorafrica.co.ke' });
const adminToken = login(process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD);
const admin = { Authorization: `Bearer ${adminToken}` };

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
  const response = await request(app).post('/api/orders/tickets')
    .send({ eventId: event.id, ticketType: 'Early bird', buyerName: 'Buyer', phone: '0712345678', quantity: 1 });
  assert.equal(response.status, 503);
  assert.equal(response.body.error.includes('Daraja'), true);
  paymentGateway.enabled = true;
});

test('paid ticket order issues only after Daraja verifies the callback', async () => {
  const event = db.prepare("SELECT id FROM events WHERE slug='test-live-festival'").get();
  const checkout = await request(app).post('/api/orders/tickets')
    .send({ eventId: event.id, ticketType: 'Early bird', buyerName: 'Buyer', phone: '0712345678', quantity: 2 });
  assert.equal(checkout.status, 201);
  const order = await request(app).get(`/api/orders/${checkout.body.orderId}`)
    .set('X-Order-Access', checkout.body.accessToken);
  assert.equal(order.body.status, 'pending');

  const verified = await completePayment('checkout-1', 'merchant-1', 1600, 'TEST123456');
  assert.equal(verified.status, 200);
  const paid = await request(app).get(`/api/orders/${checkout.body.orderId}`)
    .set('X-Order-Access', checkout.body.accessToken);
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
  const checkout = await request(app).post('/api/orders/tickets')
    .send({ eventId: event.id, ticketType: 'Early bird', buyerName: 'Buyer', phone: '0712345678', quantity: 1 });
  paymentGateway.queryStkPush = async (checkoutRequestId) => ({
    CheckoutRequestID: checkoutRequestId,
    ResultCode: '1032',
    ResultDesc: 'The transaction has not succeeded'
  });
  await completePayment('checkout-2', 'merchant-2', 800, 'FORGED1');
  const unpaid = await request(app).get(`/api/orders/${checkout.body.orderId}`)
    .set('X-Order-Access', checkout.body.accessToken);
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
  const ticket = await request(app).post('/api/orders/tickets').send({
    eventId: submitted.body.id,
    ticketType: 'Early bird',
    buyerName: 'Ticket Buyer',
    phone: '0712345678',
    quantity: 1
  });
  assert.equal(ticket.status, 201);
});

test('free registrations issue admission tickets without requiring M-Pesa', async () => {
  const submitted = await submitEvent('Free Ticket Registration');
  assert.equal(submitted.status, 202);
  db.prepare(`
    UPDATE events SET capacity=2,regular_price=0,early_bird_price=NULL,
      early_bird_ends=NULL,vip_price=NULL WHERE id=?
  `).run(submitted.body.id);
  assert.equal((await approveEvent(submitted.body.id)).status, 200);
  paymentGateway.enabled = false;
  const registration = await request(app).post('/api/orders/tickets').send({
    eventId: submitted.body.id,
    ticketType: 'Regular',
    buyerName: 'Free Ticket Buyer',
    phone: '0712345678',
    quantity: 1
  });
  assert.equal(registration.status, 201);
  assert.equal(registration.body.status, 'confirmed');
  const order = await request(app).get(`/api/orders/${registration.body.orderId}`)
    .set('X-Order-Access', registration.body.accessToken);
  assert.equal(order.body.status, 'confirmed');
  assert.equal(order.body.amountKes, 0);
  assert.equal(order.body.tickets.length, 1);
  assert.match(order.body.tickets[0].qr, /^data:image\/png;base64,/);
  const verification = await request(app).get(`/api/tickets/${order.body.tickets[0].code}/verify`);
  assert.equal(verification.body.valid, true);
  paymentGateway.enabled = true;
});

after(() => {
  db.close();
  fs.rmSync(path.join(__dirname, '..', '.test-uploads'), { recursive: true, force: true });
});
