function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
}

async function sendCode(email, code, purpose) {
  if (!isConfigured()) throw new Error('Resend email delivery is not configured.');
  const isReset = purpose === 'reset';
  const subject = isReset ? 'Reset your Valor Africa password' : 'Verify your Valor Africa email';
  const message = isReset
    ? `Your Valor Africa password reset code is ${code}. It expires in 10 minutes. If you did not request this, you can ignore this email.`
    : `Your Valor Africa verification code is ${code}. It expires in 10 minutes.`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL,
      to: [email],
      subject,
      text: message
    }),
    signal: AbortSignal.timeout(12000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.id) {
    throw new Error(body.message || `Resend returned HTTP ${response.status}.`);
  }
}

module.exports = { isConfigured, sendCode };
