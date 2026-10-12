(function () {
  'use strict';
  const api = window.valorEventsApi;
  const escapeDate = (value) => new Date(value).toLocaleString('en-KE', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Nairobi' });
  const saveAccess = (order) => window.sessionStorage.setItem(`valor-order-${order.orderId}`, order.accessToken);

  function showError(element, message) {
    element.textContent = message;
    element.classList.add('error');
  }

  async function loadEventDetails() {
    const root = document.getElementById('eventDetails');
    if (!root) return;
    try {
      const slug = new URLSearchParams(window.location.search).get('slug');
      if (!slug) throw new Error('This event link is incomplete.');
      const { event } = await api(`/api/events/by-slug/${encodeURIComponent(slug)}`);
      const heading = document.createElement('h1');
      heading.textContent = event.title;
      const meta = document.createElement('p');
      meta.className = 'service-meta';
      meta.textContent = `${event.category} · ${event.location} · ${escapeDate(event.startsAt)}`;
      const description = document.createElement('p');
      description.textContent = event.description;
      const image = document.createElement('img');
      image.className = 'service-poster';
      image.src = event.poster ? new URL(event.poster, window.valorEventsApiBase).href : 'images/events/concert-crowd.svg';
      image.alt = `${event.title} poster`;
      const tickets = document.createElement('ul');
      tickets.className = 'service-ticket-list';
      event.tickets.forEach((ticket) => {
        const item = document.createElement('li');
        item.textContent = `${ticket.name}: KES ${Number(ticket.price).toLocaleString('en-KE')}`;
        tickets.appendChild(item);
      });
      root.replaceChildren(image, heading, meta, description, tickets);
      const form = document.getElementById('eventTicketForm');
      const select = form.elements.ticketType;
      select.replaceChildren(...event.tickets.map((ticket) => new Option(
        `${ticket.name} · KES ${Number(ticket.price).toLocaleString('en-KE')}`,
        ticket.name
      )));
      form.hidden = false;
      const health = await api('/api/health');
      const hasFreeTickets = event.tickets.some((ticket) => Number(ticket.price) === 0);
      if (!health.paymentsConfigured) {
        event.tickets.forEach((ticket) => {
          if (Number(ticket.price) > 0) {
            const option = Array.from(select.options).find((entry) => entry.value === ticket.name);
            if (option) option.disabled = true;
          }
        });
        const freeTicket = event.tickets.find((ticket) => Number(ticket.price) === 0);
        if (freeTicket) select.value = freeTicket.name;
      }
      if (!health.paymentsConfigured && !hasFreeTickets) {
        const button = form.querySelector('[type=submit]');
        button.disabled = true;
        showError(document.getElementById('pageFeedback'), 'M-Pesa checkout is not available yet. Valor Africa must configure Daraja and a public HTTPS callback.');
      } else if (!health.paymentsConfigured) {
        document.getElementById('pageFeedback').textContent = 'M-Pesa is unavailable; free ticket registration remains open.';
      }
      form.addEventListener('submit', async (submitEvent) => {
        submitEvent.preventDefault();
        const button = form.querySelector('[type=submit]');
        button.disabled = true;
        await startCheckout('/api/orders/tickets', {
          eventId: event.id,
          ticketType: select.value,
          quantity: Number(form.elements.quantity.value),
          buyerName: form.elements.buyerName.value,
          phone: form.elements.phone.value
        }, document.getElementById('pageFeedback'));
        button.disabled = false;
      });
    } catch (error) {
      root.textContent = error.message;
      root.classList.add('error');
    }
  }

  async function startCheckout(url, values, feedback) {
    try {
      const order = await api(url, { method: 'POST', body: JSON.stringify(values) });
      saveAccess(order);
      window.location.assign(`order.html?orderId=${encodeURIComponent(order.orderId)}`);
    } catch (error) {
      showError(feedback, error.message);
    }
  }

  function setupAdBooking() {
    const form = document.getElementById('adBookingForm');
    if (!form) return;
    const feedback = document.getElementById('pageFeedback');
    const eventSelect = form.elements.eventId;
    const packageSelect = form.elements.packageId;
    (async () => {
      const [eventResponse, packageResponse, health] = await Promise.all([
        api('/api/events'),
        api('/api/ads/packages'),
        api('/api/health')
      ]);
      eventSelect.replaceChildren(new Option('Choose your approved event', ''));
      eventResponse.events.forEach((event) => eventSelect.add(new Option(event.title, event.id)));
      packageSelect.replaceChildren(new Option('Choose an ad package', ''));
      packageResponse.packages.forEach((item) => packageSelect.add(
        new Option(`${item.name} · ${item.durationDays} days · KES ${Number(item.priceKes).toLocaleString('en-KE')}`, item.id)
      ));
      if (!health.paymentsConfigured) {
        form.querySelector('button[type=submit]').disabled = true;
        showError(feedback, 'Ad checkout is not available yet. Valor Africa must configure M-Pesa Daraja and a public HTTPS callback.');
      }
    })().catch((error) => showError(feedback, error.message));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      feedback.classList.remove('error');
      startCheckout('/api/orders/ads', Object.fromEntries(new FormData(form)), feedback);
    });
  }

  async function loadOrder() {
    const root = document.getElementById('orderStatus');
    if (!root) return;
    const orderId = new URLSearchParams(window.location.search).get('orderId');
    const token = orderId && window.sessionStorage.getItem(`valor-order-${orderId}`);
    if (!orderId || !token) {
      root.replaceChildren();
      const heading = document.createElement('h1');
      heading.textContent = 'Order link unavailable';
      const text = document.createElement('p');
      text.textContent = 'Open this page on the same browser used to start checkout, or contact Valor Africa support with your order details.';
      root.append(heading, text);
      return;
    }
    try {
      const order = await api(`/api/orders/${encodeURIComponent(orderId)}`, { headers: { 'X-Order-Access': token } });
      const heading = document.createElement('h1');
      heading.textContent = order.status === 'paid' ? 'Payment confirmed' : order.status === 'confirmed' ? 'Free registration confirmed' : order.status === 'failed' ? 'Payment not completed' : order.status === 'review' ? 'Payment needs support review' : 'Waiting for M-Pesa payment';
      const details = document.createElement('p');
      details.textContent = `${order.orderType === 'ticket' ? `${order.quantity} ${order.ticketType} ticket(s)` : `Advertising: ${order.campaign?.packageName || 'Event promotion'}`} · KES ${Number(order.amountKes).toLocaleString('en-KE')}${order.receipt ? ` · Receipt ${order.receipt}` : ''}`;
      root.replaceChildren(heading, details);
      if (order.status === 'pending') {
        const explanation = document.createElement('p');
        explanation.textContent = 'Approve the payment prompt on your phone. This page checks for confirmation automatically.';
        root.appendChild(explanation);
        window.setTimeout(loadOrder, 5000);
      } else if (['paid','confirmed'].includes(order.status) && order.tickets?.length) {
        order.tickets.forEach((ticket) => {
          const section = document.createElement('article');
          section.className = 'issued-ticket';
          const title = document.createElement('h2');
          title.textContent = `${ticket.eventTitle} · ${ticket.ticketType}`;
          const info = document.createElement('p');
          info.textContent = `${escapeDate(ticket.startsAt)} · ${ticket.venueName || ticket.city} · Ticket ${ticket.code}`;
          const qr = document.createElement('img');
          qr.src = ticket.qr;
          qr.alt = `QR entry pass for ${ticket.eventTitle}`;
          section.append(title, info, qr);
          root.appendChild(section);
        });
      } else if (order.status === 'paid' && order.campaign) {
        const campaign = document.createElement('p');
        campaign.textContent = `${order.campaign.eventTitle} promotion is active until ${new Date(order.campaign.endsAt).toLocaleString('en-KE')}.`;
        root.appendChild(campaign);
      }
      if (order.resultDescription) {
        const message = document.createElement('p');
        message.textContent = order.resultDescription;
        root.appendChild(message);
      }
    } catch (error) {
      root.replaceChildren();
      showError(root, error.message);
    }
  }

  async function loadTicket() {
    const root = document.getElementById('ticketStatus');
    if (!root) return;
    const code = new URLSearchParams(window.location.search).get('code');
    if (!code) return showError(root, 'Ticket code is missing.');
    try {
      const ticket = await api(`/api/tickets/${encodeURIComponent(code)}/verify`);
      const heading = document.createElement('h1');
      heading.textContent = 'Valid ticket';
      const event = document.createElement('h2');
      event.textContent = ticket.eventTitle;
      const details = document.createElement('p');
      details.textContent = `${ticket.ticketType} · ${escapeDate(ticket.startsAt)} · ${ticket.venueName || ticket.city}`;
      const codeText = document.createElement('p');
      codeText.textContent = `Ticket code: ${ticket.code}`;
      const checkedIn = document.createElement('p');
      checkedIn.textContent = ticket.checkedInAt ? `Already checked in at ${new Date(ticket.checkedInAt).toLocaleString('en-KE')}.` : 'Ready for event check-in.';
      root.replaceChildren(heading, event, details, codeText, checkedIn);
    } catch (error) {
      root.replaceChildren();
      showError(root, error.message);
    }
  }

  loadEventDetails();
  setupAdBooking();
  loadOrder();
  loadTicket();
})();
