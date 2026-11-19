const braintree = require('braintree');

let gatewayInstance = null;
let gatewaySignature = '';

function settings() {
  const kesPerUsd = Number(process.env.BRAINTREE_KES_PER_USD);
  return {
    environment: process.env.BRAINTREE_ENV === 'production' ? 'production' : 'sandbox',
    merchantId: process.env.BRAINTREE_MERCHANT_ID || '',
    publicKey: process.env.BRAINTREE_PUBLIC_KEY || '',
    privateKey: process.env.BRAINTREE_PRIVATE_KEY || '',
    merchantAccountId: process.env.BRAINTREE_MERCHANT_ACCOUNT_ID || '',
    googleMerchantId: process.env.BRAINTREE_GOOGLE_MERCHANT_ID || '',
    applePayEnabled: process.env.BRAINTREE_APPLE_PAY_ENABLED === 'true',
    kesPerUsd: Number.isFinite(kesPerUsd) && kesPerUsd > 0 ? kesPerUsd : null
  };
}

function hasPaymentConfiguration(config = settings()) {
  return Boolean(
    config.merchantId &&
    config.publicKey &&
    config.privateKey &&
    config.kesPerUsd
  );
}

function isConfigured() {
  const config = settings();
  return hasPaymentConfiguration(config) &&
    (config.environment !== 'production' || Boolean(config.googleMerchantId));
}

function isApplePayConfigured() {
  const config = settings();
  return hasPaymentConfiguration(config) && config.applePayEnabled;
}

function environment() {
  return settings().environment === 'production' ? 'PRODUCTION' : 'TEST';
}

function kesPerUsdRate() {
  return settings().kesPerUsd;
}

function googleMerchantId() {
  return settings().googleMerchantId || null;
}

function convertKesToUsd(amountKes) {
  const { kesPerUsd } = settings();
  if (!kesPerUsd) throw new Error('Braintree KES-to-USD exchange rate is not configured.');
  if (!Number.isSafeInteger(amountKes) || amountKes <= 0) {
    throw new Error('Braintree requires a positive whole-shilling order amount.');
  }
  const amountUsd = Math.round((amountKes / kesPerUsd) * 100) / 100;
  if (!Number.isFinite(amountUsd) || amountUsd < 0.01) {
    throw new Error('This amount is below the minimum USD amount for Braintree checkout.');
  }
  return amountUsd;
}

function gateway() {
  const config = settings();
  if (!config.merchantId || !config.publicKey || !config.privateKey) {
    throw new Error('Braintree credentials are not configured.');
  }
  const signature = [
    config.environment,
    config.merchantId,
    config.publicKey,
    config.privateKey
  ].join(':');
  if (!gatewayInstance || gatewaySignature !== signature) {
    gatewayInstance = new braintree.BraintreeGateway({
      environment: config.environment === 'production'
        ? braintree.Environment.Production
        : braintree.Environment.Sandbox,
      merchantId: config.merchantId,
      publicKey: config.publicKey,
      privateKey: config.privateKey
    });
    gatewaySignature = signature;
  }
  return gatewayInstance;
}

function callGateway(method) {
  return new Promise((resolve, reject) => {
    try {
      method((error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function generateClientToken() {
  if (!hasPaymentConfiguration()) throw new Error('Braintree is not configured.');
  const config = settings();
  const options = config.merchantAccountId
    ? { merchantAccountId: config.merchantAccountId }
    : {};
  const result = await callGateway((callback) => gateway().clientToken.generate(options, callback));
  if (!result || typeof result.clientToken !== 'string' || !result.clientToken) {
    throw new Error('Braintree did not return a client token.');
  }
  return result.clientToken;
}

async function createTransaction({ nonce, amountUsd, orderId, deviceData, postalCode }) {
  if (!hasPaymentConfiguration()) throw new Error('Braintree is not configured.');
  if (typeof nonce !== 'string' || nonce.length < 1 || nonce.length > 4096) {
    throw new Error('A valid Braintree payment nonce is required.');
  }
  if (!Number.isFinite(amountUsd) || amountUsd < 0.01) {
    throw new Error('A valid Braintree transaction amount is required.');
  }
  if (typeof orderId !== 'string' || !orderId || orderId.length > 100) {
    throw new Error('A valid ticket order ID is required.');
  }
  const config = settings();
  const saleRequest = {
    amount: amountUsd.toFixed(2),
    paymentMethodNonce: nonce,
    orderId,
    options: { submitForSettlement: true }
  };
  if (config.merchantAccountId) saleRequest.merchantAccountId = config.merchantAccountId;
  if (typeof deviceData === 'string' && deviceData.length <= 20000) {
    saleRequest.deviceData = deviceData;
  }
  if (typeof postalCode === 'string' && postalCode.length <= 32) {
    saleRequest.billing = { postalCode };
  }

  const result = await callGateway((callback) => gateway().transaction.sale(saleRequest, callback));
  const transaction = result && result.transaction;
  return {
    success: Boolean(result && result.success),
    transactionId: transaction && typeof transaction.id === 'string' ? transaction.id : null,
    status: transaction && transaction.status || null,
    amountUsd: transaction && Number(transaction.amount)
  };
}

module.exports = {
  convertKesToUsd,
  createTransaction,
  environment,
  generateClientToken,
  googleMerchantId,
  isApplePayConfigured,
  isConfigured,
  kesPerUsdRate
};
