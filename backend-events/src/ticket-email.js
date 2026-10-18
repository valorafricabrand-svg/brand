const QRCode = require('qrcode');
const db = require('./db');

function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatEventDate(value, timezone) {
  return new Intl.DateTimeFormat('en-KE', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: timezone
  }).format(new Date(value));
}

async function sendConfirmation(orderId, publicSiteUrl) {
  if (!isConfigured()) throw new Error('Ticket email delivery is not configured.');
  const order = db.prepare(`
    SELECT o.id,o.quantity,o.ticket_type AS ticketType,o.amount_kes AS amountKes,
      o.mpesa_receipt AS receipt,a.email,
      e.title AS eventTitle,e.starts_at AS startsAt,e.timezone,e.venue_name AS venueName,e.city
    FROM orders o
    JOIN accounts a ON a.id=o.account_id
    JOIN events e ON e.id=o.event_id
    WHERE o.id=? AND o.order_type='ticket' AND o.status IN ('paid','confirmed')
  `).get(orderId);
  if (!order) throw new Error('Paid ticket order or recipient was not found.');

  const tickets = db.prepare(`
    SELECT code FROM tickets WHERE order_id=? ORDER BY created_at,code
  `).all(orderId);
  if (tickets.length !== order.quantity) throw new Error('Ticket issuance is incomplete.');

  const baseUrl = publicSiteUrl.replace(/\/+$/, '');
  const eventName = escapeHtml(order.eventTitle);
  const when = escapeHtml(formatEventDate(order.startsAt, order.timezone));
  const timezone = escapeHtml(order.timezone);
  const location = escapeHtml([order.venueName, order.city].filter(Boolean).join(', '));
  const ticketType = escapeHtml(order.ticketType);
  const total = `KES ${Number(order.amountKes).toLocaleString('en-KE')}`;
  const attachments = await Promise.all(tickets.map(async (ticket, index) => ({
    filename: `valor-ticket-${index + 1}.png`,
    content: (await QRCode.toBuffer(
      `${baseUrl}/ticket.html?code=${encodeURIComponent(ticket.code)}`,
      { errorCorrectionLevel: 'M', margin: 2, width: 400 }
    )).toString('base64')
  })));
  const ticketLines = tickets.map((ticket, index) =>
    `Ticket ${index + 1}: ${baseUrl}/ticket.html?code=${encodeURIComponent(ticket.code)}`
  ).join('\n');
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17221e">
      <h1 style="color:#087f5b;font-size:24px">Your tickets are confirmed</h1>
      <p>Thanks for booking with Valor Africa. Your individual QR entry passes are attached.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:8px;color:#596a60">Event</td><td><strong>${eventName}</strong></td></tr>
        <tr><td style="padding:8px;color:#596a60">When</td><td>${when} (${timezone})</td></tr>
        <tr><td style="padding:8px;color:#596a60">Where</td><td>${location}</td></tr>
        <tr><td style="padding:8px;color:#596a60">Tickets</td><td>${ticketType} × ${order.quantity}</td></tr>
        <tr><td style="padding:8px;color:#596a60">Total</td><td>${total}</td></tr>
        ${order.receipt ? `<tr><td style="padding:8px;color:#596a60">M-Pesa receipt</td><td>${escapeHtml(order.receipt)}</td></tr>` : ''}
      </table>
      <p style="margin:24px 0">
        <a href="${baseUrl}/my-tickets.html" style="background:#087f5b;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">View my tickets</a>
      </p>
      <p style="font-size:13px;color:#596a60">Show the attached QR code at the gate. Each ticket code can be checked in once; do not share it publicly.</p>
      <p style="font-size:12px;color:#88938d">Order ${escapeHtml(order.id)}</p>
    </div>`;
  const text = [
    'Your tickets are confirmed',
    `Event: ${order.eventTitle}`,
    `When: ${formatEventDate(order.startsAt, order.timezone)} (${order.timezone})`,
    `Where: ${[order.venueName, order.city].filter(Boolean).join(', ')}`,
    `Tickets: ${order.ticketType} x ${order.quantity}`,
    `Total: ${total}`,
    `View your tickets: ${baseUrl}/my-tickets.html`,
    ticketLines,
    `Order ${order.id}`
  ].join('\n');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `valor-ticket-confirmation-${order.id}`
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL,
      to: [order.email],
      subject: `Your tickets for ${order.eventTitle}`,
      html,
      text,
      attachments
    }),
    signal: AbortSignal.timeout(12000)
  });
  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok || !responseBody.id) {
    throw new Error(responseBody.message || `Resend returned HTTP ${response.status}.`);
  }
}

module.exports = { isConfigured, sendConfirmation };
