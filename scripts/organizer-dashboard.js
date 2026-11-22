(function () {
  'use strict';

  const root = document.getElementById('organizerEvents');
  const token = window.valorAccountToken();
  const headers = { Authorization: `Bearer ${token || ''}` };

  function showSignIn(message) {
    const link = document.createElement('a');
    link.href = `account.html?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`;
    link.textContent = 'Sign in to view your events';
    root.replaceChildren(document.createTextNode(`${message} `), link);
  }

  function formatDate(value, timezone) {
    return new Intl.DateTimeFormat('en-KE', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: timezone
    }).format(new Date(value));
  }

  function formatShortDate(dateStr) {
    return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-KE', { month: 'short', day: 'numeric' });
  }

  function buildAdAnalyticsPanel(data) {
    const wrap = document.createElement('div');

    if (data.adBookings.length) {
      const bookingsList = document.createElement('ul');
      bookingsList.className = 'ad-analytics-bookings';
      data.adBookings.forEach((booking) => {
        const item = document.createElement('li');
        const dateRange = booking.startsAt
          ? `${formatShortDate(booking.startsAt.slice(0, 10))} – ${formatShortDate(booking.endsAt.slice(0, 10))}`
          : 'Not started yet';
        item.textContent = `${booking.packageName} · KES ${Number(booking.priceKes).toLocaleString('en-KE')} · ${booking.status} · ${dateRange}`;
        bookingsList.appendChild(item);
      });
      wrap.appendChild(bookingsList);
    } else {
      const note = document.createElement('p');
      note.className = 'ad-analytics-empty';
      note.textContent = 'No ads purchased yet for this event — showing organic page views for the last 30 days.';
      wrap.appendChild(note);
    }

    const maxViews = Math.max(1, ...data.daily.map((day) => day.views));
    const chart = document.createElement('div');
    chart.className = 'ad-chart';
    data.daily.forEach((day) => {
      const bar = document.createElement('div');
      bar.className = `ad-chart-bar${day.ticketsSold > 0 ? ' ad-chart-bar-converted' : ''}`;
      bar.style.height = `${Math.max(3, Math.round((day.views / maxViews) * 100))}%`;
      bar.title = `${formatShortDate(day.date)}: ${day.views} view${day.views === 1 ? '' : 's'}`
        + (day.ticketsSold ? `, ${day.ticketsSold} ticket${day.ticketsSold === 1 ? '' : 's'} (KES ${Number(day.grossKes).toLocaleString('en-KE')})` : '');
      chart.appendChild(bar);
    });
    const chartWrap = document.createElement('div');
    chartWrap.className = 'ad-chart-wrap';
    const chartLabels = document.createElement('div');
    chartLabels.className = 'ad-chart-labels';
    const startLabel = document.createElement('span');
    startLabel.textContent = formatShortDate(data.rangeStart);
    const endLabel = document.createElement('span');
    endLabel.textContent = formatShortDate(data.rangeEnd);
    chartLabels.append(startLabel, endLabel);
    chartWrap.append(chart, chartLabels);
    wrap.appendChild(chartWrap);

    const totals = document.createElement('p');
    totals.className = 'ad-analytics-totals';
    totals.textContent = `${data.totals.views.toLocaleString('en-KE')} page views · ${data.totals.ticketsSold.toLocaleString('en-KE')} tickets sold · `
      + `KES ${Number(data.totals.grossKes).toLocaleString('en-KE')} in sales since ${formatShortDate(data.rangeStart)}`;
    wrap.appendChild(totals);

    return wrap;
  }

  async function loadAdAnalytics(eventId, panel) {
    panel.textContent = 'Loading ad analytics…';
    panel.classList.remove('error');
    try {
      const data = await window.valorEventsApi(`/api/events/mine/${encodeURIComponent(eventId)}/ad-analytics`, { headers });
      panel.replaceChildren(buildAdAnalyticsPanel(data));
    } catch (error) {
      panel.textContent = error.message;
      panel.classList.add('error');
    }
  }

  function renderSponsorDelivery(delivery) {
    const card = document.createElement('article');
    card.className = 'partnership-application-status';
    const title = document.createElement('h3');
    title.textContent = `${delivery.brandName} · ${delivery.tier} sponsorship`;
    card.appendChild(title);
    const state = document.createElement('p');
    state.textContent = `Report status: ${delivery.status || 'not submitted'}`;
    card.appendChild(state);
    if (delivery.status === 'verified') {
      const metrics = document.createElement('p');
      metrics.textContent = `Organizer-reported: ${Number(delivery.attendanceCount).toLocaleString('en-KE')} attendees · ${Number(delivery.checkInCount).toLocaleString('en-KE')} check-ins · ${Number(delivery.samplesRedeemed).toLocaleString('en-KE')} samples redeemed`;
      card.appendChild(metrics);
      if (delivery.otherDeliverables) {
        const other = document.createElement('p');
        other.textContent = `Other deliverables: ${delivery.otherDeliverables}`;
        card.appendChild(other);
      }
      const verified = document.createElement('p');
      verified.textContent = `Verified by ${delivery.verifiedBy || 'Valor Africa'} on ${new Date(delivery.verifiedAt).toLocaleString('en-KE')}. ${delivery.verificationNote || ''}`.trim();
      card.appendChild(verified);
      return card;
    }

    if (delivery.status === 'rejected' && delivery.verificationNote) {
      const note = document.createElement('p');
      note.textContent = `Valor review: ${delivery.verificationNote}`;
      card.appendChild(note);
    }
    const form = document.createElement('form');
    form.className = 'sponsor-delivery-form service-form';
    form.dataset.campaignId = delivery.campaignId;
    [
      ['Attendance', 'attendanceCount'],
      ['Check-ins', 'checkInCount'],
      ['Samples redeemed', 'samplesRedeemed']
    ].forEach(([labelText, name]) => {
      const label = document.createElement('label');
      label.textContent = labelText;
      const input = document.createElement('input');
      input.type = 'number';
      input.name = name;
      input.min = '0';
      input.max = '10000000';
      input.step = '1';
      input.value = delivery[name] ?? 0;
      input.required = true;
      label.appendChild(input);
      form.appendChild(label);
    });
    const otherLabel = document.createElement('label');
    otherLabel.textContent = 'Other agreed deliverables or notes';
    const otherInput = document.createElement('textarea');
    otherInput.name = 'otherDeliverables';
    otherInput.maxLength = 2000;
    otherInput.rows = 3;
    otherInput.value = delivery.otherDeliverables || '';
    otherLabel.appendChild(otherInput);
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'button button-primary';
    submit.textContent = delivery.status === 'rejected' ? 'Resubmit report' : 'Submit report for verification';
    const feedback = document.createElement('p');
    feedback.className = 'page-feedback';
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    form.append(otherLabel, submit, feedback);
    form.addEventListener('submit', async (submitEvent) => {
      submitEvent.preventDefault();
      submit.disabled = true;
      try {
        const values = new FormData(form);
        await window.valorEventsApi(`/api/events/mine/${encodeURIComponent(delivery.eventId)}/sponsorship-deliveries`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            campaignId: delivery.campaignId,
            attendanceCount: Number(values.get('attendanceCount')),
            checkInCount: Number(values.get('checkInCount')),
            samplesRedeemed: Number(values.get('samplesRedeemed')),
            otherDeliverables: values.get('otherDeliverables')
          })
        });
        await loadSponsorDeliveries(delivery.eventId, form.closest('.sponsor-deliveries-panel'));
      } catch (error) {
        feedback.textContent = error.message;
        feedback.classList.add('error');
        submit.disabled = false;
      }
    });
    card.appendChild(form);
    return card;
  }

  async function loadSponsorDeliveries(eventId, panel) {
    panel.replaceChildren();
    try {
      const result = await window.valorEventsApi(
        `/api/events/mine/${encodeURIComponent(eventId)}/sponsorship-deliveries`,
        { headers }
      );
      if (!result.deliveries.length) {
        const empty = document.createElement('p');
        empty.textContent = 'No sponsorship campaign is linked to this event. Ask the sponsor to add it in their campaign dashboard.';
        panel.appendChild(empty);
        return;
      }
      result.deliveries.forEach((delivery) => panel.appendChild(renderSponsorDelivery({
        ...delivery,
        eventId
      })));
    } catch (error) {
      const message = document.createElement('p');
      message.className = 'page-feedback error';
      message.textContent = error.message;
      panel.appendChild(message);
    }
  }

  async function loadEvents() {
    if (!token) {
      showSignIn('Sign in to manage events submitted from this account.');
      return;
    }
    try {
      const result = await window.valorEventsApi('/api/events/mine', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!result.events.length) {
        const text = document.createElement('p');
        text.textContent = 'You have not submitted any events from this account yet.';
        const link = document.createElement('a');
        link.href = 'host.html';
        link.className = 'button button-primary';
        link.textContent = 'Submit an event';
        root.replaceChildren(text, link);
        return;
      }

      const list = document.createElement('div');
      list.className = 'organizer-event-list';
      result.events.forEach((event) => {
        const card = document.createElement('article');
        card.className = `issued-ticket organizer-event-card${event.archived ? ' organizer-event-archived' : ''}`;
        const title = document.createElement('h2');
        title.textContent = event.title;
        const status = document.createElement('p');
        status.textContent = event.archived
          ? 'Status: Removed from public listings'
          : `Status: ${event.status === 'approved' ? 'Live' : event.status === 'rejected' ? 'Unpublished' : 'Awaiting review'}`;
        const details = document.createElement('p');
        details.textContent = `${formatDate(event.startsAt, event.timezone)} · ${event.location}`;
        const metrics = document.createElement('p');
        metrics.textContent = `Tickets sold: ${event.ticketsSold} · Checked in: ${event.checkedIn} · Gross sales: KES ${Number(event.grossKes).toLocaleString('en-KE')}`;
        card.append(title, status, details, metrics);
        if (Date.parse(event.endsAt) <= Date.now()) {
          const deliveryToggle = document.createElement('button');
          deliveryToggle.type = 'button';
          deliveryToggle.className = 'button secondary';
          deliveryToggle.textContent = 'Report sponsor deliverables';
          const deliveryPanel = document.createElement('div');
          deliveryPanel.className = 'sponsor-deliveries-panel';
          deliveryPanel.hidden = true;
          deliveryToggle.addEventListener('click', async () => {
            deliveryPanel.hidden = !deliveryPanel.hidden;
            deliveryToggle.textContent = deliveryPanel.hidden
              ? 'Report sponsor deliverables'
              : 'Hide sponsor deliverables';
            if (!deliveryPanel.hidden) await loadSponsorDeliveries(event.id, deliveryPanel);
          });
          card.append(deliveryToggle, deliveryPanel);
        }
        const adAnalyticsToggle = document.createElement('button');
        adAnalyticsToggle.type = 'button';
        adAnalyticsToggle.className = 'button secondary ad-analytics-toggle';
        adAnalyticsToggle.textContent = 'View ad analytics';
        const adAnalyticsPanel = document.createElement('div');
        adAnalyticsPanel.className = 'ad-analytics-panel';
        adAnalyticsPanel.hidden = true;
        let adAnalyticsLoaded = false;
        adAnalyticsToggle.addEventListener('click', async () => {
          adAnalyticsPanel.hidden = !adAnalyticsPanel.hidden;
          adAnalyticsToggle.textContent = adAnalyticsPanel.hidden ? 'View ad analytics' : 'Hide ad analytics';
          if (!adAnalyticsPanel.hidden && !adAnalyticsLoaded) {
            adAnalyticsLoaded = true;
            await loadAdAnalytics(event.id, adAnalyticsPanel);
          }
        });
        card.append(adAnalyticsToggle, adAnalyticsPanel);
        if (event.hasActiveOrders || event.hasActivePromotion) {
          const promotionNote = document.createElement('p');
          promotionNote.textContent = event.hasActiveOrders && event.hasActivePromotion
            ? 'This event has ticket orders and an active or pending promotion. Contact Valor Africa support to edit or remove it.'
            : event.hasActiveOrders
              ? 'This event has ticket orders in progress or tickets sold. Contact Valor Africa support to edit or remove it.'
              : 'This event has an active or pending promotion. Contact Valor Africa support to edit or remove it.';
          card.appendChild(promotionNote);
        }
        if (event.reviewNote) {
          const review = document.createElement('p');
          review.textContent = `Review note: ${event.reviewNote}`;
          card.appendChild(review);
        }
        if (!event.archived && event.status === 'approved') {
          const link = document.createElement('a');
          link.href = `event.html?slug=${encodeURIComponent(event.slug)}`;
          link.textContent = 'View event page';
          card.appendChild(link);
        }
        if (!event.archived && !event.hasActiveOrders && !event.hasActivePromotion) {
          const actions = document.createElement('div');
          actions.className = 'organizer-event-actions';
          if (Date.parse(event.startsAt) > Date.now()) {
            const edit = document.createElement('a');
            edit.href = `host.html?editEvent=${encodeURIComponent(event.id)}`;
            edit.className = 'button button-primary';
            edit.textContent = 'Edit event';
            actions.appendChild(edit);
          }
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'button secondary';
          remove.textContent = 'Delete event';
          remove.addEventListener('click', async () => {
            if (!window.confirm(`Remove “${event.title}” from public listings? This action cannot be undone.`)) return;
            remove.disabled = true;
            try {
              await window.valorEventsApi(`/api/events/mine/${encodeURIComponent(event.id)}`, {
                method: 'DELETE',
                headers
              });
              await loadEvents();
            } catch (error) {
              remove.disabled = false;
              const feedback = document.createElement('p');
              feedback.className = 'page-feedback error';
              feedback.textContent = error.message;
              card.appendChild(feedback);
            }
          });
          actions.appendChild(remove);
          card.appendChild(actions);
        }
        list.appendChild(card);
      });
      root.replaceChildren(list);
    } catch (error) {
      if (/sign in|session has expired/i.test(error.message)) {
        window.valorClearAccountToken();
        showSignIn('Your session has expired.');
      } else {
        root.textContent = error.message;
        root.classList.add('error');
      }
    }
  }

  loadEvents();
})();
