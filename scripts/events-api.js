(function () {
  'use strict';
  const localHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  // Set VALOR_EVENTS_API before this file on the deployed site.
  const base = (window.VALOR_EVENTS_API || (localHost
    ? 'http://localhost:4001'
    : 'https://valor-events-api-odp2.onrender.com')).replace(/\/+$/, '');
  window.valorEventsApi = async function (path, options = {}) {
    if (!base) throw new Error('The Valor Africa event service is not configured for this website yet.');
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    let response;
    try {
      response = await fetch(`${base}${path}`, {
        ...options,
        headers,
        signal: options.signal || (typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(12000) : undefined)
      });
    } catch (error) {
      throw new Error('Could not connect to the Valor Africa event service. Please try again later.');
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `The event service returned an error (${response.status}).`);
    return body;
  };
  window.valorEventsApiBase = base;
  const affiliateReferralStorageKey = 'valor-affiliate-referral';
  const referralCode = new URLSearchParams(window.location.search).get('ref');
  if (referralCode && /^[a-f0-9]{10}$/i.test(referralCode)) {
    window.valorAffiliateReferralReady = window.valorEventsApi('/api/partners/visit', {
      method: 'POST',
      body: JSON.stringify({ code: referralCode.toUpperCase() })
    }).then((result) => {
      window.localStorage.setItem(affiliateReferralStorageKey, JSON.stringify({
        token: result.referralToken,
        expiresAt: result.expiresAt
      }));
    }).catch((error) => {
      window.valorAffiliateReferralError = error;
      console.error('Could not record the creator referral link:', error.message);
    });
  } else {
    window.valorAffiliateReferralReady = Promise.resolve();
  }
  window.valorAffiliateReferralToken = function () {
    try {
      const stored = JSON.parse(window.localStorage.getItem(affiliateReferralStorageKey) || 'null');
      const expiresAt = stored && Date.parse(stored.expiresAt);
      if (!stored || typeof stored.token !== 'string' || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        window.localStorage.removeItem(affiliateReferralStorageKey);
        return '';
      }
      return stored.token;
    } catch (error) {
      console.error('Could not read the saved creator referral link.', error);
      return '';
    }
  };
})();
