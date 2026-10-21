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
      const params = new URLSearchParams(window.location.search);
      const slug = params.get('slug');
      const previewId = params.get('preview');
      const sharedEvent = params.get('share');
      let event;
      if (slug) {
        ({ event } = await api(`/api/events/by-slug/${encodeURIComponent(slug)}`));
      } else if (sharedEvent) {
        event = JSON.parse(sharedEvent);
        if (!event || typeof event.title !== 'string' || !Array.isArray(event.tickets)) {
          throw new Error('This shared event link is invalid.');
        }
      } else if (previewId) {
        const preview = window.sessionStorage.getItem(`valor-preview-event-${previewId}`);
        if (!preview) throw new Error('This event preview has expired. Browse events and select it again.');
        event = JSON.parse(preview);
      } else {
        throw new Error('This event link is incomplete.');
      }
      root.classList.add('event-detail-card');
      document.title = `${event.title} | Valor Africa Events`;
      const heading = document.createElement('h1');
      heading.textContent = event.title;
      const copy = document.createElement('div');
      copy.className = 'event-detail-copy';
      const categories = document.createElement('div');
      categories.className = 'event-detail-categories';
      [event.category, ...(event.tags || [])].filter(Boolean).slice(0, 4).forEach((category) => {
        const tag = document.createElement('span');
        tag.textContent = category;
        categories.appendChild(tag);
      });
      const details = document.createElement('div');
      details.className = 'event-detail-facts';
      const addFact = (label, value) => {
        if (!value) return;
        const fact = document.createElement('div');
        fact.className = 'event-detail-fact';
        const title = document.createElement('span');
        title.textContent = label;
        const text = document.createElement('strong');
        text.textContent = value;
        fact.append(title, text);
        details.appendChild(fact);
      };
      const timeZone = event.timezone || 'Africa/Nairobi';
      const start = new Date(event.startsAt);
      const end = event.endsAt ? new Date(event.endsAt) : null;
      const formatDate = (date) => new Intl.DateTimeFormat('en-KE', {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone
      }).format(date);
      const startDateLabel = formatDate(start);
      const endDateLabel = end && formatDate(end);
      const dateLabel = endDateLabel && endDateLabel !== startDateLabel
        ? `${startDateLabel} to ${endDateLabel}`
        : startDateLabel;
      const timeLabel = new Intl.DateTimeFormat('en-KE', {
        hour: 'numeric', minute: '2-digit', timeZone
      }).format(start);
      const endTimeLabel = end && new Intl.DateTimeFormat('en-KE', {
        hour: 'numeric', minute: '2-digit', timeZone
      }).format(end);
      addFact('Date', dateLabel);
      addFact('Time', endTimeLabel ? `${timeLabel} – ${endTimeLabel}` : timeLabel);
      addFact('Venue', event.location);
      const description = document.createElement('p');
      description.className = 'event-detail-description';
      description.textContent = event.description;
      const image = document.createElement('img');
      image.className = 'event-detail-poster';
      image.src = event.poster
        ? new URL(event.poster, window.valorEventsApiBase || window.location.href).href
        : 'images/events/concert-crowd.svg';
      image.alt = `${event.title} poster`;
      const posterWrap = document.createElement('div');
      posterWrap.className = 'event-detail-poster-wrap';
      posterWrap.appendChild(image);
      const tickets = document.createElement('ul');
      tickets.className = 'event-detail-ticket-list';
      const priceLabel = document.createElement('div');
      priceLabel.className = 'event-detail-price';
      const priceCaption = document.createElement('span');
      priceCaption.textContent = 'Tickets from';
      if (event.tickets.length) {
        const lowestPrice = Math.min(...event.tickets.map((ticket) => Number(ticket.price)));
        const price = document.createElement('strong');
        price.textContent = new Intl.NumberFormat('en-KE', {
          style: 'currency',
          currency: event.tickets[0].currency || 'KES',
          maximumFractionDigits: 0
        }).format(lowestPrice);
        priceLabel.append(priceCaption, price);
      }
      event.tickets.forEach((ticket) => {
        const item = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = ticket.name;
        const amount = document.createElement('strong');
        amount.textContent = new Intl.NumberFormat('en-KE', {
          style: 'currency',
          currency: ticket.currency || 'KES',
          maximumFractionDigits: 0
        }).format(Number(ticket.price));
        item.append(name, amount);
        tickets.appendChild(item);
      });
      const bookLink = document.createElement('a');
      bookLink.className = 'button button-primary event-detail-book';
      bookLink.href = '#eventTicketForm';
      bookLink.textContent = 'Book tickets';
      const secureNote = document.createElement('p');
      secureNote.className = 'event-detail-secure-note';
      secureNote.textContent = 'Secure checkout · Tickets are confirmed after payment.';
      copy.append(categories, heading, details, priceLabel, tickets);
      if (slug) copy.append(bookLink, secureNote);
      else {
        const previewNote = document.createElement('p');
        previewNote.className = 'event-detail-secure-note';
        previewNote.textContent = 'This is a preview listing. Ticket checkout is available for events published through Valor Africa.';
        copy.appendChild(previewNote);
      }
      copy.appendChild(description);
      const layout = document.createElement('div');
      layout.className = 'event-detail-layout';
      layout.append(posterWrap, copy);
      root.replaceChildren(layout);
      if (!slug) return;
      const form = document.getElementById('eventTicketForm');
      const select = form.elements.ticketType;
      select.replaceChildren(...event.tickets.map((ticket) => new Option(
        `${ticket.name} · ${new Intl.NumberFormat('en-KE', {
          style: 'currency',
          currency: ticket.currency || 'KES',
          maximumFractionDigits: 0
        }).format(Number(ticket.price))}`,
        ticket.name
      )));
      form.hidden = false;
      const health = await api('/api/health');
      const stripePaymentsConfigured = Boolean(health.stripePaymentsConfigured);
      const stripeOption = form.elements.paymentMethod.querySelector('option[value="stripe"]');
      stripeOption.disabled = !stripePaymentsConfigured;
      stripeOption.textContent = stripePaymentsConfigured ? 'Card (Stripe Checkout)' : 'Card (Stripe Checkout; coming soon)';
      const anyCardPaymentConfigured = Boolean(health.paymentsConfigured || stripePaymentsConfigured);
      const hasFreeTickets = event.tickets.some((ticket) => Number(ticket.price) === 0);
      const accountToken = window.sessionStorage.getItem('valor-account-token');
      if (!anyCardPaymentConfigured) {
        event.tickets.forEach((ticket) => {
          if (Number(ticket.price) > 0 && !accountToken) {
            const option = Array.from(select.options).find((entry) => entry.value === ticket.name);
            if (option) option.disabled = true;
          }
        });
        const freeTicket = event.tickets.find((ticket) => Number(ticket.price) === 0);
        if (freeTicket) select.value = freeTicket.name;
      }
      if (!anyCardPaymentConfigured && !hasFreeTickets && !accountToken) {
        const button = form.querySelector('[type=submit]');
        button.disabled = true;
        showError(document.getElementById('pageFeedback'), 'Paid checkout is not available yet. Please try again later or use a funded wallet after signing in.');
      } else if (!anyCardPaymentConfigured) {
        document.getElementById('pageFeedback').textContent = 'M-Pesa and Stripe are unavailable; free registration and funded Valor Wallet payments remain available.';
      }
      const paymentMethod = form.elements.paymentMethod;
      const phoneInput = form.elements.phone;
      const updatePaymentFields = () => {
        const usesWallet = paymentMethod.value === 'wallet';
        const usesStripe = paymentMethod.value === 'stripe';
        phoneInput.required = !usesWallet;
        phoneInput.disabled = usesWallet;
        const phoneLabel = phoneInput.closest('label');
        if (phoneLabel) phoneLabel.firstChild.textContent = usesWallet ? 'M-Pesa number (not needed for wallet)' : usesStripe ? 'Contact phone number' : 'Safaricom M-Pesa number';
        form.querySelector('[type=submit]').textContent = `Pay with ${usesWallet ? 'Valor Wallet' : usesStripe ? 'Stripe Checkout' : 'M-Pesa'}`;
      };
      paymentMethod.addEventListener('change', updatePaymentFields);
      updatePaymentFields();
      form.addEventListener('submit', async (submitEvent) => {
        submitEvent.preventDefault();
        const button = form.querySelector('[type=submit]');
        button.disabled = true;
        const selectedMethod = paymentMethod.value;
        const currentAccountToken = window.sessionStorage.getItem('valor-account-token');
        if (!currentAccountToken) {
          const feedback = document.getElementById('pageFeedback');
          feedback.replaceChildren(document.createTextNode('Sign in to your account before getting tickets. '));
          const link = document.createElement('a');
          const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
          link.href = `account.html?returnTo=${encodeURIComponent(returnTo)}`;
          link.textContent = 'Sign in to continue';
          feedback.appendChild(link);
          feedback.classList.add('error');
          button.disabled = false;
          return;
        }
        if (selectedMethod === 'mpesa' && !health.paymentsConfigured) {
          showError(document.getElementById('pageFeedback'), 'M-Pesa checkout is not configured yet. Choose Stripe Checkout or Valor Wallet.');
          button.disabled = false;
          return;
        }
        if (selectedMethod === 'stripe' && !stripePaymentsConfigured) {
          showError(document.getElementById('pageFeedback'), 'Stripe Checkout is not configured yet. Choose M-Pesa or Valor Wallet.');
          button.disabled = false;
          return;
        }
        await startCheckout('/api/orders/tickets', {
          eventId: event.id,
          ticketType: select.value,
          quantity: Number(form.elements.quantity.value),
          buyerName: form.elements.buyerName.value,
          phone: form.elements.phone.value,
          paymentMethod: selectedMethod
        }, document.getElementById('pageFeedback'), currentAccountToken);
        button.disabled = false;
      });
    } catch (error) {
      root.textContent = error.message;
      root.classList.add('error');
    }
  }

  async function startCheckout(url, values, feedback, walletToken = '') {
    try {
      const headers = walletToken ? { Authorization: `Bearer ${walletToken}` } : {};
      const order = await api(url, { method: 'POST', headers, body: JSON.stringify(values) });
      saveAccess(order);
      window.location.assign(order.checkoutUrl || `order.html?orderId=${encodeURIComponent(order.orderId)}`);
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
    const paymentMethod = form.elements.paymentMethod;
    const phoneInput = form.elements.phone;
    let paymentsConfigured = false;
    const updatePaymentFields = () => {
      const usesWallet = paymentMethod.value === 'wallet';
      phoneInput.required = !usesWallet;
      phoneInput.disabled = usesWallet;
      form.querySelector('button[type=submit]').textContent = `Pay with ${usesWallet ? 'Valor Wallet' : 'M-Pesa'}`;
    };
    paymentMethod.addEventListener('change', updatePaymentFields);
    updatePaymentFields();
    (async () => {
      const [eventResponse, packageResponse, health] = await Promise.all([
        api('/api/events'),
        api('/api/ads/packages'),
        api('/api/health')
      ]);
      paymentsConfigured = Boolean(health.paymentsConfigured);
      eventSelect.replaceChildren(new Option('Choose your approved event', ''));
      eventResponse.events.forEach((event) => eventSelect.add(new Option(event.title, event.id)));
      packageSelect.replaceChildren(new Option('Choose an ad package', ''));
      packageResponse.packages.forEach((item) => packageSelect.add(
        new Option(`${item.name} · ${item.durationDays} days · KES ${Number(item.priceKes).toLocaleString('en-KE')}`, item.id)
      ));
      if (!paymentsConfigured) {
        feedback.textContent = 'M-Pesa is unavailable. You can still pay from an existing funded wallet.';
      }
    })().catch((error) => showError(feedback, error.message));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      feedback.classList.remove('error');
      const values = Object.fromEntries(new FormData(form));
      const token = window.sessionStorage.getItem('valor-account-token');
      if (values.paymentMethod === 'wallet' && !token) {
        showError(feedback, 'Sign in to your account and link a phone wallet before paying with your balance.');
        return;
      }
      if (values.paymentMethod === 'mpesa' && !paymentsConfigured) {
        showError(feedback, 'M-Pesa checkout is not available yet. Choose Valor Wallet or try again later.');
        return;
      }
      if (values.paymentMethod === 'mpesa' && !window.valorEventsApiBase) {
        showError(feedback, 'Ad checkout is not connected to the Valor Africa event service yet.');
        return;
      }
      const button = form.querySelector('button[type=submit]');
      button.disabled = true;
      startCheckout('/api/orders/ads', values, feedback, token).finally(() => { button.disabled = false; });
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
      const headers = new Headers({ 'X-Order-Access': token });
      const accountToken = window.sessionStorage.getItem('valor-account-token');
      if (accountToken) headers.set('Authorization', `Bearer ${accountToken}`);
      const order = await api(`/api/orders/${encodeURIComponent(orderId)}`, { headers });
      const heading = document.createElement('h1');
      heading.textContent = order.status === 'paid' ? 'Payment confirmed' : order.status === 'confirmed' ? 'Free registration confirmed' : order.status === 'failed' ? 'Payment not completed' : order.status === 'review' ? 'Payment needs support review' : order.paymentMethod === 'stripe' ? 'Waiting for Stripe payment confirmation' : 'Waiting for M-Pesa payment';
      const details = document.createElement('p');
      details.textContent = `${order.orderType === 'ticket' ? `${order.quantity} ${order.ticketType} ticket(s)` : `Advertising: ${order.campaign?.packageName || 'Event promotion'}`} · KES ${Number(order.amountKes).toLocaleString('en-KE')}${order.receipt ? ` · Receipt ${order.receipt}` : ''}`;
      root.replaceChildren(heading, details);
      if (order.status === 'pending') {
        const explanation = document.createElement('p');
        explanation.textContent = order.paymentMethod === 'stripe'
          ? 'Complete payment in Stripe Checkout. This page checks for confirmation automatically.'
          : 'Approve the payment prompt on your phone. This page checks for confirmation automatically.';
        root.appendChild(explanation);
        window.setTimeout(loadOrder, order.paymentMethod === 'stripe' ? 2500 : 5000);
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

  async function loadMyTickets() {
    const root = document.getElementById('myTickets');
    if (!root) return;
    const token = window.sessionStorage.getItem('valor-account-token');
    if (!token) {
      root.replaceChildren();
      showError(root, 'Sign in to view your tickets. ');
      const link = document.createElement('a');
      link.href = `account.html?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`;
      link.textContent = 'Sign in';
      root.appendChild(link);
      return;
    }
    try {
      const result = await api('/api/account/tickets', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!result.tickets.length) {
        const message = document.createElement('p');
        message.textContent = 'You do not have any confirmed tickets yet.';
        const link = document.createElement('a');
        link.href = 'events.html';
        link.textContent = 'Browse events';
        root.replaceChildren(message, link);
        return;
      }
      const fragment = document.createDocumentFragment();
      const emailNotices = new Set();
      result.tickets.forEach((ticket) => {
        const section = document.createElement('article');
        section.className = 'issued-ticket';
        const title = document.createElement('h2');
        title.textContent = `${ticket.eventTitle} · ${ticket.ticketType}`;
        const details = document.createElement('p');
        details.textContent = `${new Intl.DateTimeFormat('en-KE', {
          dateStyle: 'full',
          timeStyle: 'short',
          timeZone: ticket.timezone
        }).format(new Date(ticket.startsAt))} · ${ticket.venueName || ticket.city}`;
        const code = document.createElement('p');
        code.textContent = `Ticket ${ticket.code}`;
        const qr = document.createElement('img');
        qr.src = ticket.qr;
        qr.alt = `QR entry pass for ${ticket.eventTitle}`;
        const eventLink = document.createElement('a');
        eventLink.href = `event.html?slug=${encodeURIComponent(ticket.eventSlug)}`;
        eventLink.textContent = 'Event details';
        section.append(title, details, code, qr, eventLink);
        if (['not_sent','sending','failed'].includes(ticket.ticketEmailStatus) && !emailNotices.has(ticket.orderId)) {
          const notice = document.createElement('p');
          notice.textContent = 'Your QR pass is available here. The confirmation email is pending delivery.';
          section.appendChild(notice);
          emailNotices.add(ticket.orderId);
        }
        fragment.appendChild(section);
      });
      root.replaceChildren(fragment);
    } catch (error) {
      if (/sign in|session has expired/i.test(error.message)) {
        window.sessionStorage.removeItem('valor-account-token');
        root.replaceChildren();
        showError(root, 'Your session has expired. ');
        const link = document.createElement('a');
        link.href = `account.html?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`;
        link.textContent = 'Sign in again';
        root.appendChild(link);
      } else {
        root.replaceChildren();
        showError(root, error.message);
      }
    }
  }

  loadEventDetails();
  setupAdBooking();
  loadOrder();
  loadTicket();
  loadMyTickets();
})();
