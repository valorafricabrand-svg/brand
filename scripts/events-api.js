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
  const accountTokenKey = 'valor-account-token';
  const accountReturnToKey = 'valor-account-return-to';
  window.valorAccountToken = function () {
    let token = window.localStorage.getItem(accountTokenKey) || window.sessionStorage.getItem(accountTokenKey) || '';
    if (token) window.localStorage.setItem(accountTokenKey, token);
    return token;
  };
  window.valorSetAccountToken = function (token) {
    window.localStorage.setItem(accountTokenKey, token);
    window.sessionStorage.setItem(accountTokenKey, token);
  };
  window.valorClearAccountToken = function () {
    window.localStorage.removeItem(accountTokenKey);
    window.sessionStorage.removeItem(accountTokenKey);
  };
  const accountPath = new URL('account.html', window.location.href).pathname;

  function buildAccountHref() {
    const url = new URL('account.html', window.location.href);
    if (window.location.pathname !== accountPath) {
      const currentPage = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.localStorage.setItem(accountReturnToKey, currentPage);
      url.searchParams.set('returnTo', currentPage);
    }
    return url.href;
  }

  function updateAccountNavigation(isSignedIn) {
    const nav = document.querySelector('.service-nav, .nav-links');
    if (!nav) return;
    let accountLink = Array.from(nav.querySelectorAll('a')).find((link) => link.pathname === accountPath);
    if (!accountLink) {
      accountLink = document.createElement('a');
      nav.appendChild(accountLink);
    }
    accountLink.href = buildAccountHref();
    accountLink.textContent = isSignedIn ? 'My account' : 'Sign in';

    let signOutButton = nav.querySelector('.nav-account-signout');
    if (!signOutButton) {
      signOutButton = document.createElement('button');
      signOutButton.type = 'button';
      signOutButton.className = 'nav-account-signout';
      signOutButton.textContent = 'Sign out';
      nav.appendChild(signOutButton);
      const status = document.createElement('span');
      status.className = 'nav-account-status';
      status.setAttribute('role', 'status');
      status.hidden = true;
      nav.appendChild(status);
      signOutButton.addEventListener('click', async () => {
        const token = window.valorAccountToken();
        let revokeError = null;
        if (token) {
          try {
            await window.valorEventsApi('/api/auth/account/logout', {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` }
            });
          } catch (error) {
            revokeError = error;
          }
        }
        window.valorClearAccountToken();
        window.sessionStorage.removeItem('valor-wallet-token');
        window.sessionStorage.removeItem('valor-wallet-link-phone');
        document.dispatchEvent(new CustomEvent('valor:account-session', { detail: { account: null } }));
        const status = nav.querySelector('.nav-account-status');
        if (status) {
          status.textContent = revokeError
            ? `Signed out on this device; server session could not be revoked: ${revokeError.message}`
            : 'You are signed out.';
          status.hidden = false;
        }
      });
    }
    signOutButton.hidden = !isSignedIn;
  }

  function rememberCurrentPage() {
    if (window.location.pathname !== accountPath) {
      window.sessionStorage.setItem(
        accountReturnToKey,
        `${window.location.pathname}${window.location.search}${window.location.hash}`
      );
    }
  }
  const scrollKey = 'valor-scroll-position';
  let scrollSaveTimer;
  window.addEventListener('scroll', () => {
    window.clearTimeout(scrollSaveTimer);
    scrollSaveTimer = window.setTimeout(() => {
      const saved = JSON.parse(window.localStorage.getItem(scrollKey) || '{}');
      saved[window.location.pathname + window.location.search] = window.scrollY;
      window.localStorage.setItem(scrollKey, JSON.stringify(saved));
    }, 150);
  }, { passive: true });
  window.addEventListener('load', () => {
    if (window.location.hash) return;
    const saved = JSON.parse(window.localStorage.getItem(scrollKey) || '{}');
    const position = saved[window.location.pathname + window.location.search];
    if (Number.isFinite(position) && position > 0) {
      window.requestAnimationFrame(() => window.scrollTo({ top: position, behavior: 'auto' }));
    }
  });

  rememberCurrentPage();
  window.addEventListener('hashchange', rememberCurrentPage);
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('a[href]').forEach((link) => {
      if (link.pathname === accountPath) {
        link.href = buildAccountHref();
      }
    });
    const token = window.valorAccountToken();
    updateAccountNavigation(Boolean(token));
    if (token) {
      window.valorEventsApi('/api/auth/account', {
        headers: { Authorization: `Bearer ${token}` }
      }).then(() => {
        updateAccountNavigation(true);
      }).catch((error) => {
        if (/sign in|session has expired/i.test(error.message)) {
          window.valorClearAccountToken();
          window.sessionStorage.removeItem('valor-wallet-token');
          window.sessionStorage.removeItem('valor-wallet-link-phone');
          document.dispatchEvent(new CustomEvent('valor:account-session', { detail: { account: null } }));
          updateAccountNavigation(false);
        }
      });
    }
  });
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (link && link.pathname === accountPath && window.location.pathname !== accountPath) {
      link.href = buildAccountHref();
    }
  }, true);
  document.addEventListener('valor:account-session', (event) => {
    updateAccountNavigation(Boolean(event.detail && event.detail.account));
  });

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
