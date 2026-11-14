(async function () {
  'use strict';
  const root = document.getElementById('unsubscribeStatus');
  const token = new URLSearchParams(window.location.search).get('token');
  if (!token) {
    root.innerHTML = '<h1>Missing unsubscribe link</h1><p>This page needs a valid unsubscribe link from one of our emails. <a href="account.html">Manage your account</a> instead.</p>';
    return;
  }
  try {
    await window.valorEventsApi('/api/account/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ token })
    });
    root.innerHTML = '<h1>You’re unsubscribed</h1><p>You won’t receive event re-engagement emails anymore. You can still get reminders for tickets you’ve purchased, and you can change this anytime from <a href="account.html">your account</a>.</p>';
  } catch (error) {
    root.innerHTML = `<h1>Could not update your preferences</h1><p>${error.message} <a href="account.html">Manage your account</a> instead.</p>`;
  }
})();
