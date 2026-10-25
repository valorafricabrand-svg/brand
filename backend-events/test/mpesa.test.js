const assert = require('node:assert/strict');
const { test } = require('node:test');
const mpesa = require('../src/mpesa');

test('M-Pesa STK Push requests a Buy Goods Till payment', async () => {
  const originalEnvironment = process.env.MPESA_ENV;
  const originalConsumerKey = process.env.MPESA_CONSUMER_KEY;
  const originalConsumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const originalShortcode = process.env.MPESA_SHORTCODE;
  const originalPasskey = process.env.MPESA_PASSKEY;
  const originalCallbackUrl = process.env.MPESA_CALLBACK_URL;
  const originalFetch = global.fetch;
  const requests = [];

  process.env.MPESA_ENV = 'production';
  process.env.MPESA_CONSUMER_KEY = 'test-consumer-key';
  process.env.MPESA_CONSUMER_SECRET = 'test-consumer-secret';
  process.env.MPESA_SHORTCODE = '123456';
  process.env.MPESA_PASSKEY = 'test-passkey';
  process.env.MPESA_CALLBACK_URL = 'https://example.test/api/mpesa/callback';
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      async json() {
        return requests.length === 1
          ? { access_token: 'test-access-token' }
          : {
              CheckoutRequestID: 'ws_CO_test',
              MerchantRequestID: 'merchant_test',
              CustomerMessage: 'Check your phone.'
            };
      }
    };
  };

  try {
    await mpesa.initiateStkPush({
      id: '12345678-1234-1234-1234-123456789012',
      amountKes: 100,
      phone: '254712345678',
      orderType: 'ticket'
    });

    const requestPayload = JSON.parse(requests[1].options.body);
    assert.equal(requests[1].url, 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest');
    assert.equal(requestPayload.TransactionType, 'CustomerBuyGoodsOnline');
    assert.equal(requestPayload.BusinessShortCode, '123456');
    assert.equal(requestPayload.PartyB, '123456');
  } finally {
    global.fetch = originalFetch;
    for (const [key, original] of [
      ['MPESA_ENV', originalEnvironment],
      ['MPESA_CONSUMER_KEY', originalConsumerKey],
      ['MPESA_CONSUMER_SECRET', originalConsumerSecret],
      ['MPESA_SHORTCODE', originalShortcode],
      ['MPESA_PASSKEY', originalPasskey],
      ['MPESA_CALLBACK_URL', originalCallbackUrl]
    ]) {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
  }
});
