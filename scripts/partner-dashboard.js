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
  const partnerPrograms = {
    sponsor: {
      title: 'Sponsor dashboard',
      intro: 'Choose a published package, pay online, and track your campaign here. Placement activates after payment is confirmed.',
      sectionsTitle: 'Sponsor applications',
      sectionsIntro: 'Published packages go live after payment. Custom campaign proposals are received online without an application review.'
    },
    organizer: {
      title: 'Organizer dashboard',
      intro: 'Create and manage events, track ticket sales, and make changes from your organizer dashboard. Valid event submissions publish automatically.',
      sectionsTitle: 'Organizer support',
      sectionsIntro: 'Submit an organizer support request here, or manage event listings directly in the organizer dashboard.'
    },
    creator: {
      title: 'Creator partner dashboard',
      intro: 'Get your referral link immediately, share it with your audience, and track visits, paid ticket sales, and earnings.',
      sectionsTitle: 'Creator dashboard',
      sectionsIntro: 'Creator accounts activate automatically. New accounts start at a 5% commission on eligible paid ticket sales.'
    },
    artist: {
      title: 'Artist / DJ dashboard',
      intro: 'Publish an artist or DJ profile and services, receive event booking requests, and share a tracked ticket referral link.',
      sectionsTitle: 'Artist / DJ profile',
      sectionsIntro: 'Your public profile and services publish immediately. Booking deposits remain unavailable pending legal review of final booking and refund terms.'
    },
    branding: {
      title: 'Event branding dashboard',
      intro: 'Send your event date, quantities, and production requirements online and track your branding request here.',
      sectionsTitle: 'Branding request',
      sectionsIntro: 'Requests are received automatically without an application review. Confirm scope and pricing online before production.'
    },
    investment: {
      title: 'Investment inquiry dashboard',
      intro: 'Send and track a non-binding investment inquiry online. No meeting is needed to submit it.',
      sectionsTitle: 'Non-binding investment inquiry',
      sectionsIntro: 'An inquiry is received without an approval step. It is not an offer, commitment, or promise of returns.'
    }
  };
  const selectedProgram = new URLSearchParams(window.location.search).get('program');
  const programConfig = partnerPrograms[selectedProgram];

  if (programConfig) {
    document.title = `${programConfig.title} | Valor Africa`;
    document.getElementById('partnerDashboardTitle').textContent = programConfig.title;
    document.getElementById('partnerDashboardIntro').textContent = programConfig.intro;
    document.getElementById('partnerDashboardAvailability').hidden = true;
    document.getElementById('partnerApplicationsTitle').textContent = programConfig.sectionsTitle;
    document.getElementById('partnerApplicationsIntro').textContent = programConfig.sectionsIntro;

    document.querySelectorAll('[data-partner-program]').forEach((section) => {
      section.hidden = section.dataset.partnerProgram !== selectedProgram;
    });
    document.getElementById('businessPartnershipApplications').hidden =
      selectedProgram === 'creator';
    document.querySelectorAll('[data-program-link]').forEach((link) => {
      if (link.dataset.programLink === selectedProgram) link.setAttribute('aria-current', 'page');
    });
  }

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
      if (selectedProgram === 'artist') window.dispatchEvent(new Event('valor-artist-dashboard-ready'));
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
