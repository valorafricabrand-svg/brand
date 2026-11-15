function settings() {
  const kesPerUsd = Number(process.env.PAYPAL_KES_PER_USD);
  return {
    environment: process.env.PAYPAL_ENV === 'production' ? 'production' : 'sandbox',
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
    webhookId: process.env.PAYPAL_WEBHOOK_ID || '',
    kesPerUsd: Number.isFinite(kesPerUsd) && kesPerUsd > 0 ? kesPerUsd : null
  };
}

function apiBase() {
  return settings().environment === 'production' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

function isConfigured() {
  const config = settings();
  return Boolean(config.clientId && config.clientSecret && config.webhookId && config.kesPerUsd);
}

function environment() {
  return settings().environment;
}

function kesPerUsdRate() {
  return settings().kesPerUsd;
}

function convertKesToUsd(amountKes) {
  const { kesPerUsd } = settings();
  if (!kesPerUsd) throw new Error('PayPal KES-to-USD exchange rate is not configured.');
  const amountUsd = Math.round((amountKes / kesPerUsd) * 100) / 100;
  if (!Number.isFinite(amountUsd) || amountUsd < 0.01) {
    throw new Error('This amount is below the minimum USD amount for PayPal.');
  }
  return amountUsd;
}

// Cached in-process: PayPal tokens are valid for hours, and re-requesting one on every
// call would needlessly burn into PayPal's rate limits under normal traffic.
let cachedToken = null;

async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30000) return cachedToken.token;
  const config = settings();
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  const response = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(12000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description || `PayPal did not return an access token (HTTP ${response.status}).`);
  }
  cachedToken = { token: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) || 300) * 1000 };
  return cachedToken.token;
}

async function requestJson(path, options) {
  const token = await accessToken();
  const response = await fetch(`${apiBase()}${path}`, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = (body.details && body.details[0] && body.details[0].description) || body.message || `HTTP ${response.status}`;
    throw new Error(`PayPal request failed: ${reason}`);
  }
  return body;
}

async function createOrder({ id, amountKes, description, returnUrl, cancelUrl }) {
  if (!isConfigured()) throw new Error('PayPal is not configured.');
  const amountUsd = convertKesToUsd(amountKes);
  const body = await requestJson('/v2/checkout/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'PayPal-Request-Id': `valor-${id}` },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        custom_id: id,
        description: String(description).slice(0, 127),
        amount: { currency_code: 'USD', value: amountUsd.toFixed(2) }
      }],
      application_context: {
        return_url: returnUrl,
        cancel_url: cancelUrl,
        user_action: 'PAY_NOW',
        shipping_preference: 'NO_SHIPPING'
      }
    })
  });
  const approveLink = Array.isArray(body.links) && body.links.find((link) => link.rel === 'approve');
  if (!body.id || !approveLink || !approveLink.href) throw new Error('PayPal did not return a valid order.');
  return { orderId: body.id, approveUrl: approveLink.href, amountUsd };
}

async function captureOrder(paypalOrderId) {
  if (!isConfigured()) throw new Error('PayPal is not configured.');
  const body = await requestJson(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'PayPal-Request-Id': `valor-capture-${paypalOrderId}` },
    body: JSON.stringify({})
  });
  const unit = Array.isArray(body.purchase_units) && body.purchase_units[0];
  const capture = unit && unit.payments && Array.isArray(unit.payments.captures) && unit.payments.captures[0];
  return {
    status: body.status,
    customId: unit && unit.custom_id,
    captureStatus: capture && capture.status,
    amountValue: capture && capture.amount && Number(capture.amount.value),
    amountCurrency: capture && capture.amount && capture.amount.currency_code
  };
}

// Verifies a webhook delivery against PayPal's own API (there is no local HMAC check for
// this API, unlike Stripe/NOWPayments): the already-parsed event is sent back to PayPal,
// so this takes req.body directly rather than a raw byte buffer.
async function verifyWebhookEvent(headers, event) {
  if (!isConfigured()) return null;
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  const config = settings();
  let result;
  try {
    result = await requestJson('/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_algo: headers['paypal-auth-algo'],
        cert_url: headers['paypal-cert-url'],
        transmission_id: headers['paypal-transmission-id'],
        transmission_sig: headers['paypal-transmission-sig'],
        transmission_time: headers['paypal-transmission-time'],
        webhook_id: config.webhookId,
        webhook_event: event
      })
    });
  } catch (error) {
    return null;
  }
  return result && result.verification_status === 'SUCCESS' ? event : null;
}

module.exports = { captureOrder, convertKesToUsd, createOrder, environment, isConfigured, kesPerUsdRate, verifyWebhookEvent };
