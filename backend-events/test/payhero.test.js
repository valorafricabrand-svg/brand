const assert = require('node:assert/strict');
const { test } = require('node:test');
const payhero = require('../src/payhero');

async function withPayHeroEnv(overrides, run) {
  const keys = ['PAYHERO_API_USERNAME', 'PAYHERO_API_PASSWORD', 'PAYHERO_CHANNEL_ID', 'PAYHERO_CALLBACK_URL'];
  const originals = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const defaults = {
    PAYHERO_API_USERNAME: 'test-username',
    PAYHERO_API_PASSWORD: 'test-password',
    PAYHERO_CHANNEL_ID: '133',
    PAYHERO_CALLBACK_URL: 'https://example.test/api/payhero/callback'
  };
  Object.assign(process.env, defaults, overrides);
  try {
    return await run();
  } finally {
    for (const key of keys) {
      if (originals[key] === undefined) delete process.env[key];
      else process.env[key] = originals[key];
    }
  }
}

test('PayHero is not configured without full credentials or an HTTPS callback URL', async () => {
  await withPayHeroEnv({ PAYHERO_API_USERNAME: '' }, () => {
    assert.equal(payhero.isConfigured(), false);
  });
  await withPayHeroEnv({ PAYHERO_CALLBACK_URL: 'http://localhost/api/payhero/callback' }, () => {
    assert.equal(payhero.isConfigured(), false);
  });
  await withPayHeroEnv({ PAYHERO_CALLBACK_URL: 'https://localhost/api/payhero/callback' }, () => {
    assert.equal(payhero.isConfigured(), false);
  });
  await withPayHeroEnv({}, () => {
    assert.equal(payhero.isConfigured(), true);
  });
});

test('PayHero STK push sends Basic auth built from the API username and password, and a whole-shilling amount', async () => {
  await withPayHeroEnv({}, async () => {
    const originalFetch = global.fetch;
    const requests = [];
    global.fetch = async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        async json() {
          return { success: true, status: 'QUEUED', reference: 'E8UWT7CLUW', CheckoutRequestID: 'ws_CO_test123' };
        }
      };
    };
    try {
      const result = await payhero.initiateStkPush({
        id: 'order-1234',
        amountKes: 1500,
        phone: '254712345678',
        orderType: 'ticket'
      });
      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, 'https://backend.payhero.co.ke/api/v2/payments');
      assert.equal(
        requests[0].options.headers.Authorization,
        `Basic ${Buffer.from('test-username:test-password').toString('base64')}`
      );
      const body = JSON.parse(requests[0].options.body);
      assert.equal(body.amount, 1500);
      assert.equal(body.phone_number, '254712345678');
      assert.equal(body.channel_id, 133);
      assert.equal(body.provider, 'm-pesa');
      assert.equal(body.external_reference, 'order-1234');
      assert.equal(body.callback_url, 'https://example.test/api/payhero/callback');
      assert.equal(result.checkoutRequestId, 'ws_CO_test123');
      assert.equal(result.merchantRequestId, 'E8UWT7CLUW');
      assert.match(result.customerMessage, /M-Pesa PIN/i);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test('PayHero STK push rejects a response that is not success with a CheckoutRequestID', async () => {
  await withPayHeroEnv({}, async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: true, async json() { return { success: false, error_message: 'Insufficient balance.' }; } });
    try {
      await assert.rejects(
        payhero.initiateStkPush({ id: 'order-1', amountKes: 100, phone: '254712345678', orderType: 'ticket' }),
        /Insufficient balance/
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test('PayHero status check maps SUCCESS to ResultCode 0 and anything else to a non-zero code, always echoing the requested CheckoutRequestID', async () => {
  await withPayHeroEnv({}, async () => {
    const originalFetch = global.fetch;
    const requests = [];
    global.fetch = async (url, options) => {
      requests.push({ url, options });
      const status = url.includes('reference=good-ref') ? 'SUCCESS' : 'FAILED';
      return { ok: true, async json() { return { status, reference: 'good-ref' }; } };
    };
    try {
      const success = await payhero.queryStkPush('ws_CO_abc', 'good-ref');
      assert.equal(success.CheckoutRequestID, 'ws_CO_abc');
      assert.equal(success.ResultCode, '0');
      assert.ok(requests[0].url.includes('reference=good-ref'));
      assert.equal(
        requests[0].options.headers.Authorization,
        `Basic ${Buffer.from('test-username:test-password').toString('base64')}`
      );

      const failure = await payhero.queryStkPush('ws_CO_xyz', 'bad-ref');
      assert.equal(failure.CheckoutRequestID, 'ws_CO_xyz');
      assert.equal(failure.ResultCode, '1');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test('PayHero status check falls back to the CheckoutRequestID when no PayHero reference was stored', async () => {
  await withPayHeroEnv({}, async () => {
    const originalFetch = global.fetch;
    const requests = [];
    global.fetch = async (url) => {
      requests.push(url);
      return { ok: true, async json() { return { status: 'SUCCESS' }; } };
    };
    try {
      await payhero.queryStkPush('ws_CO_only', '');
      assert.ok(requests[0].includes('reference=ws_CO_only'));
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test('PayHero requests throw when the gateway is not configured', async () => {
  await withPayHeroEnv({ PAYHERO_API_USERNAME: '' }, async () => {
    await assert.rejects(
      payhero.initiateStkPush({ id: 'order-1', amountKes: 100, phone: '254712345678', orderType: 'ticket' }),
      /not configured/
    );
    await assert.rejects(payhero.queryStkPush('ws_CO_abc', 'ref'), /not configured/);
  });
});
