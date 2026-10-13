const endpoints = {
  production: 'https://api.africastalking.com',
  sandbox: 'https://api.sandbox.africastalking.com'
};

function settings() {
  const environment = process.env.AT_ENV === 'production' ? 'production' : 'sandbox';
  return {
    baseUrl: endpoints[environment],
    username: process.env.AT_USERNAME || '',
    apiKey: process.env.AT_API_KEY || '',
    senderId: process.env.AT_SENDER_ID || ''
  };
}

function isConfigured() {
  const config = settings();
  return Boolean(config.username && config.apiKey);
}

async function sendOtp(phone, code) {
  if (!isConfigured()) throw new Error("Africa's Talking SMS is not configured.");
  const config = settings();
  const fields = new URLSearchParams({
    username: config.username,
    to: `+${phone}`,
    message: `Your Valor Africa wallet sign-in code is ${code}. It expires in 5 minutes.`
  });
  if (config.senderId) fields.set('from', config.senderId);
  const response = await fetch(`${config.baseUrl}/version1/messaging`, {
    method: 'POST',
    headers: {
      apiKey: config.apiKey,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: fields,
    signal: AbortSignal.timeout(12000)
  });
  const body = await response.json().catch(() => ({}));
  const recipients = body.SMSMessageData?.Recipients;
  if (!response.ok || !Array.isArray(recipients) || recipients.length === 0 ||
    recipients.some((recipient) => Number(recipient.statusCode) !== 101)) {
    throw new Error(body.SMSMessageData?.Message || `Africa's Talking returned HTTP ${response.status}.`);
  }
}

module.exports = { isConfigured, sendOtp };
