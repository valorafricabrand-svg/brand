const assert = require('node:assert/strict');
const { test } = require('node:test');
const { sendCode } = require('../src/account-email');
const { sendTicketCountdown } = require('../src/reminder-email');

async function captureEmail(t, send) {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFromEmail = process.env.RESEND_FROM_EMAIL;
  let payload;
  process.env.RESEND_API_KEY = 'test-key';
  process.env.RESEND_FROM_EMAIL = 'events@example.test';
  global.fetch = async (url, options) => {
    payload = JSON.parse(options.body);
    return { ok: true, json: async () => ({ id: 'test-email-id' }) };
  };
  t.after(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalApiKey;
    if (originalFromEmail === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = originalFromEmail;
  });
  await send();
  return payload;
}

test('account emails include the logo and keep their plain-text content', async (t) => {
  const email = await captureEmail(t, () => sendCode('buyer@example.test', '482913', 'wallet_link', {
    phone: '+254 <123>'
  }));
  assert.match(email.html, /src="https:\/\/valorafrica\.co\.ke\/images\/valor-africa-logo-light\.png"/);
  assert.match(email.html, /&lt;123&gt;/);
  assert.match(email.text, /482913/);
  assert.match(email.text, /<123>/);
});

test('ticket reminders include the logo while retaining ticket links in plain text', async (t) => {
  const email = await captureEmail(t, () => sendTicketCountdown({
    idempotencyKey: 'test-reminder',
    email: 'buyer@example.test',
    eventTitle: 'Sample event',
    eventSlug: 'sample-event',
    startsAt: '2026-07-01T10:00:00.000Z',
    timezone: 'Africa/Nairobi',
    venueName: 'Sample venue',
    city: 'Nairobi',
    ticketCount: 2,
    daysRemaining: 1,
    publicSiteUrl: 'https://valorafrica.co.ke'
  }));
  assert.match(email.html, /images\/valor-africa-logo-light\.png/);
  assert.match(email.text, /View your tickets: https:\/\/valorafrica\.co\.ke\/my-tickets\.html/);
});
