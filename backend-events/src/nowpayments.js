const crypto = require('crypto');

function settings() {
  const kesPerUsd = Number(process.env.NOWPAYMENTS_KES_PER_USD);
  const callbackUrl = process.env.NOWPAYMENTS_IPN_CALLBACK_URL || '';
  return {
    apiKey: process.env.NOWPAYMENTS_API_KEY || '',
    ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET || '',
    kesPerUsd: Number.isFinite(kesPerUsd) && kesPerUsd > 0 ? kesPerUsd : null,
    callbackUrl
  };
}

function isConfigured() {
  const config = settings();
  if (!config.apiKey || !config.ipnSecret || !config.kesPerUsd) return false;
  try {
    const callback = new URL(config.callbackUrl);
    return callback.protocol === 'https:' && callback.hostname !== 'localhost';
  } catch (error) {
    return false;
  }
}

function kesPerUsdRate() {
  return settings().kesPerUsd;
}

function convertKesToUsd(amountKes) {
  const { kesPerUsd } = settings();
  if (!kesPerUsd) throw new Error('NOWPayments KES-to-USD exchange rate is not configured.');
  const amountUsd = Math.round((amountKes / kesPerUsd) * 100) / 100;
  if (!Number.isFinite(amountUsd) || amountUsd < 0.01) {
    throw new Error('This ticket total is below the minimum USD amount for NOWPayments.');
  }
  return amountUsd;
}

async function createInvoice(order) {
  if (!isConfigured()) throw new Error('NOWPayments is not configured.');
  const config = settings();
  const priceAmountUsd = convertKesToUsd(order.amountKes);
  const baseUrl = order.publicSiteUrl.replace(/\/+$/, '');
  const response = await fetch('https://api.nowpayments.io/v1/invoice', {
    method: 'POST',
    headers: {
      'x-api-key': config.apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      price_amount: priceAmountUsd,
      price_currency: 'usd',
      order_id: order.id,
      order_description: `${order.eventTitle} - ${order.ticketType} x ${order.quantity}`.slice(0, 255),
      ipn_callback_url: config.callbackUrl,
      success_url: `${baseUrl}/order.html?orderId=${encodeURIComponent(order.id)}&payment=nowpayments`,
      cancel_url: `${baseUrl}/event.html?slug=${encodeURIComponent(order.eventSlug)}&checkout=cancelled`,
      is_fixed_rate: true,
      is_fee_paid_by_user: false
    }),
    signal: AbortSignal.timeout(12000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message || body.error || `NOWPayments returned HTTP ${response.status}.`);
  }
  let invoiceUrl;
  try {
    invoiceUrl = new URL(body.invoice_url);
  } catch (error) {
    throw new Error('NOWPayments did not return a valid invoice URL.');
  }
  if (!['string','number'].includes(typeof body.id) || invoiceUrl.protocol !== 'https:') {
    throw new Error('NOWPayments did not return a valid invoice.');
  }
  return { id: String(body.id), url: invoiceUrl.href, priceAmountUsd };
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((sorted, key) => {
    sorted[key] = sortObject(value[key]);
    return sorted;
  }, {});
}

function verifyIpn(payload, signature) {
  const { ipnSecret } = settings();
  if (!ipnSecret || typeof signature !== 'string' || !/^[a-f0-9]{128}$/i.test(signature)) return false;
  const expected = crypto.createHmac('sha512', ipnSecret)
    .update(JSON.stringify(sortObject(payload)))
    .digest();
  const supplied = Buffer.from(signature, 'hex');
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

module.exports = { convertKesToUsd, createInvoice, isConfigured, kesPerUsdRate, verifyIpn };
