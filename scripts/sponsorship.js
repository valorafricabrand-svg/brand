(function () {
  'use strict';
  const api = window.valorEventsApi;

  function setFeedback(element, message, isError = false) {
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('error', isError);
  }

  function setupCheckoutForm() {
    const form = document.getElementById('sponsorCheckoutForm');
    if (!form) return;
    const feedback = document.getElementById('sponsorCheckoutFeedback');
    const paymentMethod = document.getElementById('sponsorPaymentMethod');
    const phoneInput = document.getElementById('sponsorPhone');
    const submitButton = document.getElementById('sponsorCheckoutSubmit');
    const labels = { mpesa: 'M-Pesa', wallet: 'Valor Wallet', nowpayments: 'NOWPayments', paypal: 'PayPal' };
    let paymentsConfigured = false;

    function updatePaymentFields() {
      const needsPhone = paymentMethod.value === 'mpesa';
      phoneInput.required = needsPhone;
      phoneInput.disabled = !needsPhone;
      submitButton.textContent = `Pay with ${labels[paymentMethod.value] || 'M-Pesa'}`;
    }
    paymentMethod.addEventListener('change', updatePaymentFields);
    updatePaymentFields();

    api('/api/health').then((health) => { paymentsConfigured = Boolean(health.paymentsConfigured); }).catch(() => {});

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      feedback.classList.remove('error');
      const token = window.valorAccountToken();
      const values = Object.fromEntries(new FormData(form));
      if (values.paymentMethod === 'wallet' && !token) {
        setFeedback(feedback, 'Sign in to your account and link a phone wallet before paying with your balance.', true);
        return;
      }
      if (values.paymentMethod === 'mpesa' && !paymentsConfigured) {
        setFeedback(feedback, 'M-Pesa checkout is not available yet. Choose another payment method or try again later.', true);
        return;
      }
      submitButton.disabled = true;
      setFeedback(feedback, 'Starting your sponsorship checkout…');
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const result = await api('/api/sponsorships', {
          method: 'POST',
          headers,
          body: JSON.stringify(values)
        });
        window.sessionStorage.setItem(`valor-sponsorship-${result.purchaseId}`, result.accessToken);
        if (result.checkoutUrl) {
          setFeedback(feedback, `Redirecting you to ${labels[result.paymentMethod] || 'your payment provider'}…`);
          window.location.assign(result.checkoutUrl);
          return;
        }
        window.location.assign(`sponsorship-status.html?purchaseId=${encodeURIComponent(result.purchaseId)}`);
      } catch (error) {
        setFeedback(feedback, error.message, true);
      } finally {
        submitButton.disabled = false;
      }
    });
  }

  async function loadSponsorshipStatus() {
    const root = document.getElementById('sponsorshipStatus');
    if (!root) return;
    const params = new URLSearchParams(window.location.search);
    const purchaseId = params.get('purchaseId');
    const token = purchaseId && window.sessionStorage.getItem(`valor-sponsorship-${purchaseId}`);
    if (!purchaseId || !token) {
      root.replaceChildren();
      const heading = document.createElement('h1');
      heading.textContent = 'Sponsorship link unavailable';
      const text = document.createElement('p');
      text.textContent = 'Open this page on the same browser used to start checkout, or contact Valor Africa support with your payment details.';
      root.append(heading, text);
      return;
    }
    const paypalCaptureKey = `valor-sponsorship-paypal-captured-${purchaseId}`;
    if (params.get('payment') === 'paypal' && !window.sessionStorage.getItem(paypalCaptureKey)) {
      window.sessionStorage.setItem(paypalCaptureKey, '1');
      try {
        await api(`/api/sponsorships/${encodeURIComponent(purchaseId)}/paypal-capture`, {
          method: 'POST',
          headers: { 'X-Order-Access': token }
        });
      } catch (error) {
        console.error('Could not confirm the PayPal payment automatically:', error.message);
      }
    }
    try {
      const purchase = await api(`/api/sponsorships/${encodeURIComponent(purchaseId)}`, {
        headers: { 'X-Order-Access': token }
      });
      const heading = document.createElement('h1');
      heading.textContent = purchase.status === 'active' ? 'Sponsorship active'
        : purchase.status === 'failed' ? 'Payment not completed'
          : purchase.status === 'review' ? 'Payment needs support review'
            : purchase.paymentMethod === 'nowpayments' ? 'Waiting for crypto payment confirmation'
              : purchase.paymentMethod === 'paypal' ? 'Waiting for PayPal payment confirmation'
                : 'Waiting for M-Pesa payment';
      const details = document.createElement('p');
      const cryptoPrice = purchase.cryptoPriceAmountUsd
        ? ` · Invoice: USD ${Number(purchase.cryptoPriceAmountUsd).toFixed(2)}`
        : '';
      details.textContent = `${purchase.brandName} · ${purchase.tier} package · KES ${Number(purchase.amountKes).toLocaleString('en-KE')}${cryptoPrice}`;
      root.replaceChildren(heading, details);
      if (purchase.status === 'pending') {
        const explanation = document.createElement('p');
        explanation.textContent = purchase.paymentMethod === 'nowpayments'
          ? 'Complete the crypto payment on NOWPayments. Your sponsorship activates automatically once confirmed; this page checks for confirmation automatically.'
          : purchase.paymentMethod === 'paypal'
            ? 'Complete the payment on PayPal. This page confirms it automatically when you return.'
            : 'Approve the payment prompt on your phone. This page checks for confirmation automatically.';
        root.appendChild(explanation);
        window.setTimeout(loadSponsorshipStatus, 5000);
      } else if (purchase.status === 'active') {
        const activeNote = document.createElement('p');
        activeNote.textContent = `Your brand is now shown across Valor Africa through ${new Date(purchase.endsAt).toLocaleString('en-KE')}.`;
        root.appendChild(activeNote);
      }
      if (purchase.resultDescription) {
        const message = document.createElement('p');
        message.textContent = purchase.resultDescription;
        root.appendChild(message);
      }
    } catch (error) {
      root.replaceChildren();
      const message = document.createElement('p');
      message.className = 'page-feedback error';
      message.textContent = error.message;
      root.appendChild(message);
    }
  }

  setupCheckoutForm();
  loadSponsorshipStatus();
})();
