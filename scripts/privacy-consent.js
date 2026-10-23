(function () {
  'use strict';

  const consentKey = 'valor-meta-pixel-consent';
  const pixelId = '2071976333431874';
  const storedConsent = window.localStorage.getItem(consentKey);
  const pageName = window.location.pathname.split('/').pop();
  const privatePages = new Set([
    'account.html',
    'wallet.html',
    'my-tickets.html',
    'order.html',
    'ticket.html',
    'organizer-dashboard.html'
  ]);
  const isOrderPage = pageName === 'order.html'
    && new URLSearchParams(window.location.search).has('orderId');
  const eventSlug = pageName === 'event.html'
    ? new URLSearchParams(window.location.search).get('slug')
    : null;
  let pixelLoaded = false;
  let confirmedPurchase = false;
  let pendingPurchase = null;

  function hasValidPixelId() {
    return /^\d+$/.test(pixelId);
  }

  function isEligiblePage() {
    return (isOrderPage || !privatePages.has(pageName))
      && (pageName !== 'event.html' || Boolean(eventSlug));
  }

  function hasConsent() {
    return window.localStorage.getItem(consentKey) === 'accepted';
  }

  function loadPixel() {
    if (pixelLoaded
      || !hasValidPixelId()
      || !hasConsent()
      || !isEligiblePage()
      || (isOrderPage && !confirmedPurchase)) return;

    pixelLoaded = true;
    (function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = true;
      n.version = '2.0';
      n.queue = [];
      t = b.createElement(e);
      t.async = true;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js'));

    window.fbq('init', pixelId);
    if (!isOrderPage) window.fbq('track', 'PageView');
    if (!isOrderPage && window.valorMetaContent) {
      window.fbq('track', 'ViewContent', window.valorMetaContent);
    }
  }

  function trackPendingPurchase() {
    if (!pendingPurchase || !hasConsent() || !hasValidPixelId()) return;
    const dedupeKey = `valor-meta-purchase-${pendingPurchase.orderId}`;
    if (window.localStorage.getItem(dedupeKey) === 'sent') {
      pendingPurchase = null;
      return;
    }
    loadPixel();
    if (!pixelLoaded || typeof window.fbq !== 'function') return;
    window.localStorage.setItem(dedupeKey, 'sent');
    window.fbq('track', 'Purchase', {
      value: pendingPurchase.value,
      currency: 'KES'
    }, {
      eventID: pendingPurchase.orderId
    });
    pendingPurchase = null;
  }

  window.valorTrackMeta = function (eventName, parameters) {
    if (!hasConsent() || !hasValidPixelId() || !isEligiblePage() || typeof window.fbq !== 'function') return;
    window.fbq('track', eventName, parameters || {});
  };

  window.valorTrackPurchase = function (order) {
    if (!isOrderPage
      || !order
      || order.status !== 'paid'
      || typeof order.orderId !== 'string'
      || !order.orderId
      || !Number.isFinite(Number(order.amountKes))
      || Number(order.amountKes) <= 0) return;
    confirmedPurchase = true;
    pendingPurchase = {
      orderId: order.orderId,
      value: Number(order.amountKes)
    };
    trackPendingPurchase();
  };

  function createConsentControls() {
    if (!hasValidPixelId() || !isEligiblePage()) return;

    const panel = document.createElement('section');
    panel.className = 'privacy-consent';
    panel.setAttribute('aria-label', 'Cookie preferences');
    panel.setAttribute('role', 'region');
    panel.hidden = true;

    const message = document.createElement('div');
    message.className = 'privacy-consent-copy';
    const title = document.createElement('strong');
    title.textContent = 'Your privacy choices';
    const description = document.createElement('p');
    description.append(
      document.createTextNode('We use the Meta Pixel for advertising measurement only if you accept. You can change your choice at any time. '),
      Object.assign(document.createElement('a'), {
        href: 'privacy-policy.html',
        textContent: 'Read our Privacy Policy'
      })
    );
    message.append(title, description);

    const actions = document.createElement('div');
    actions.className = 'privacy-consent-actions';
    const reject = document.createElement('button');
    reject.type = 'button';
    reject.className = 'privacy-consent-secondary';
    reject.textContent = 'Reject optional cookies';
    const accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'privacy-consent-primary';
    accept.textContent = 'Accept optional cookies';
    actions.append(reject, accept);
    panel.append(message, actions);

    const settings = document.createElement('button');
    settings.type = 'button';
    settings.className = 'privacy-consent-settings';
    settings.textContent = 'Cookie settings';
    settings.setAttribute('aria-expanded', 'false');

    function closePanel() {
      panel.hidden = true;
      settings.setAttribute('aria-expanded', 'false');
    }

    function saveChoice(choice) {
      const alreadyAccepted = hasConsent();
      window.localStorage.setItem(consentKey, choice);
      if (choice === 'accepted') {
        if (pixelLoaded && typeof window.fbq === 'function') {
          window.fbq('consent', 'grant');
          if (!alreadyAccepted) {
            if (!isOrderPage) {
              window.fbq('track', 'PageView');
              if (window.valorMetaContent) window.fbq('track', 'ViewContent', window.valorMetaContent);
            }
          }
        } else loadPixel();
        trackPendingPurchase();
      } else if (typeof window.fbq === 'function') {
        window.fbq('consent', 'revoke');
      }
      closePanel();
    }

    reject.addEventListener('click', function () {
      saveChoice('rejected');
    });
    accept.addEventListener('click', function () {
      saveChoice('accepted');
    });
    settings.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
      settings.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) accept.focus();
    });

    document.body.append(panel, settings);
    if (!storedConsent) {
      panel.hidden = false;
      settings.setAttribute('aria-expanded', 'true');
    }
  }

  if (hasConsent()) loadPixel();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createConsentControls, { once: true });
  } else {
    createConsentControls();
  }
}());
