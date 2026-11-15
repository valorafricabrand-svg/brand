function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
}

async function sendCode(email, code, purpose, context = {}) {
  if (!isConfigured()) throw new Error('Resend email delivery is not configured.');
  const subject = purpose === 'reset'
    ? 'Reset your Valor Africa password'
    : purpose === 'wallet_link'
      ? 'Confirm your Valor Wallet request'
      : 'Verify your Valor Africa email';
  const message = purpose === 'reset'
    ? `Your Valor Africa password reset code is ${code}. It expires in 10 minutes. If you did not request this, you can ignore this email.`
    : purpose === 'wallet_link'
      ? `Your Valor Africa code to link phone ${context.phone} to your wallet is ${code}. It expires in 10 minutes. If you did not request this, you can ignore this email and your wallet will remain unchanged.`
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
