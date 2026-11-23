const { emailBrandHeader } = require('./email-brand');

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

function daysLabel(daysRemaining) {
  if (daysRemaining <= 0) return 'today';
  if (daysRemaining === 1) return 'tomorrow';
  return `in ${daysRemaining} days`;
}

async function sendEmail({ idempotencyKey, to, subject, html, text }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL, to: [to], subject, html, text }),
    signal: AbortSignal.timeout(12000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.id) {
    throw new Error(body.message || `Resend returned HTTP ${response.status}.`);
  }
}

async function sendTicketCountdown({
  idempotencyKey, email, displayName, eventTitle, eventSlug, startsAt, timezone,
  venueName, city, ticketCount, daysRemaining, publicSiteUrl
}) {
  if (!isConfigured()) throw new Error('Reminder email delivery is not configured.');
  const baseUrl = publicSiteUrl.replace(/\/+$/, '');
  const name = escapeHtml(eventTitle);
  const when = escapeHtml(formatEventDate(startsAt, timezone));
  const location = escapeHtml([venueName, city].filter(Boolean).join(', '));
  const eventUrl = `${baseUrl}/event.html?slug=${encodeURIComponent(eventSlug)}`;
  const greeting = displayName ? `Hi ${escapeHtml(displayName)},` : 'Hi there,';
  const label = daysLabel(daysRemaining);
  const subject = daysRemaining <= 0
    ? `Today: ${eventTitle}`
    : daysRemaining === 1
      ? `Tomorrow: ${eventTitle}`
      : `${daysRemaining} days until ${eventTitle}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17221e">
      ${emailBrandHeader()}
      <h1 style="color:#087f5b;font-size:24px">Your event is ${label}</h1>
      <p>${greeting} just a reminder that your tickets for <strong>${name}</strong> are coming up ${label}.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:8px;color:#596a60">Event</td><td><strong>${name}</strong></td></tr>
        <tr><td style="padding:8px;color:#596a60">When</td><td>${when}</td></tr>
        <tr><td style="padding:8px;color:#596a60">Where</td><td>${location}</td></tr>
        <tr><td style="padding:8px;color:#596a60">Tickets</td><td>${ticketCount}</td></tr>
      </table>
      <p style="margin:24px 0">
        <a href="${baseUrl}/my-tickets.html" style="background:#087f5b;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">View my tickets</a>
      </p>
      <p style="font-size:13px;color:#596a60">See you there! <a href="${eventUrl}" style="color:#087f5b">Event details</a></p>
    </div>`;
  const text = [
    `Your event is ${label}`,
    `Event: ${eventTitle}`,
    `When: ${formatEventDate(startsAt, timezone)}`,
    `Where: ${[venueName, city].filter(Boolean).join(', ')}`,
    `Tickets: ${ticketCount}`,
    `View your tickets: ${baseUrl}/my-tickets.html`
  ].join('\n');
  await sendEmail({ idempotencyKey, to: email, subject, html, text });
}

async function sendViewReminder({
  idempotencyKey, email, displayName, eventTitle, eventSlug, startsAt, timezone,
  venueName, city, daysRemaining, publicSiteUrl, unsubscribeUrl
}) {
  if (!isConfigured()) throw new Error('Reminder email delivery is not configured.');
  const baseUrl = publicSiteUrl.replace(/\/+$/, '');
  const name = escapeHtml(eventTitle);
  const when = escapeHtml(formatEventDate(startsAt, timezone));
  const location = escapeHtml([venueName, city].filter(Boolean).join(', '));
  const eventUrl = `${baseUrl}/event.html?slug=${encodeURIComponent(eventSlug)}`;
  const greeting = displayName ? `Hi ${escapeHtml(displayName)},` : 'Hi there,';
  const label = daysLabel(daysRemaining);
  const subject = `Still interested in ${eventTitle}?`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17221e">
      ${emailBrandHeader()}
      <h1 style="color:#087f5b;font-size:24px">Still thinking about it?</h1>
      <p>${greeting} you checked out <strong>${name}</strong> on Valor Africa. It's happening ${label} — tickets are still available.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:8px;color:#596a60">Event</td><td><strong>${name}</strong></td></tr>
        <tr><td style="padding:8px;color:#596a60">When</td><td>${when}</td></tr>
        <tr><td style="padding:8px;color:#596a60">Where</td><td>${location}</td></tr>
      </table>
      <p style="margin:24px 0">
        <a href="${eventUrl}" style="background:#087f5b;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Get tickets</a>
      </p>
      <p style="font-size:12px;color:#88938d;margin-top:32px;border-top:1px solid #e7ece9;padding-top:12px">
        You're receiving this because you viewed this event while signed in to Valor Africa.
        <a href="${unsubscribeUrl}" style="color:#596a60">Unsubscribe from these emails</a>.
      </p>
    </div>`;
  const text = [
    'Still thinking about it?',
    `Event: ${eventTitle}`,
    `When: ${formatEventDate(startsAt, timezone)}`,
    `Where: ${[venueName, city].filter(Boolean).join(', ')}`,
    `Get tickets: ${eventUrl}`,
    `Unsubscribe from these emails: ${unsubscribeUrl}`
  ].join('\n');
  await sendEmail({ idempotencyKey, to: email, subject, html, text });
}

module.exports = { isConfigured, sendTicketCountdown, sendViewReminder };
