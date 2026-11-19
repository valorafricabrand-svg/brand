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
        else reject(new Error('The Google Pay payment library did not load correctly.'));
      }, { once: true });
      script.addEventListener('error', () => reject(new Error('The Google Pay payment library could not be loaded.')), { once: true });
      if (!script.isConnected) document.head.appendChild(script);
    });
  }

  async function prepare({ api, accountToken }) {
    if (state && state.accountToken === accountToken) return state;
    if (initialization) return initialization;
    if (!accountToken) throw new Error('Sign in before using Google Pay.');
    initialization = (async () => {
      const credentials = await api('/api/payments/googlepay/client-token', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accountToken}` }
      });
      if (!credentials || typeof credentials.clientToken !== 'string' ||
          !['TEST','PRODUCTION'].includes(credentials.environment)) {
        throw new Error('Google Pay is not configured for this checkout.');
      }
      await loadScript(
        'valor-braintree-client',
        'https://js.braintreegateway.com/web/3.147.0/js/client.min.js',
        () => Boolean(window.braintree && window.braintree.client)
      );
      await Promise.all([
        loadScript(
          'valor-google-pay-api',
          'https://pay.google.com/gp/p/js/pay.js',
          () => Boolean(window.google && window.google.payments && window.google.payments.api)
        ),
        loadScript(
          'valor-braintree-google-payment',
          'https://js.braintreegateway.com/web/3.147.0/js/google-payment.min.js',
          () => Boolean(window.braintree && window.braintree.googlePayment)
        ),
        loadScript(
          'valor-braintree-data-collector',
          'https://js.braintreegateway.com/web/3.147.0/js/data-collector.min.js',
          () => Boolean(window.braintree && window.braintree.dataCollector)
        )
      ]);
      const client = await window.braintree.client.create({ authorization: credentials.clientToken });
      const googlePayment = await window.braintree.googlePayment.create({
        client,
        googlePayVersion: 2,
        ...(credentials.googleMerchantId ? { googleMerchantId: credentials.googleMerchantId } : {})
      });
      const paymentsClient = new window.google.payments.api.PaymentsClient({
        environment: credentials.environment
      });
      const readiness = await paymentsClient.isReadyToPay({
        apiVersion: 2,
        apiVersionMinor: 0,
        allowedPaymentMethods: googlePayment.createPaymentDataRequest().allowedPaymentMethods
      });
      if (!readiness || readiness.result !== true) {
        throw new Error('Google Pay is not available in this browser or Google account.');
      }
      const dataCollector = await window.braintree.dataCollector.create({ client, paypal: true });
      state = {
        accountToken,
        client,
        dataCollector,
        googlePayment,
        paymentsClient
      };
      return state;
    })();
    try {
      return await initialization;
    } finally {
      initialization = null;
    }
  }

  function mountButton(container, onClick) {
    if (!state) throw new Error('Google Pay has not been initialized.');
    const button = state.paymentsClient.createButton({
      onClick,
      buttonType: 'pay',
      buttonColor: 'black'
    });
    container.replaceChildren(button);
  }

  function requestPayment({ amountUsd, merchantName }) {
    if (!state) return Promise.reject(new Error('Google Pay is not ready yet.'));
    if (!Number.isFinite(amountUsd) || amountUsd < 0.01) {
      return Promise.reject(new Error('This order is below the minimum Google Pay amount.'));
    }
    const request = state.googlePayment.createPaymentDataRequest({
      transactionInfo: {
        currencyCode: 'USD',
        totalPriceStatus: 'FINAL',
        totalPrice: amountUsd.toFixed(2)
      },
      merchantInfo: { merchantName }
    });
    const cardPaymentMethod = request.allowedPaymentMethods[0];
    if (cardPaymentMethod && cardPaymentMethod.parameters) {
      cardPaymentMethod.parameters.billingAddressRequired = true;
      cardPaymentMethod.parameters.billingAddressParameters = { format: 'FULL' };
    }
    return state.paymentsClient.loadPaymentData(request).then((paymentData) =>
      new Promise((resolve, reject) => {
        state.googlePayment.parseResponse(paymentData, (error, result) => {
          if (error) {
            reject(new Error('Google Pay could not authorize this payment. Please try again.'));
            return;
          }
          if (!result || typeof result.nonce !== 'string' || !result.nonce) {
            reject(new Error('Google Pay did not return a valid payment authorization.'));
            return;
          }
          const billingAddress = paymentData.paymentMethodData &&
            paymentData.paymentMethodData.info &&
            paymentData.paymentMethodData.info.billingAddress;
          resolve({
            nonce: result.nonce,
            deviceData: state.dataCollector.deviceData,
            postalCode: billingAddress && billingAddress.postalCode || ''
          });
        });
      })
    );
  }

  window.valorGooglePay = { mountButton, prepare, requestPayment };
})();
