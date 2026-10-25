const assert = require('node:assert/strict');
const crypto = require('crypto');
const { test } = require('node:test');
const nowpayments = require('../src/nowpayments');

function restoreEnvironment(originals) {
  for (const [key, value] of Object.entries(originals)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test('NOWPayments invoices price KES ticket totals in configured USD and return a trusted HTTPS invoice', async () => {
  const keys = [
    'NOWPAYMENTS_API_KEY',
    'NOWPAYMENTS_IPN_SECRET',
    'NOWPAYMENTS_KES_PER_USD',
    'NOWPAYMENTS_IPN_CALLBACK_URL'
  ];
  const originals = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = global.fetch;
  let invoiceRequest;
  process.env.NOWPAYMENTS_API_KEY = 'test-api-key';
  process.env.NOWPAYMENTS_IPN_SECRET = 'test-ipn-secret';
  process.env.NOWPAYMENTS_KES_PER_USD = '130';
  process.env.NOWPAYMENTS_IPN_CALLBACK_URL = 'https://api.example.test/api/nowpayments/ipn';
  global.fetch = async (url, options) => {
    invoiceRequest = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      async json() {
        return { id: 12345, invoice_url: 'https://nowpayments.io/payment/?iid=12345' };
      }
    };
  };

  try {
    assert.equal(nowpayments.isConfigured(), true);
    const invoice = await nowpayments.createInvoice({
      id: 'ticket-order-123',
      amountKes: 1600,
      quantity: 2,
      ticketType: 'Regular',
      eventTitle: 'Test Event',
      eventSlug: 'test-event',
      publicSiteUrl: 'https://valorafrica.co.ke'
    });
    assert.equal(invoiceRequest.url, 'https://api.nowpayments.io/v1/invoice');
    assert.equal(invoiceRequest.options.headers['x-api-key'], 'test-api-key');
    assert.equal(invoiceRequest.body.price_amount, 12.31);
    assert.equal(invoiceRequest.body.price_currency, 'usd');
    assert.equal(invoiceRequest.body.order_id, 'ticket-order-123');
    assert.equal(invoiceRequest.body.ipn_callback_url, 'https://api.example.test/api/nowpayments/ipn');
    assert.equal(invoice.id, '12345');
    assert.equal(invoice.priceAmountUsd, 12.31);
  } finally {
    global.fetch = originalFetch;
    restoreEnvironment(originals);
  }
});

test('NOWPayments verifies the documented sorted JSON HMAC signature', () => {
  const original = process.env.NOWPAYMENTS_IPN_SECRET;
  process.env.NOWPAYMENTS_IPN_SECRET = 'test-ipn-secret';
  const payload = {
    payment_status: 'finished',
    nested: { z: 3, a: 1 },
    order_id: 'ticket-order-123'
  };
  const sortedPayload = {
    nested: { a: 1, z: 3 },
    order_id: 'ticket-order-123',
    payment_status: 'finished'
  };
  const signature = crypto.createHmac('sha512', process.env.NOWPAYMENTS_IPN_SECRET)
    .update(JSON.stringify(sortedPayload))
    .digest('hex');
  try {
    assert.equal(nowpayments.verifyIpn(payload, signature), true);
    assert.equal(nowpayments.verifyIpn(payload, 'a'.repeat(128)), false);
    assert.equal(nowpayments.verifyIpn(payload, 'invalid'), false);
  } finally {
    if (original === undefined) delete process.env.NOWPAYMENTS_IPN_SECRET;
    else process.env.NOWPAYMENTS_IPN_SECRET = original;
  }
});
