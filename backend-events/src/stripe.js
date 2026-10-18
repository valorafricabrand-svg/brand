const Stripe = require('stripe');

let stripeClient;
let stripeSecret;

function isConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
}

function client() {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error('Stripe is not configured.');
  if (!stripeClient || stripeSecret !== secret) {
    stripeClient = new Stripe(secret, { maxNetworkRetries: 2, timeout: 12000 });
    stripeSecret = secret;
  }
  return stripeClient;
}

async function createCheckoutSession(order) {
  if (!isConfigured()) throw new Error('Stripe is not configured.');
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 60;
  const baseUrl = order.publicSiteUrl.replace(/\/+$/, '');
  const session = await client().checkout.sessions.create({
    mode: 'payment',
    customer_email: order.customerEmail,
    client_reference_id: order.id,
    line_items: [{
      quantity: order.quantity,
      price_data: {
        currency: 'kes',
        unit_amount: order.unitAmountKes * 100,
        product_data: { name: `${order.eventTitle} - ${order.ticketType}` }
      }
    }],
    metadata: { orderId: order.id },
    expires_at: expiresAt,
    success_url: `${baseUrl}/order.html?orderId=${encodeURIComponent(order.id)}&payment=stripe&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/event.html?slug=${encodeURIComponent(order.eventSlug)}&checkout=cancelled`
  }, { idempotencyKey: `valor-ticket-${order.id}` });
  if (!session.id || !session.url) throw new Error('Stripe did not return a checkout URL.');
  return { id: session.id, url: session.url, expiresAt };
}

function constructWebhookEvent(payload, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('Stripe webhook signing secret is not configured.');
  return client().webhooks.constructEvent(payload, signature, secret);
}

module.exports = { constructWebhookEvent, createCheckoutSession, isConfigured };
