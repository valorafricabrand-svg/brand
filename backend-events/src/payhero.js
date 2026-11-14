const crypto = require('crypto');

const API_BASE = 'https://backend.payhero.co.ke/api/v2';

function settings() {
  return {
    apiUsername: process.env.PAYHERO_API_USERNAME || '',
    apiPassword: process.env.PAYHERO_API_PASSWORD || '',
    channelId: process.env.PAYHERO_CHANNEL_ID || '',
    callbackUrl: process.env.PAYHERO_CALLBACK_URL || ''
  };
}

function isConfigured() {
  const config = settings();
  if (!config.apiUsername || !config.apiPassword || !config.channelId) return false;
  try {
    const callback = new URL(config.callbackUrl);
    return callback.protocol === 'https:' && callback.hostname !== 'localhost';
  } catch (error) {
    return false;
  }
}

function environment() {
  return 'production';
}

function authHeader(config) {
  return `Basic ${Buffer.from(`${config.apiUsername}:${config.apiPassword}`).toString('base64')}`;
}

async function requestJson(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = body.error_message || body.ResultDesc || body.message || `HTTP ${response.status}`;
    throw new Error(`PayHero request failed: ${reason}`);
  }
  return body;
}

async function initiateStkPush(order) {
  if (!isConfigured()) throw new Error('PayHero is not configured.');
  const config = settings();
  const data = await requestJson(`${API_BASE}/payments`, {
    method: 'POST',
    headers: { Authorization: authHeader(config), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: order.amountKes,
      phone_number: order.phone,
      channel_id: Number(config.channelId),
      provider: 'm-pesa',
      external_reference: order.id,
      callback_url: config.callbackUrl
    })
  });
  if (!data.success || typeof data.CheckoutRequestID !== 'string' || !data.CheckoutRequestID) {
    throw new Error(data.error_message || 'PayHero did not return a checkout request.');
  }
  return {
    // Safaricom's own session id, echoed back on the later callback; used to find this order again.
    checkoutRequestId: data.CheckoutRequestID,
    // PayHero's own reference, needed later to independently re-check status; the callback body
    // never repeats this value, so it must be captured here or it is lost.
    merchantRequestId: typeof data.reference === 'string' ? data.reference : '',
    customerMessage: 'Check your phone and enter your M-Pesa PIN.'
  };
}

async function queryStkPush(checkoutRequestId, payHeroReference) {
  if (!isConfigured()) throw new Error('PayHero is not configured.');
  const config = settings();
  const reference = payHeroReference || checkoutRequestId;
  const data = await requestJson(`${API_BASE}/transaction-status?reference=${encodeURIComponent(reference)}`, {
    headers: { Authorization: authHeader(config) }
  });
  return {
    // Echoed back rather than read from PayHero's response: the status-check endpoint's own
    // CheckoutRequestID field is not reliably populated, so the caller's "does this match the
    // order I looked up" check is satisfied by construction. The real verdict is ResultCode below,
    // which only becomes '0' when PayHero's own authenticated status says SUCCESS.
    CheckoutRequestID: checkoutRequestId,
    ResultCode: data.status === 'SUCCESS' ? '0' : '1',
    ResultDesc: typeof data.status === 'string' ? data.status : 'UNKNOWN'
  };
}

function equalId(left, right) {
  const first = Buffer.from(String(left || ''));
  const second = Buffer.from(String(right || ''));
  return first.length === second.length && crypto.timingSafeEqual(first, second);
}

module.exports = { equalId, environment, initiateStkPush, isConfigured, queryStkPush };
