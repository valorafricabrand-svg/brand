(function () {
  'use strict';
  const signedOut = document.getElementById('partnerDashboardSignedOut');
  const termsGate = document.getElementById('partnerTermsGate');
  const dashboard = document.getElementById('partnerDashboardContent');
  const termsForm = document.getElementById('partnerTermsForm');
  const termsFeedback = document.getElementById('partnerTermsFeedback');
  const dashboardFeedback = document.getElementById('partnerDashboardFeedback');
  const sponsorshipList = document.getElementById('mySponsorships');
  const token = window.valorAccountToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  signedOut.querySelector('a').href = `account.html?returnTo=${encodeURIComponent(returnTo)}`;

  function setFeedback(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle('error', isError);
  }

  function requireSignIn() {
    signedOut.hidden = false;
    termsGate.hidden = true;
    dashboard.hidden = true;
  }

  function formatDate(value) {
    if (!value) return 'Not started';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Date pending' : date.toLocaleString('en-KE');
  }

  function scrollToRequestedSection() {
    if (!window.location.hash) return;
    const target = document.getElementById(window.location.hash.slice(1));
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderSponsorships(purchases) {
    sponsorshipList.replaceChildren();
    if (!purchases.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No sponsorship purchases yet. Choose a package above to get started.';
      sponsorshipList.appendChild(empty);
      return;
    }

    purchases.forEach((purchase) => {
      const item = document.createElement('article');
      item.className = 'partnership-application-status';
      const heading = document.createElement('strong');
      heading.textContent = `${purchase.brandName} · ${purchase.tier} package`;
      const status = document.createElement('p');
      status.textContent = `Status: ${purchase.status} · KES ${Number(purchase.amountKes).toLocaleString('en-KE')} · ${purchase.paymentMethod}`;
      const period = document.createElement('p');
      period.textContent = purchase.status === 'active'
        ? `Visible until ${formatDate(purchase.endsAt)}`
        : purchase.status === 'pending'
          ? 'Your campaign will go live after payment is confirmed.'
          : purchase.resultDescription || `Created ${formatDate(purchase.createdAt)}`;
      item.append(heading, status, period);
      sponsorshipList.appendChild(item);
    });
  }

  async function loadSponsorships() {
    const result = await window.valorEventsApi('/api/sponsorships/me', { headers });
    renderSponsorships(result.purchases);
  }

  async function initialize() {
    if (!token) {
      requireSignIn();
      return;
    }

    try {
      const result = await window.valorEventsApi('/api/partner-terms/me', { headers });
      signedOut.hidden = true;
      if (!result.acknowledgement || result.acknowledgement.version !== result.version) {
        termsGate.hidden = false;
        dashboard.hidden = true;
        return;
      }

      termsGate.hidden = true;
      dashboard.hidden = false;
      scrollToRequestedSection();
      await loadSponsorships();
    } catch (error) {
      if (/sign in to your valor africa account|session has expired/i.test(error.message)) {
        requireSignIn();
        return;
      }
      setFeedback(dashboardFeedback, error.message, true);
    }
  }

  termsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = termsForm.querySelector('[type="submit"]');
    const values = new FormData(termsForm);
    button.disabled = true;
    setFeedback(termsFeedback, 'Recording your acknowledgement…');
    try {
      const current = await window.valorEventsApi('/api/partner-terms/current');
      await window.valorEventsApi('/api/partner-terms/acknowledge', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          version: current.version,
          signerName: values.get('signerName'),
          acknowledged: values.get('acknowledged') === 'on'
        })
      });
      window.location.reload();
    } catch (error) {
      setFeedback(termsFeedback, error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('refreshSponsorships').addEventListener('click', async () => {
    const button = document.getElementById('refreshSponsorships');
    button.disabled = true;
    setFeedback(dashboardFeedback, 'Refreshing your sponsorships…');
    try {
      await loadSponsorships();
      setFeedback(dashboardFeedback, '');
    } catch (error) {
      setFeedback(dashboardFeedback, error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  initialize();
})();
