(function () {
  'use strict';

  // Nothing here runs, stores, or sends anything until the visitor accepts optional cookies
  // in scripts/privacy-consent.js, which must load before this file.
  const visitorKey = 'valor-visitor-id';
  const sessionKey = 'valor-visit-session';
  const recentKey = 'valor-recently-viewed';
  const interestKey = 'valor-interest-profile';
  const sessionIdleMs = 30 * 60 * 1000;
  const maxRecent = 12;
  const flushDelayMs = 5000;
  const flushAt = 20;
  const queue = [];
  let flushTimer = null;

  function storage(kind) {
    try {
      return window[kind];
    } catch (error) {
      return null;
    }
  }

  function read(kind, key) {
    try {
      return storage(kind)?.getItem(key) ?? null;
    } catch (error) {
      return null;
    }
  }

  function write(kind, key, value) {
    try {
      if (value === null) storage(kind)?.removeItem(key);
      else storage(kind)?.setItem(key, value);
    } catch (error) {
      // Blocked storage just means nothing is remembered between pages.
    }
  }

  function readJson(key, fallback) {
    try {
      return JSON.parse(read('localStorage', key)) ?? fallback;
    } catch (error) {
      return fallback;
    }
  }

  function granted() {
    return Boolean(window.valorConsent?.granted?.());
  }

  function apiBase() {
    if (window.valorEventsApiBase) return window.valorEventsApiBase;
    const localHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    return (window.VALOR_EVENTS_API || (localHost
      ? 'http://localhost:4001'
      : 'https://valor-events-api-odp2.onrender.com')).replace(/\/+$/, '');
  }

  function newId() {
    return window.crypto?.randomUUID ? window.crypto.randomUUID() : null;
  }

  function visitorId() {
    let id = read('localStorage', visitorKey);
    if (!id) {
      id = newId();
      if (id) write('localStorage', visitorKey, id);
    }
    return id;
  }

  function sessionId() {
    let session = null;
    try {
      session = JSON.parse(read('sessionStorage', sessionKey));
    } catch (error) {
      session = null;
    }
    const now = Date.now();
    if (!session || !session.id || now - Number(session.lastSeen) > sessionIdleMs) {
      session = { id: newId() };
    }
    session.lastSeen = now;
    if (session.id) write('sessionStorage', sessionKey, JSON.stringify(session));
    return session.id;
  }

  function post(path, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`${apiBase()}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      keepalive: true
    }).catch(() => {});
  }

  function flush() {
    if (flushTimer !== null) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (!queue.length || !granted()) return;
    const visitor = visitorId();
    const session = sessionId();
    if (!visitor || !session) {
      queue.length = 0;
      return;
    }
    while (queue.length) {
      post('/api/analytics/events', {
        visitorId: visitor,
        sessionId: session,
        events: queue.splice(0, 25)
      }, read('localStorage', 'valor-account-token'));
    }
  }

  function bump(counts, key, weight) {
    if (!key) return;
    const name = String(key).slice(0, 60);
    counts[name] = (counts[name] || 0) + weight;
  }

  function rememberInterest(type, data) {
    if (type === 'event_view' && data.eventId) {
      const recent = readJson(recentKey, []).filter((id) => id !== data.eventId);
      recent.unshift(data.eventId);
      write('localStorage', recentKey, JSON.stringify(recent.slice(0, maxRecent)));
    }
    const weight = type === 'favorite' ? (data.value === 'loved' ? 3 : 0)
      : type === 'event_view' || type === 'filter' ? 1 : 0;
    if (!weight) return;
    const profile = readJson(interestKey, { categories: {}, cities: {} });
    profile.categories = profile.categories || {};
    profile.cities = profile.cities || {};
    if (type === 'filter') {
      bump(data.kind === 'city' ? profile.cities : profile.categories, data.value, weight);
    } else {
      bump(profile.categories, data.category, weight);
      bump(profile.cities, data.city, weight);
    }
    write('localStorage', interestKey, JSON.stringify(profile));
  }

  function currentPath() {
    return `${window.location.pathname}${window.location.search}`;
  }

  function internalReferrer() {
    try {
      const referrer = new URL(document.referrer);
      return referrer.origin === window.location.origin ? `${referrer.pathname}${referrer.search}` : '';
    } catch (error) {
      return '';
    }
  }

  window.valorTrack = function (type, data) {
    if (!granted()) return;
    const details = data || {};
    rememberInterest(type, details);
    queue.push({
      type,
      path: details.path || currentPath(),
      referrerPath: details.referrerPath || '',
      eventId: details.eventId ? String(details.eventId) : undefined,
      value: details.value === undefined || details.value === null ? undefined : String(details.value)
    });
    if (queue.length >= flushAt) flush();
    else if (flushTimer === null) flushTimer = window.setTimeout(flush, flushDelayMs);
  };

  window.valorPersonalisation = {
    recentEventIds() {
      return granted() ? readJson(recentKey, []) : [];
    },
    interests() {
      return granted() ? readJson(interestKey, { categories: {}, cities: {} }) : { categories: {}, cities: {} };
    }
  };

  document.addEventListener('valor:consent-change', (event) => {
    const { choice, granted: nowGranted, previouslyGranted } = event.detail || {};
    post('/api/analytics/consent', { choice });
    if (nowGranted) {
      if (!previouslyGranted) window.valorTrack('page_view', { referrerPath: internalReferrer() });
      return;
    }
    queue.length = 0;
    const forgottenVisitor = read('localStorage', visitorKey);
    [visitorKey, recentKey, interestKey].forEach((key) => write('localStorage', key, null));
    write('sessionStorage', sessionKey, null);
    if (previouslyGranted && forgottenVisitor) post('/api/analytics/forget', { visitorId: forgottenVisitor });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);

  window.valorTrack('page_view', { referrerPath: internalReferrer() });
  const pendingSignIn = read('sessionStorage', 'valor-pending-sign-in');
  if (pendingSignIn) {
    write('sessionStorage', 'valor-pending-sign-in', null);
    window.valorTrack('sign_in', { value: pendingSignIn });
  }
}());
