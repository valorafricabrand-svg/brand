(() => {
  let state = null;
  let initialization = null;

  function loadScript(id, src, isReady) {
    if (isReady()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let script = document.getElementById(id);
      if (!script) {
        script = document.createElement('script');
        script.id = id;
        script.src = src;
        script.async = true;
      }
      script.addEventListener('load', () => {
        if (isReady()) resolve();
        else reject(new Error('The Apple Pay payment library did not load correctly.'));
      }, { once: true });
      script.addEventListener('error', () => reject(new Error('The Apple Pay payment library could not be loaded.')), { once: true });
      if (!script.isConnected) document.head.appendChild(script);
    });
  }

  function isSupported() {
    const ApplePaySession = window.ApplePaySession;
    if (!ApplePaySession ||
        typeof ApplePaySession.supportsVersion !== 'function' ||
        typeof ApplePaySession.canMakePayments !== 'function') return false;
    try {
      return ApplePaySession.supportsVersion(3) && ApplePaySession.canMakePayments();
    } catch (error) {
      return false;
    }
  }

  async function prepare({ api, accountToken }) {
    if (!isSupported()) throw new Error('Apple Pay requires Safari on a compatible Apple device.');
    if (state && state.accountToken === accountToken) return state;
    if (initialization) return initialization;
    if (!accountToken) throw new Error('Sign in before using Apple Pay.');
    initialization = (async () => {
      const credentials = await api('/api/payments/applepay/client-token', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accountToken}` }
      });
      if (!credentials || typeof credentials.clientToken !== 'string' ||
          !['TEST','PRODUCTION'].includes(credentials.environment)) {
        throw new Error('Apple Pay is not configured for this checkout.');
      }
      await loadScript(
        'valor-braintree-client',
        'https://js.braintreegateway.com/web/3.147.0/js/client.min.js',
        () => Boolean(window.braintree && window.braintree.client)
      );
      await Promise.all([
        loadScript(
          'valor-braintree-apple-pay',
          'https://js.braintreegateway.com/web/3.147.0/js/apple-pay.min.js',
          () => Boolean(window.braintree && window.braintree.applePay)
        ),
        loadScript(
          'valor-braintree-data-collector',
          'https://js.braintreegateway.com/web/3.147.0/js/data-collector.min.js',
          () => Boolean(window.braintree && window.braintree.dataCollector)
        )
      ]);
      const client = await window.braintree.client.create({ authorization: credentials.clientToken });
      const [applePay, dataCollector] = await Promise.all([
        window.braintree.applePay.create({ client }),
        window.braintree.dataCollector.create({ client })
      ]);
      state = { accountToken, applePay, dataCollector };
      return state;
    })();
    try {
      return await initialization;
    } finally {
      initialization = null;
    }
  }

  function mountButton(container, onClick) {
    if (!state) throw new Error('Apple Pay has not been initialized.');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'apple-pay-button';
    button.setAttribute('aria-label', 'Buy with Apple Pay');
    button.addEventListener('click', onClick);
    container.replaceChildren(button);
  }

  function authorizePayment({ amountUsd, merchantName, onAuthorized }) {
    if (!state) return Promise.reject(new Error('Apple Pay is not ready yet.'));
    if (!Number.isFinite(amountUsd) || amountUsd < 0.01) {
      return Promise.reject(new Error('This order is below the minimum Apple Pay amount.'));
    }
    if (typeof onAuthorized !== 'function') {
      return Promise.reject(new Error('Apple Pay checkout could not be started.'));
    }
    const ApplePaySession = window.ApplePaySession;
    const paymentRequest = state.applePay.createPaymentRequest({
      total: {
        label: merchantName,
        amount: amountUsd.toFixed(2)
      },
      requiredBillingContactFields: ['postalAddress']
    });

    return new Promise((resolve, reject) => {
      let settled = false;
      let session;
      try {
        session = new ApplePaySession(3, paymentRequest);
        session.onvalidatemerchant = async (event) => {
          try {
            const merchantSession = await state.applePay.performValidation({
              validationURL: event.validationURL,
              displayName: merchantName
            });
            if (!settled) session.completeMerchantValidation(merchantSession);
          } catch (error) {
            if (settled) return;
            settled = true;
            try {
              session.abort();
            } catch (abortError) {
              reject(new Error(`Apple Pay could not validate the merchant: ${abortError.message}`));
              return;
            }
            reject(new Error('Apple Pay could not validate the merchant. Check the Apple Pay setup and try again.'));
          }
        };
        session.onpaymentauthorized = async (event) => {
          if (settled) return;
          try {
            const payload = await state.applePay.tokenize({ token: event.payment.token });
            if (!payload || typeof payload.nonce !== 'string' || !payload.nonce) {
              throw new Error('Apple Pay did not return a valid payment authorization.');
            }
            const billingContact = event.payment.billingContact || {};
            const result = await onAuthorized({
              nonce: payload.nonce,
              deviceData: state.dataCollector.deviceData,
              postalCode: typeof billingContact.postalCode === 'string' ? billingContact.postalCode : ''
            });
            if (!result || typeof result.status !== 'string') {
              throw new Error('Apple Pay payment status could not be confirmed.');
            }
            session.completePayment(result.status === 'completed'
              ? ApplePaySession.STATUS_SUCCESS
              : ApplePaySession.STATUS_FAILURE);
            settled = true;
            resolve(result);
          } catch (error) {
            if (settled) return;
            settled = true;
            try {
              session.completePayment(ApplePaySession.STATUS_FAILURE);
            } catch (completionError) {
              reject(new Error(`Apple Pay could not complete the payment: ${completionError.message}`));
              return;
            }
            reject(error);
          }
        };
        session.oncancel = () => {
          if (settled) return;
          settled = true;
          reject(new Error('Apple Pay payment was canceled.'));
        };
        session.begin();
      } catch (error) {
        settled = true;
        reject(new Error(`Apple Pay could not start: ${error.message}`));
      }
    });
  }

  window.valorApplePay = { authorizePayment, isSupported, mountButton, prepare };
})();
