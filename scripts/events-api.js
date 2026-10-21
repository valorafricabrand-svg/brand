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
      response = await fetch(`${base}${path}`, { ...options, headers });
    } catch (error) {
      throw new Error('Could not connect to the Valor Africa event service. Please try again later.');
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `The event service returned an error (${response.status}).`);
    return body;
  };
  window.valorEventsApiBase = base;
})();
