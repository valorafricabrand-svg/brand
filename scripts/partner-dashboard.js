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

  function formatRate(value) {
    return value === null ? '—' : `${(Number(value) * 100).toFixed(2)}%`;
  }

  function renderSponsorReport(report, mount) {
    mount.replaceChildren();
    const range = document.createElement('p');
    range.textContent = `Report range: ${report.range.startDate} to ${report.range.endDate} · ${report.campaign.tier} package · KES ${Number(report.campaign.amountKes).toLocaleString('en-KE')}`;
    mount.appendChild(range);

    const metrics = document.createElement('div');
    metrics.className = 'sponsor-report-metrics';
    [
      ['Platform-measured viewable impressions', Number(report.metrics.impressions).toLocaleString('en-KE')],
      ['Total campaign clicks', Number(report.metrics.clicks).toLocaleString('en-KE')],
      ['Homepage placement CTR', formatRate(report.metrics.homepageClickThroughRate)],
      ['Event-link clicks', Number(report.metrics.eventLinkClicks).toLocaleString('en-KE')],
      ['Attributed paid ticket orders', Number(report.metrics.attributedPaidOrders).toLocaleString('en-KE')],
      ['Attributed tickets', Number(report.metrics.attributedTickets).toLocaleString('en-KE')],
      ['Attributed ticket sales', `KES ${Number(report.metrics.attributedSalesKes).toLocaleString('en-KE')}`],
      ['Ticket conversion from event-link clicks', formatRate(report.metrics.ticketConversionRate)],
      ['Campaign fee per click', report.metrics.costPerClickKes === null
        ? '—'
        : `KES ${Number(report.metrics.costPerClickKes).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`]
    ].forEach(([label, value]) => {
      const metric = document.createElement('p');
      metric.textContent = `${label}: ${value}`;
      metrics.appendChild(metric);
    });
    mount.appendChild(metrics);

    const placementsHeading = document.createElement('h4');
    placementsHeading.textContent = 'Placement breakdown';
    mount.appendChild(placementsHeading);
    if (!report.placements.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No tracked impressions or clicks in this date range.';
      mount.appendChild(empty);
    }
    report.placements.forEach((placement) => {
      const item = document.createElement('p');
      const label = placement.placement === 'home-sponsor-strip'
        ? 'Homepage sponsor strip'
        : placement.placement === 'event-referral' ? 'Shared event link' : placement.placement;
      item.textContent = `${label}: ${Number(placement.impressions).toLocaleString('en-KE')} impressions · ${Number(placement.clicks).toLocaleString('en-KE')} clicks · CTR ${formatRate(placement.clickThroughRate)}`;
      mount.appendChild(item);
    });

    const deliveryHeading = document.createElement('h4');
    deliveryHeading.textContent = 'Offline event-day deliverables';
    mount.appendChild(deliveryHeading);
    if (!report.deliveries.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No organizer delivery reports have been submitted for this campaign.';
      mount.appendChild(empty);
    }
    report.deliveries.forEach((delivery) => {
      const item = document.createElement('article');
      item.className = 'partnership-application-status';
      const title = document.createElement('strong');
      title.textContent = `${delivery.eventTitle} · ${delivery.status}`;
      const data = document.createElement('p');
      data.textContent = `${Number(delivery.attendanceCount).toLocaleString('en-KE')} organizer-reported attendees · ${Number(delivery.checkInCount).toLocaleString('en-KE')} organizer-reported check-ins · ${Number(delivery.samplesRedeemed).toLocaleString('en-KE')} samples redeemed`;
      item.append(title, data);
      if (delivery.otherDeliverables) {
        const other = document.createElement('p');
        other.textContent = `Other deliverables: ${delivery.otherDeliverables}`;
        item.appendChild(other);
      }
      if (delivery.status === 'verified') {
        const verified = document.createElement('p');
        verified.textContent = `Verified by ${delivery.verifiedBy || 'Valor Africa'} on ${new Date(delivery.verifiedAt).toLocaleString('en-KE')}. ${delivery.verificationNote || ''}`.trim();
        item.appendChild(verified);
      } else if (delivery.verificationNote) {
        const note = document.createElement('p');
        note.textContent = `Valor review: ${delivery.verificationNote}`;
        item.appendChild(note);
      }
      mount.appendChild(item);
    });

    const note = document.createElement('p');
    note.textContent = 'Sales are attributed to recorded sponsor event-link clicks within 30 days. This is attribution, not proof the campaign caused a purchase. Offline figures are organizer-reported and remain unverified until Valor review.';
    mount.appendChild(note);
  }

  function renderSponsorships(purchases, availableEvents) {
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
      const impressions = document.createElement('p');
      impressions.textContent = `Platform-measured viewable impressions (campaign total): ${Number(purchase.viewableImpressions || 0).toLocaleString('en-KE')}`;
      const impressionNote = document.createElement('p');
      impressionNote.textContent = 'Counted when at least half of this placement is visible for one continuous second while the page is visible. This does not guarantee human attention.';
      item.append(heading, status, period, impressions, impressionNote);

      const campaignRunning = purchase.status === 'active' &&
        Date.parse(purchase.endsAt) > Date.now();
      if (campaignRunning) {
        const eventForm = document.createElement('form');
        eventForm.className = 'sponsor-campaign-events-form service-form';
        const eventLabel = document.createElement('label');
        eventLabel.textContent = 'Events for this campaign (up to 10)';
        const eventSelect = document.createElement('select');
        eventSelect.name = 'eventIds';
        eventSelect.multiple = true;
        eventSelect.size = Math.min(availableEvents.length || 3, 6);
        const currentEvents = new Set(purchase.events.filter((event) => event.active).map((event) => event.eventId));
        availableEvents.forEach((event) => {
          const option = document.createElement('option');
          option.value = event.id;
          option.textContent = `${event.title} · ${event.city} · ${new Date(event.startsAt).toLocaleDateString('en-KE')}`;
          option.selected = currentEvents.has(event.id);
          eventSelect.appendChild(option);
        });
        eventLabel.appendChild(eventSelect);
        if (!availableEvents.length) {
          const noEvents = document.createElement('p');
          noEvents.textContent = 'There are no published upcoming events available to link right now.';
          eventForm.appendChild(noEvents);
        }
        const saveEvents = document.createElement('button');
        saveEvents.type = 'submit';
        saveEvents.className = 'button button-primary';
        saveEvents.textContent = 'Save campaign events';
        const eventFeedback = document.createElement('p');
        eventFeedback.className = 'page-feedback';
        eventFeedback.setAttribute('role', 'status');
        eventFeedback.setAttribute('aria-live', 'polite');
        eventForm.append(eventLabel, saveEvents, eventFeedback);
        eventForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          saveEvents.disabled = true;
          try {
            const selectedEvents = Array.from(eventSelect.selectedOptions).map((option) => option.value);
            await window.valorEventsApi(`/api/sponsorships/${encodeURIComponent(purchase.purchaseId)}/events`, {
              method: 'PUT',
              headers,
              body: JSON.stringify({ eventIds: selectedEvents })
            });
            await loadSponsorships();
          } catch (error) {
            eventFeedback.textContent = error.message;
            eventFeedback.classList.add('error');
            saveEvents.disabled = false;
          }
        });
        item.appendChild(eventForm);

        const links = document.createElement('div');
        links.className = 'sponsor-campaign-event-links';
        purchase.events.filter((event) => event.active && Date.parse(event.startsAt) > Date.now()).forEach((event) => {
          const linkRow = document.createElement('div');
          const link = document.createElement('a');
          const trackingUrl = new URL(
            `/api/sponsorships/${encodeURIComponent(purchase.purchaseId)}/events/${encodeURIComponent(event.eventId)}/click`,
            window.valorEventsApiBase
          ).href;
          link.href = trackingUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer sponsored';
          link.textContent = `Trackable link for ${event.title}`;
          const copy = document.createElement('button');
          copy.type = 'button';
          copy.className = 'button secondary';
          copy.textContent = 'Copy link';
          const copyStatus = document.createElement('span');
          copyStatus.setAttribute('role', 'status');
          copy.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(trackingUrl);
              copyStatus.textContent = ' Link copied.';
            } catch (error) {
              copyStatus.textContent = ' Copy was blocked; open the link and copy it from the address bar.';
            }
          });
          linkRow.append(link, copy, copyStatus);
          links.appendChild(linkRow);
        });
        item.appendChild(links);
      }

      const reportToggle = document.createElement('button');
      reportToggle.type = 'button';
      reportToggle.className = 'button secondary';
      reportToggle.textContent = 'Load campaign report';
      const reportPanel = document.createElement('section');
      reportPanel.className = 'sponsor-campaign-report';
      reportPanel.hidden = true;
      const reportFilter = document.createElement('form');
      reportFilter.className = 'sponsor-report-range service-form';
      const reportStart = document.createElement('input');
      reportStart.type = 'date';
      reportStart.name = 'startDate';
      reportStart.value = (purchase.startsAt || purchase.createdAt).slice(0, 10);
      const reportStartLabel = document.createElement('label');
      reportStartLabel.textContent = 'From';
      reportStartLabel.appendChild(reportStart);
      const reportEnd = document.createElement('input');
      reportEnd.type = 'date';
      reportEnd.name = 'endDate';
      const campaignEnd = purchase.endsAt ? purchase.endsAt.slice(0, 10) : '';
      reportEnd.value = campaignEnd && campaignEnd < new Date().toISOString().slice(0, 10)
        ? campaignEnd
        : new Date().toISOString().slice(0, 10);
      const reportEndLabel = document.createElement('label');
      reportEndLabel.textContent = 'To';
      reportEndLabel.appendChild(reportEnd);
      const runReport = document.createElement('button');
      runReport.type = 'submit';
      runReport.className = 'button button-primary';
      runReport.textContent = 'Update report';
      reportFilter.append(reportStartLabel, reportEndLabel, runReport);
      const reportResults = document.createElement('div');
      reportResults.className = 'sponsor-campaign-report-results';
      reportPanel.append(reportFilter, reportResults);
      reportToggle.addEventListener('click', async () => {
        reportPanel.hidden = !reportPanel.hidden;
        reportToggle.textContent = reportPanel.hidden ? 'Load campaign report' : 'Hide campaign report';
        if (!reportPanel.hidden && !reportResults.childElementCount) {
          await loadSponsorReport(purchase.purchaseId, reportStart.value, reportEnd.value, reportResults);
        }
      });
      reportFilter.addEventListener('submit', async (event) => {
        event.preventDefault();
        await loadSponsorReport(purchase.purchaseId, reportStart.value, reportEnd.value, reportResults);
      });
      item.append(reportToggle, reportPanel);
      sponsorshipList.appendChild(item);
    });
  }

  async function loadSponsorReport(purchaseId, startDate, endDate, mount) {
    mount.textContent = 'Loading campaign report…';
    try {
      const query = new URLSearchParams({ startDate, endDate });
      const report = await window.valorEventsApi(
        `/api/sponsorships/${encodeURIComponent(purchaseId)}/report?${query.toString()}`,
        { headers }
      );
      renderSponsorReport(report, mount);
    } catch (error) {
      mount.textContent = error.message;
      mount.classList.add('error');
    }
  }

  async function loadSponsorships() {
    const result = await window.valorEventsApi('/api/sponsorships/me', { headers });
    let availableEvents = [];
    if (result.purchases.some((purchase) => purchase.status === 'active' && Date.parse(purchase.endsAt) > Date.now())) {
      try {
        const events = await window.valorEventsApi('/api/events');
        availableEvents = events.events;
      } catch (error) {
        setFeedback(dashboardFeedback, `Could not load upcoming events for campaign links: ${error.message}`, true);
      }
    }
    renderSponsorships(result.purchases, availableEvents);
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
