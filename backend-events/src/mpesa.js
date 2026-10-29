const crypto = require('crypto');

function settings() {
  const environment = process.env.MPESA_ENV === 'production' ? 'production' : 'sandbox';
  return {
    environment,
    baseUrl: environment === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke',
    consumerKey: process.env.MPESA_CONSUMER_KEY || '',
    consumerSecret: process.env.MPESA_CONSUMER_SECRET || '',
    shortcode: process.env.MPESA_SHORTCODE || '',
    passkey: process.env.MPESA_PASSKEY || '',
    callbackUrl: process.env.MPESA_CALLBACK_URL || '',
    accountReference: (process.env.MPESA_ACCOUNT_REFERENCE || 'ValorAfrica').slice(0, 12)
  };
}

function isConfigured() {
  const config = settings();
  if (!config.consumerKey || !config.consumerSecret || !config.shortcode || !config.passkey) return false;
  try {
    const callback = new URL(config.callbackUrl);
    return callback.protocol === 'https:' && callback.hostname !== 'localhost';
  } catch (error) {
    return false;
  }
}

function environment() {
  return settings().environment;
}

async function requestJson(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = body.errorMessage || body.error || body.ResponseDescription || `HTTP ${response.status}`;
    throw new Error(`M-Pesa request failed: ${reason}`);
  }
  return body;
}

async function accessToken(config) {
  const credentials = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
  const data = await requestJson(
    `${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${credentials}`, Accept: 'application/json' } }
  );
  if (!data.access_token) throw new Error('M-Pesa did not return an access token.');
  return data.access_token;
}

function timestampNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}${values.hour}${values.minute}${values.second}`;
}

function password(config, timestamp) {
  return Buffer.from(`${config.shortcode}${config.passkey}${timestamp}`).toString('base64');
}

async function initiateStkPush(order) {
  if (!isConfigured()) throw new Error('M-Pesa Daraja is not configured.');
  const config = settings();
  const token = await accessToken(config);
  const timestamp = timestampNow();
  const data = await requestJson(`${config.baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: config.shortcode,
      Password: password(config, timestamp),
      Timestamp: timestamp,
      TransactionType: 'CustomerBuyGoodsOnline',
      Amount: order.amountKes,
      PartyA: order.phone,
      PartyB: config.shortcode,
      PhoneNumber: order.phone,
      CallBackURL: config.callbackUrl,
      AccountReference: order.id.slice(0, 12),
      TransactionDesc: order.orderType === 'ticket'
        ? 'Valor event tickets'
        : order.orderType === 'wallet' ? 'Valor wallet deposit'
          : order.orderType === 'gift_card' ? 'Valor gift card'
            : order.orderType === 'merchant_voucher' ? 'Valor merchant voucher'
              : 'Valor event promotion'
    })
  });
  if (!data.CheckoutRequestID || !data.MerchantRequestID) {
    throw new Error(data.ResponseDescription || 'M-Pesa did not return a checkout request.');
  }
  return {
    checkoutRequestId: data.CheckoutRequestID,
    merchantRequestId: data.MerchantRequestID,
    customerMessage: data.CustomerMessage || 'Check your phone and enter your M-Pesa PIN.'
  };
}

async function queryStkPush(checkoutRequestId) {
  if (!isConfigured()) throw new Error('M-Pesa Daraja is not configured.');
  const config = settings();
  const token = await accessToken(config);
  const timestamp = timestampNow();
  return requestJson(`${config.baseUrl}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: config.shortcode,
      Password: password(config, timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId
    })
  });
}

function equalId(left, right) {
  const first = Buffer.from(String(left || ''));
  const second = Buffer.from(String(right || ''));
  return first.length === second.length && crypto.timingSafeEqual(first, second);
}

module.exports = { equalId, environment, initiateStkPush, isConfigured, queryStkPush };
