(function () {
  'use strict';
  const api = window.valorEventsApi;
  const escapeDate = (value) => new Date(value).toLocaleString('en-KE', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Nairobi' });
  const saveAccess = (order) => window.sessionStorage.setItem(`valor-order-${order.orderId}`, order.accessToken);

  function showError(element, message) {
    element.textContent = message;
    element.classList.add('error');
  }

  function createTicketFeedback(ticket) {
    const feedback = document.createElement('section');
    feedback.className = 'ticket-feedback';
    feedback.setAttribute('aria-label', `Feedback for ${ticket.eventTitle}`);

    const loveButton = document.createElement('button');
    loveButton.type = 'button';
    loveButton.className = 'ticket-love';
    loveButton.setAttribute('aria-pressed', String(Boolean(ticket.loved)));
    loveButton.setAttribute('aria-label', ticket.loved ? 'Remove love for this event' : 'Show that you loved this event');
    const heart = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    heart.setAttribute('viewBox', '0 0 24 24');
    heart.setAttribute('aria-hidden', 'true');
    heart.classList.add('ticket-love-icon');
    const heartPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    heartPath.setAttribute('d', 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z');
    heart.appendChild(heartPath);
    const loveText = document.createElement('span');
    loveText.textContent = ticket.loved ? 'You loved this event' : 'I loved this event';
    loveButton.append(heart, loveText);

    const reviewForm = document.createElement('form');
    reviewForm.className = 'ticket-review-form';
    const reviewHeading = document.createElement('h3');
    reviewHeading.textContent = 'Leave a review';
    const ratingLabel = document.createElement('label');
    ratingLabel.textContent = 'Rating (optional)';
    const ratingSelect = document.createElement('select');
    ratingSelect.name = 'rating';
    ratingSelect.setAttribute('aria-label', 'Event rating');
    ratingSelect.add(new Option('Choose a rating', ''));
    for (let rating = 5; rating >= 1; rating -= 1) {
      ratingSelect.add(new Option(`${rating} ${rating === 1 ? 'star' : 'stars'}`, String(rating)));
    }
    if (ticket.rating) ratingSelect.value = String(ticket.rating);
    ratingLabel.appendChild(ratingSelect);

    const reviewLabel = document.createElement('label');
    reviewLabel.textContent = 'Your review (optional)';
    const reviewInput = document.createElement('textarea');
    reviewInput.name = 'review';
    reviewInput.maxLength = 1200;
    reviewInput.rows = 3;
    reviewInput.placeholder = 'What did you think of the event?';
    reviewInput.value = ticket.review || '';
    reviewLabel.appendChild(reviewInput);

    const saveButton = document.createElement('button');
    saveButton.type = 'submit';
    saveButton.className = 'button button-primary';
    saveButton.textContent = 'Save feedback';
    const status = document.createElement('p');
    status.className = 'ticket-feedback-status';
    status.setAttribute('role', 'status');
    reviewForm.append(reviewHeading, ratingLabel, reviewLabel, saveButton, status);

    const saveFeedback = async (loved, successMessage) => {
      loveButton.disabled = true;
      saveButton.disabled = true;
      status.classList.remove('error');
      status.textContent = '';
      try {
        const saved = await api(`/api/account/events/${encodeURIComponent(ticket.eventId)}/feedback`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${window.valorAccountToken()}` },
          body: JSON.stringify({
            loved,
            rating: ratingSelect.value ? Number(ratingSelect.value) : null,
            review: reviewInput.value
          })
        });
        loveButton.setAttribute('aria-pressed', String(saved.loved));
        loveButton.setAttribute('aria-label', saved.loved ? 'Remove love for this event' : 'Show that you loved this event');
        loveText.textContent = saved.loved ? 'You loved this event' : 'I loved this event';
        status.textContent = successMessage(saved);
      } catch (error) {
        status.textContent = error.message;
        status.classList.add('error');
      } finally {
        loveButton.disabled = false;
        saveButton.disabled = false;
      }
    };

    loveButton.addEventListener('click', () => {
      const loved = loveButton.getAttribute('aria-pressed') !== 'true';
      saveFeedback(loved, (saved) => saved.loved ? 'Thanks for sharing the love!' : 'Your love was removed.');
    });
    reviewForm.addEventListener('submit', (submitEvent) => {
      submitEvent.preventDefault();
      saveFeedback(loveButton.getAttribute('aria-pressed') === 'true', () => 'Your feedback has been saved.');
    });
    feedback.append(loveButton, reviewForm);
    return feedback;
  }

  function loadEventFeedback(event) {
    if (!event.id) return;
    const token = window.valorAccountToken();
    const root = document.querySelector('.event-detail-poster-wrap') || document.getElementById('eventDetails');
    if (!token) {
      const signIn = document.createElement('a');
      signIn.className = 'ticket-love event-detail-love';
      signIn.href = 'account.html?returnTo=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
      signIn.textContent = '♡ Favorite this event';
      root.appendChild(signIn);
      return;
    }
    const status = document.createElement('p');
    status.className = 'ticket-feedback-status';
    status.setAttribute('role', 'status');
    status.textContent = 'Loading your event feedback…';
    root.appendChild(status);
    api('/api/account/events/' + encodeURIComponent(event.id) + '/feedback', { headers: { Authorization: 'Bearer ' + token } }).then((saved) => {
      status.remove();
      const feedback = createTicketFeedback({ eventId: event.id, eventTitle: event.title, loved: saved.loved, rating: saved.rating, review: saved.review });
      feedback.classList.add('event-detail-feedback');
      root.appendChild(feedback);
    }).catch((error) => { status.textContent = error.message; status.classList.add('error'); });
  }  async function loadEventDetails() {
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
      const isPublishedEvent = Boolean(slug);
      const eventDescription = event.description || `Event details and tickets for ${event.title} on Valor Africa Events.`;
      const canonical = new URL('event.html', window.location.href);
      if (isPublishedEvent) canonical.searchParams.set('slug', slug);
      const setMeta = (selector, name, content) => {
        let element = document.head.querySelector(selector);
        if (!element) {
          element = document.createElement('meta');
          element.name = name;
          document.head.appendChild(element);
        }
        element.content = content;
      };
      setMeta('meta[name="description"]', 'description', eventDescription);
      setMeta('meta[name="robots"]', 'robots', isPublishedEvent ? 'index, follow' : 'noindex, nofollow');
      if (isPublishedEvent) {
        let canonicalLink = document.head.querySelector('link[rel="canonical"]');
        if (!canonicalLink) {
          canonicalLink = document.createElement('link');
          canonicalLink.rel = 'canonical';
          document.head.appendChild(canonicalLink);
        }
        canonicalLink.href = canonical.href;

        const setOpenGraph = (property, content) => {
          let element = document.head.querySelector(`meta[property="${property}"]`);
          if (!element) {
            element = document.createElement('meta');
            element.setAttribute('property', property);
            document.head.appendChild(element);
          }
          element.content = content;
        };
        setOpenGraph('og:type', 'event');
        setOpenGraph('og:title', document.title);
        setOpenGraph('og:description', eventDescription);
        setOpenGraph('og:url', canonical.href);
        if (event.poster) {
          setOpenGraph('og:image', new URL(event.poster, window.valorEventsApiBase || window.location.href).href);
        }

        const physicalLocation = {
          '@type': 'Place',
          name: event.venueName || event.location,
          address: {
            '@type': 'PostalAddress',
            streetAddress: event.venueName || event.location,
            addressLocality: event.city || event.location,
            addressCountry: 'KE'
          }
        };
        const virtualLocation = {
          '@type': 'VirtualLocation',
          url: canonical.href
        };
        const format = String(event.format || 'Physical').toLowerCase();
        const eventSchema = {
          '@context': 'https://schema.org',
          '@type': 'Event',
          name: event.title,
          description: eventDescription,
          startDate: new Date(event.startsAt).toISOString(),
          eventStatus: 'https://schema.org/EventScheduled',
          eventAttendanceMode: format === 'virtual'
            ? 'https://schema.org/OnlineEventAttendanceMode'
            : format === 'hybrid'
              ? 'https://schema.org/MixedEventAttendanceMode'
              : 'https://schema.org/OfflineEventAttendanceMode',
          location: format === 'virtual'
            ? virtualLocation
            : format === 'hybrid'
              ? [physicalLocation, virtualLocation]
              : physicalLocation,
          organizer: {
            '@type': 'Organization',
            name: 'Valor Africa Events',
            url: 'https://valorafrica.co.ke/'
          },
          url: canonical.href
        };
        if (event.endsAt) eventSchema.endDate = new Date(event.endsAt).toISOString();
        eventSchema.image = event.poster
          ? new URL(event.poster, window.valorEventsApiBase || window.location.href).href
          : new URL('images/events/concert-crowd.svg', window.location.href).href;
        if (Array.isArray(event.tickets) && event.tickets.length) {
          eventSchema.offers = event.tickets.map((ticket) => ({
            '@type': 'Offer',
            name: ticket.name,
            price: Number(ticket.price),
            priceCurrency: ticket.currency || 'KES',
            url: canonical.href
          }));
        }
        let schema = document.getElementById('eventStructuredData');
        if (!schema) {
          schema = document.createElement('script');
          schema.id = 'eventStructuredData';
          schema.type = 'application/ld+json';
          document.head.appendChild(schema);
        }
        schema.textContent = JSON.stringify(eventSchema);
        window.valorMetaContent = {
          content_name: event.title,
          content_category: event.category || 'Event',
          content_ids: [String(event.id)],
          content_type: 'event'
        };
        if (typeof window.valorTrackMeta === 'function') {
          window.valorTrackMeta('ViewContent', window.valorMetaContent);
        }
      }
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
      bookLink.addEventListener('click', () => {
        if (typeof window.valorTrackMeta === 'function') {
          window.valorTrackMeta('InitiateCheckout', window.valorMetaContent);
        }
      });
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
      if (slug) loadEventFeedback(event);
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
      const nowpaymentsConfigured = Boolean(health.nowpaymentsConfigured);
      const nowpaymentsKesPerUsd = Number(health.nowpaymentsKesPerUsd);
      const stripeOption = form.elements.paymentMethod.querySelector('option[value="stripe"]');
      stripeOption.disabled = !stripePaymentsConfigured;
      stripeOption.textContent = stripePaymentsConfigured ? 'Card (Stripe Checkout)' : 'Card (Stripe Checkout; coming soon)';
      const nowpaymentsOption = form.elements.paymentMethod.querySelector('option[value="nowpayments"]');
      nowpaymentsOption.disabled = !nowpaymentsConfigured;
      nowpaymentsOption.textContent = nowpaymentsConfigured
        ? 'Cryptocurrency (NOWPayments)'
        : 'Cryptocurrency (NOWPayments; coming soon)';
      if (!health.paymentsConfigured && nowpaymentsConfigured &&
          form.elements.paymentMethod.value === 'mpesa') {
        form.elements.paymentMethod.value = 'nowpayments';
      }
      const anyOnlinePaymentConfigured = Boolean(health.paymentsConfigured || stripePaymentsConfigured || nowpaymentsConfigured);
      const hasFreeTickets = event.tickets.some((ticket) => Number(ticket.price) === 0);
      const accountToken = window.valorAccountToken();
      if (!anyOnlinePaymentConfigured) {
        event.tickets.forEach((ticket) => {
          if (Number(ticket.price) > 0 && !accountToken) {
            const option = Array.from(select.options).find((entry) => entry.value === ticket.name);
            if (option) option.disabled = true;
          }
        });
        const freeTicket = event.tickets.find((ticket) => Number(ticket.price) === 0);
        if (freeTicket) select.value = freeTicket.name;
      }
      if (!anyOnlinePaymentConfigured && !hasFreeTickets && !accountToken) {
        const button = form.querySelector('[type=submit]');
        button.disabled = true;
        showError(document.getElementById('pageFeedback'), 'Paid checkout is not available yet. Please try again later or use a funded wallet after signing in.');
      } else if (!anyOnlinePaymentConfigured) {
        document.getElementById('pageFeedback').textContent = 'M-Pesa, Stripe, and NOWPayments are unavailable; free registration and funded Valor Wallet payments remain available.';
      }
      const paymentMethod = form.elements.paymentMethod;
      const phoneInput = form.elements.phone;
      const cryptoPriceNote = document.getElementById('nowpaymentsPriceNote');
      const updateCryptoPriceNote = () => {
        if (paymentMethod.value !== 'nowpayments' || !nowpaymentsConfigured ||
            !Number.isFinite(nowpaymentsKesPerUsd) || nowpaymentsKesPerUsd <= 0) {
          cryptoPriceNote.hidden = true;
          cryptoPriceNote.textContent = '';
          return;
        }
        const ticket = event.tickets.find((entry) => entry.name === select.value);
        const quantity = Number(form.elements.quantity.value);
        if (!ticket || !Number.isSafeInteger(quantity) || quantity < 1) {
          cryptoPriceNote.hidden = true;
          return;
        }
        const amountKes = Number(ticket.price) * quantity;
        const amountUsd = Math.round((amountKes / nowpaymentsKesPerUsd) * 100) / 100;
        cryptoPriceNote.textContent = `Crypto invoice: KES ${amountKes.toLocaleString('en-KE')} ≈ USD ${amountUsd.toFixed(2)} (1 USD = KES ${nowpaymentsKesPerUsd.toLocaleString('en-KE')}). The USD amount is fixed when checkout starts.`;
        cryptoPriceNote.hidden = false;
      };
      const updatePaymentFields = () => {
        const usesWallet = paymentMethod.value === 'wallet';
        const usesStripe = paymentMethod.value === 'stripe';
        const usesNowpayments = paymentMethod.value === 'nowpayments';
        phoneInput.required = !usesWallet && !usesNowpayments;
        phoneInput.disabled = usesWallet || usesNowpayments;
        const phoneLabel = phoneInput.closest('label');
        if (phoneLabel) {
          phoneLabel.hidden = usesWallet || usesNowpayments;
          phoneLabel.firstChild.textContent = usesStripe ? 'Contact phone number' : 'Safaricom M-Pesa number';
        }
        form.querySelector('[type=submit]').textContent = `Pay with ${usesWallet
          ? 'Valor Wallet'
          : usesStripe ? 'Stripe Checkout' : usesNowpayments ? 'NOWPayments' : 'M-Pesa'}`;
        updateCryptoPriceNote();
      };
      paymentMethod.addEventListener('change', updatePaymentFields);
      select.addEventListener('change', updateCryptoPriceNote);
      form.elements.quantity.addEventListener('input', updateCryptoPriceNote);
      updatePaymentFields();
      form.addEventListener('submit', async (submitEvent) => {
        submitEvent.preventDefault();
        const button = form.querySelector('[type=submit]');
        button.disabled = true;
        const selectedMethod = paymentMethod.value;
        const currentAccountToken = window.valorAccountToken();
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
        if (selectedMethod === 'nowpayments' && !nowpaymentsConfigured) {
          showError(document.getElementById('pageFeedback'), 'NOWPayments is not configured yet. Choose M-Pesa or Valor Wallet.');
          button.disabled = false;
          return;
        }
        await window.valorAffiliateReferralReady;
        await startCheckout('/api/orders/tickets', {
          eventId: event.id,
          ticketType: select.value,
          quantity: Number(form.elements.quantity.value),
          buyerName: form.elements.buyerName.value,
          phone: form.elements.phone.value,
          paymentMethod: selectedMethod,
          affiliateReferralToken: window.valorAffiliateReferralToken()
        }, document.getElementById('pageFeedback'), currentAccountToken);
        button.disabled = false;
      });
    } catch (error) {
      const robots = document.head.querySelector('meta[name="robots"]');
      if (robots) robots.content = 'noindex, nofollow';
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
      const token = window.valorAccountToken();
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
      const accountToken = window.valorAccountToken();
      if (accountToken) headers.set('Authorization', `Bearer ${accountToken}`);
      const order = await api(`/api/orders/${encodeURIComponent(orderId)}`, { headers });
      if (typeof window.valorTrackPurchase === 'function') {
        window.valorTrackPurchase(order);
      }
      const heading = document.createElement('h1');
      heading.textContent = order.status === 'paid' ? 'Payment confirmed' : order.status === 'confirmed' ? 'Free registration confirmed' : order.status === 'failed' ? 'Payment not completed' : order.status === 'review' ? 'Payment needs support review' : order.paymentMethod === 'stripe' ? 'Waiting for Stripe payment confirmation' : order.paymentMethod === 'nowpayments' ? 'Waiting for crypto payment confirmation' : 'Waiting for M-Pesa payment';
      const details = document.createElement('p');
      const cryptoPrice = order.cryptoPriceAmountUsd !== null &&
        order.cryptoPriceAmountUsd !== undefined &&
        Number.isFinite(Number(order.cryptoPriceAmountUsd))
        ? ` · NOWPayments invoice: USD ${Number(order.cryptoPriceAmountUsd).toFixed(2)}`
        : '';
      details.textContent = `${order.orderType === 'ticket' ? `${order.quantity} ${order.ticketType} ticket(s)` : `Advertising: ${order.campaign?.packageName || 'Event promotion'}`} · KES ${Number(order.amountKes).toLocaleString('en-KE')}${cryptoPrice}${order.receipt ? ` · Receipt ${order.receipt}` : ''}`;
      root.replaceChildren(heading, details);
      if (order.status === 'pending') {
        const explanation = document.createElement('p');
        explanation.textContent = order.paymentMethod === 'stripe'
          ? 'Complete payment in Stripe Checkout. This page checks for confirmation automatically.'
          : order.paymentMethod === 'nowpayments'
            ? 'Complete the crypto payment on NOWPayments. Tickets are issued after the payment is confirmed; this page checks for confirmation automatically.'
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
    const token = window.valorAccountToken();
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
      const feedbackEvents = new Set();
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
        if (!feedbackEvents.has(ticket.eventId)) {
          feedbackEvents.add(ticket.eventId);
          const feedback = document.createElement('section');
          feedback.className = 'ticket-feedback';
          feedback.setAttribute('aria-label', `Feedback for ${ticket.eventTitle}`);

          const loveButton = document.createElement('button');
          loveButton.type = 'button';
          loveButton.className = 'ticket-love';
          loveButton.setAttribute('aria-pressed', String(Boolean(ticket.loved)));
          loveButton.setAttribute('aria-label', ticket.loved ? 'Remove love for this event' : 'Show that you loved this event');
          const heart = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          heart.setAttribute('viewBox', '0 0 24 24');
          heart.setAttribute('aria-hidden', 'true');
          heart.classList.add('ticket-love-icon');
          const heartPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          heartPath.setAttribute('d', 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z');
          heart.appendChild(heartPath);
          const loveText = document.createElement('span');
          loveText.textContent = ticket.loved ? 'You loved this event' : 'I loved this event';
          loveButton.append(heart, loveText);

          const reviewForm = document.createElement('form');
          reviewForm.className = 'ticket-review-form';
          const reviewHeading = document.createElement('h3');
          reviewHeading.textContent = 'Leave a review';
          const ratingLabel = document.createElement('label');
          ratingLabel.textContent = 'Rating (optional)';
          const ratingSelect = document.createElement('select');
          ratingSelect.name = 'rating';
          ratingSelect.setAttribute('aria-label', 'Event rating');
          ratingSelect.add(new Option('Choose a rating', ''));
          for (let rating = 5; rating >= 1; rating -= 1) {
            ratingSelect.add(new Option(`${rating} ${rating === 1 ? 'star' : 'stars'}`, String(rating)));
          }
          if (ticket.rating) ratingSelect.value = String(ticket.rating);
          ratingLabel.appendChild(ratingSelect);
          const reviewLabel = document.createElement('label');
          reviewLabel.textContent = 'Your review (optional)';
          const reviewInput = document.createElement('textarea');
          reviewInput.name = 'review';
          reviewInput.maxLength = 1200;
          reviewInput.rows = 3;
          reviewInput.placeholder = 'What did you think of the event?';
          reviewInput.value = ticket.review || '';
          reviewLabel.appendChild(reviewInput);
          const saveButton = document.createElement('button');
          saveButton.type = 'submit';
          saveButton.className = 'button button-primary';
          saveButton.textContent = 'Save feedback';
          const status = document.createElement('p');
          status.className = 'ticket-feedback-status';
          status.setAttribute('role', 'status');
          reviewForm.append(reviewHeading, ratingLabel, reviewLabel, saveButton, status);

          loveButton.addEventListener('click', async () => {
            const loved = loveButton.getAttribute('aria-pressed') !== 'true';
            loveButton.disabled = true;
            status.textContent = '';
            try {
              const saved = await api(`/api/account/events/${encodeURIComponent(ticket.eventId)}/feedback`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                  loved,
                  rating: ratingSelect.value ? Number(ratingSelect.value) : null,
                  review: reviewInput.value
                })
              });
              loveButton.setAttribute('aria-pressed', String(saved.loved));
              loveButton.setAttribute('aria-label', saved.loved ? 'Remove love for this event' : 'Show that you loved this event');
              loveText.textContent = saved.loved ? 'You loved this event' : 'I loved this event';
              status.textContent = saved.loved ? 'Thanks for sharing the love!' : 'Your love was removed.';
            } catch (error) {
              status.textContent = error.message;
              status.classList.add('error');
            } finally {
              loveButton.disabled = false;
            }
          });

          reviewForm.addEventListener('submit', async (submitEvent) => {
            submitEvent.preventDefault();
            saveButton.disabled = true;
            status.classList.remove('error');
            status.textContent = '';
            try {
              const saved = await api(`/api/account/events/${encodeURIComponent(ticket.eventId)}/feedback`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                  loved: loveButton.getAttribute('aria-pressed') === 'true',
                  rating: ratingSelect.value ? Number(ratingSelect.value) : null,
                  review: reviewInput.value
                })
              });
              loveButton.setAttribute('aria-pressed', String(saved.loved));
              loveButton.setAttribute('aria-label', saved.loved ? 'Remove love for this event' : 'Show that you loved this event');
              loveText.textContent = saved.loved ? 'You loved this event' : 'I loved this event';
              status.textContent = 'Your feedback has been saved.';
            } catch (error) {
              status.textContent = error.message;
              status.classList.add('error');
            } finally {
              saveButton.disabled = false;
            }
          });
          feedback.append(loveButton, reviewForm);
          section.appendChild(feedback);
        }
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
        window.valorClearAccountToken();
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
