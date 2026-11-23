(function () {
  'use strict';
  const api = window.valorEventsApi;
  const escapeDate = (value) => new Date(value).toLocaleString('en-KE', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Nairobi' });
  const saveAccess = (order) => window.sessionStorage.setItem(`valor-order-${order.orderId}`, order.accessToken);
  const formatTicketPrice = (amount, currency) => Number(amount) === 0
    ? 'Free'
    : new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: currency || 'KES',
      maximumFractionDigits: 0
    }).format(Number(amount));

  function showError(element, message) {
    element.textContent = message;
    element.classList.add('error');
  }

  function createLoveButton(loved) {
    const loveButton = document.createElement('button');
    loveButton.type = 'button';
    loveButton.className = 'ticket-love';
    loveButton.setAttribute('aria-pressed', String(Boolean(loved)));
    loveButton.setAttribute('aria-label', loved ? 'Remove love for this event' : 'Show that you loved this event');
    const heart = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    heart.setAttribute('viewBox', '0 0 24 24');
    heart.setAttribute('aria-hidden', 'true');
    heart.classList.add('ticket-love-icon');
    const heartPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    heartPath.setAttribute('d', 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z');
    heart.appendChild(heartPath);
    const loveText = document.createElement('span');
    loveText.textContent = loved ? 'You loved this event' : 'I loved this event';
    loveButton.append(heart, loveText);
    return { loveButton, loveText };
  }

  function createStarRatingInput(initialValue) {
    const wrap = document.createElement('div');
    wrap.className = 'star-rating-input';
    wrap.setAttribute('role', 'radiogroup');
    wrap.setAttribute('aria-label', 'Rating out of 5 stars');
    let value = initialValue || 0;
    const starPath = 'M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.6L12 17.4l-5.9 3.3 1.2-6.6-4.8-4.6 6.6-.9z';
    const buttons = [1, 2, 3, 4, 5].map((n) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'star-rating-star';
      button.setAttribute('aria-label', `${n} ${n === 1 ? 'star' : 'stars'}`);
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('aria-hidden', 'true');
      const iconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      iconPath.setAttribute('d', starPath);
      icon.appendChild(iconPath);
      button.appendChild(icon);
      button.addEventListener('mouseenter', () => paint(n));
      button.addEventListener('focus', () => paint(n));
      button.addEventListener('click', () => {
        value = value === n ? 0 : n;
        paint(value);
        wrap.dispatchEvent(new CustomEvent('change'));
      });
      wrap.appendChild(button);
      return button;
    });
    function paint(upTo) {
      buttons.forEach((button, index) => button.classList.toggle('is-filled', index < upTo));
    }
    wrap.addEventListener('mouseleave', () => paint(value));
    paint(value);
    return {
      element: wrap,
      getValue: () => value || null,
      setValue: (next) => { value = next || 0; paint(value); }
    };
  }

  function createTicketFeedback(ticket) {
    const feedback = document.createElement('section');
    feedback.className = 'ticket-feedback';
    feedback.setAttribute('aria-label', `Feedback for ${ticket.eventTitle}`);

    const { loveButton, loveText } = createLoveButton(ticket.loved);

    const reviewForm = document.createElement('form');
    reviewForm.className = 'ticket-review-form';
    const reviewHeading = document.createElement('h3');
    reviewHeading.textContent = 'Rate & review this event';

    const hasEnded = Boolean(ticket.endsAt) && new Date(ticket.endsAt).getTime() <= Date.now();
    if (!hasEnded) {
      const notYet = document.createElement('p');
      notYet.className = 'ticket-review-pending';
      notYet.textContent = ticket.endsAt
        ? `You'll be able to rate this event once it ends, on ${new Date(ticket.endsAt).toLocaleDateString('en-KE', { dateStyle: 'medium' })}.`
        : "You'll be able to rate this event once it has ended.";
      reviewForm.append(reviewHeading, notYet);
      feedback.append(loveButton, reviewForm);
      loveButton.addEventListener('click', async () => {
        loveButton.disabled = true;
        try {
          const saved = await api(`/api/account/events/${encodeURIComponent(ticket.eventId)}/feedback`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${window.valorAccountToken()}` },
            body: JSON.stringify({
              loved: loveButton.getAttribute('aria-pressed') !== 'true',
              rating: ticket.rating || null,
              review: ticket.review || ''
            })
          });
          loveButton.setAttribute('aria-pressed', String(saved.loved));
          loveButton.setAttribute('aria-label', saved.loved ? 'Remove love for this event' : 'Show that you loved this event');
          loveText.textContent = saved.loved ? 'You loved this event' : 'I loved this event';
        } catch (error) {
          console.error('Could not update favorite:', error.message);
        } finally {
          loveButton.disabled = false;
        }
      });
      return feedback;
    }

    const starInput = createStarRatingInput(ticket.rating);
    const starField = document.createElement('div');
    starField.className = 'star-rating-field';
    const starFieldLabel = document.createElement('span');
    starFieldLabel.textContent = 'Your rating';
    starField.append(starFieldLabel, starInput.element);

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
    saveButton.textContent = 'Save review';
    const status = document.createElement('p');
    status.className = 'ticket-feedback-status';
    status.setAttribute('role', 'status');
    reviewForm.append(reviewHeading, starField, reviewLabel, saveButton, status);

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
            rating: starInput.getValue(),
            review: reviewInput.value
          })
        });
        loveButton.setAttribute('aria-pressed', String(saved.loved));
        loveButton.setAttribute('aria-label', saved.loved ? 'Remove love for this event' : 'Show that you loved this event');
        loveText.textContent = saved.loved ? 'You loved this event' : 'I loved this event';
        starInput.setValue(saved.rating);
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
      if (!starInput.getValue() && !reviewInput.value.trim()) {
        status.textContent = 'Choose a star rating or write a review before saving.';
        status.classList.add('error');
        return;
      }
      saveFeedback(loveButton.getAttribute('aria-pressed') === 'true', () => 'Your review has been saved.');
    });
    feedback.append(loveButton, reviewForm);
    return feedback;
  }

  function loadPublicEventReviews(event) {
    const root = document.getElementById('eventDetails');
    if (!root || !event.id) return;
    const section = document.createElement('section');
    section.className = 'event-public-reviews';
    section.innerHTML = '<div class="event-review-heading"><h2>What people say</h2><p>Loading reviews…</p></div>';
    root.appendChild(section);

    api('/api/events/' + encodeURIComponent(event.id) + '/reviews').then((data) => {
      const heading = section.querySelector('.event-review-heading');
      const countLabel = data.ratingCount
        ? `${data.averageRating.toFixed(1)} out of 5 · ${data.ratingCount} ${data.ratingCount === 1 ? 'rating' : 'ratings'}`
        : data.loveCount
          ? `${data.loveCount} ${data.loveCount === 1 ? 'person loves' : 'people love'} this event`
          : 'No ratings yet';
      heading.innerHTML = '';
      const title = document.createElement('h2');
      title.textContent = 'What people say';
      const summary = document.createElement('p');
      summary.className = 'event-review-summary';
      if (data.ratingCount) {
        summary.textContent = '★'.repeat(Math.round(data.averageRating)) + '☆'.repeat(5 - Math.round(data.averageRating)) + '  ' + countLabel;
      } else {
        summary.textContent = countLabel;
      }
      heading.append(title, summary);

      if (!data.reviews.length) {
        const empty = document.createElement('p');
        empty.className = 'event-review-empty';
        empty.textContent = 'Reviews from attendees will appear here once they share them.';
        section.appendChild(empty);
        return;
      }
      const list = document.createElement('div');
      list.className = 'event-review-list';
      data.reviews.forEach((review) => {
        const article = document.createElement('article');
        article.className = 'event-review-item';
        const name = document.createElement('strong');
        name.textContent = review.displayName;
        const stars = document.createElement('span');
        stars.className = 'event-review-stars';
        stars.textContent = review.rating ? '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating) : 'Valor attendee';
        const comment = document.createElement('p');
        comment.textContent = review.review;
        article.append(name, stars, comment);
        list.appendChild(article);
      });
      section.appendChild(list);
    }).catch(() => {
      section.querySelector('.event-review-heading p').textContent = 'Reviews are temporarily unavailable.';
    });
  }

  function loadEventFeedback(event) {
    if (!event.id) return;
    const token = window.valorAccountToken();
    const root = document.querySelector('.event-detail-poster-wrap') || document.getElementById('eventDetails');
    if (!token) {
      const signIn = document.createElement('a');
      signIn.className = 'ticket-love event-detail-love';
      signIn.href = 'account.html?returnTo=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
      signIn.textContent = 'Sign in to leave feedback';
      const note = document.createElement('p');
      note.className = 'ticket-review-pending';
      note.textContent = 'Ticket holders can rate and review this event after it ends.';
      root.append(signIn, note);
      return;
    }
    const status = document.createElement('p');
    status.className = 'ticket-feedback-status';
    status.setAttribute('role', 'status');
    status.textContent = 'Loading your event feedback…';
    root.appendChild(status);
    api('/api/account/events/' + encodeURIComponent(event.id) + '/feedback', { headers: { Authorization: 'Bearer ' + token } }).then((saved) => {
      status.remove();
      if (saved.hasTicket) {
        const feedback = createTicketFeedback({
          eventId: event.id,
          eventTitle: event.title,
          loved: saved.loved,
          rating: saved.rating,
          review: saved.review,
          endsAt: saved.endsAt || event.endsAt
        });
        feedback.classList.add('event-detail-feedback');
        root.appendChild(feedback);
        return;
      }

      const { loveButton, loveText } = createLoveButton(saved.loved);
      loveButton.classList.add('event-detail-love');
      loveButton.addEventListener('click', async () => {
        loveButton.disabled = true;
        try {
          const updated = await api('/api/account/events/' + encodeURIComponent(event.id) + '/feedback', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token },
            body: JSON.stringify({
              loved: loveButton.getAttribute('aria-pressed') !== 'true',
              rating: saved.rating,
              review: saved.review
            })
          });
          loveButton.setAttribute('aria-pressed', String(updated.loved));
          loveButton.setAttribute('aria-label', updated.loved ? 'Remove from favorites' : 'Add to favorites');
          loveText.textContent = updated.loved ? 'You loved this event' : 'I loved this event';
        } catch (error) {
          console.error('Could not update favorite:', error.message);
        } finally {
          loveButton.disabled = false;
        }
      });
      const note = document.createElement('p');
      note.className = 'ticket-review-pending';
      note.append('Ticket holders can leave a rating or review after the event ends. ');
      const ticketsLink = document.createElement('a');
      ticketsLink.href = 'my-tickets.html';
      ticketsLink.textContent = 'Open tickets & feedback';
      note.appendChild(ticketsLink);
      root.append(loveButton, note);
    }).catch((error) => { status.textContent = error.message; status.classList.add('error'); });
  }

  function recordEventView(event) {
    if (!event.id) return;
    api('/api/events/' + encodeURIComponent(event.id) + '/views', { method: 'POST' })
      .catch((error) => { console.error('Could not record this event view:', error.message); });
    const token = window.valorAccountToken();
    if (!token) return;
    api('/api/account/events/' + encodeURIComponent(event.id) + '/view', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token }
    }).catch((error) => { console.error('Could not record this event view:', error.message); });
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
      if (event.soldOut) {
        const soldOutBadge = document.createElement('span');
        soldOutBadge.className = 'event-detail-sold-out-badge';
        soldOutBadge.textContent = 'SOLD OUT';
        categories.appendChild(soldOutBadge);
      }
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
        price.textContent = formatTicketPrice(lowestPrice, event.tickets[0].currency);
        priceLabel.append(priceCaption, price);
      }
      event.tickets.forEach((ticket) => {
        const item = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = ticket.name;
        const amount = document.createElement('strong');
        amount.textContent = formatTicketPrice(ticket.price, ticket.currency);
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
      secureNote.textContent = 'Secure checkout · Free tickets require no payment; paid tickets are confirmed after payment.';
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
      if (slug) {
        loadPublicEventReviews(event);
        loadEventFeedback(event);
        recordEventView(event);
      }
      if (!slug) return;
      const form = document.getElementById('eventTicketForm');
      const select = form.elements.ticketType;
      select.replaceChildren(...event.tickets.map((ticket) => new Option(
        `${ticket.name} · ${formatTicketPrice(ticket.price, ticket.currency)}`,
        ticket.name
      )));
      form.hidden = false;
      const giftFields = document.getElementById('giftFields');
      const deliveryRadios = form.querySelectorAll('[name="deliveryType"]');
      const updateGiftFields = () => {
        const isGift = form.elements.deliveryType.value === 'gift';
        giftFields.hidden = !isGift;
        form.elements.giftRecipientName.required = isGift;
        form.elements.giftRecipientContact.required = isGift;
      };
      deliveryRadios.forEach((radio) => radio.addEventListener('change', updateGiftFields));
      updateGiftFields();

      const movieSelection = document.getElementById('movieSelection');
      const seatSelection = document.getElementById('seatSelection');
      const seatSelectionNote = document.getElementById('seatSelectionNote');
      let selectedSeats = [];
      const isMovie = /movie|cinema|film/i.test(`${event.category || ''} ${event.tags?.join(' ') || ''}`);
      if (isMovie) {
        movieSelection.hidden = false;
        const showtimes = event.tags
          .map((tag) => typeof tag === 'string' ? tag.match(/^Showtime:\s*(.+)$/i)?.[1] : '')
          .filter((value) => value && !Number.isNaN(Date.parse(value)))
          .map((value) => new Date(value));
        if (!showtimes.length) showtimes.push(new Date(event.startsAt));
        form.elements.showtimeAt.replaceChildren(...showtimes.map((showtime) => new Option(
          new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(showtime),
          showtime.toISOString()
        )));

        const soldSeats = new Set();
        const loadSoldSeats = async () => {
          selectedSeats = [];
          soldSeats.clear();
          try {
            const response = await api(`/api/events/${encodeURIComponent(event.id)}/seats?showtimeAt=${encodeURIComponent(form.elements.showtimeAt.value)}`);
            (response.soldSeats || []).forEach((seat) => soldSeats.add(seat));
          } catch (_) { /* Seat inventory remains available until checkout validation. */ }
          const quantity = Number(form.elements.quantity.value) || 1;
          const capacity = Math.min(Number(event.capacity) || 64, 64);
          seatSelection.replaceChildren();
          const rows = Math.ceil(capacity / 8);
          for (let index = 0; index < capacity; index += 1) {
            const row = String.fromCharCode(65 + Math.floor(index / 8));
            const label = `${row}${(index % 8) + 1}`;
            const seat = document.createElement('button');
            seat.type = 'button';
            seat.className = 'seat-button';
            seat.textContent = label;
            if (soldSeats.has(label)) {
              seat.disabled = true;
              seat.classList.add('sold');
              seat.title = 'Seat already booked';
            } else {
              seat.addEventListener('click', () => {
                if (selectedSeats.includes(label)) {
                  selectedSeats = selectedSeats.filter((entry) => entry !== label);
                } else if (selectedSeats.length < quantity) {
                  selectedSeats.push(label);
                }
                Array.from(seatSelection.children).forEach((button) => button.classList.toggle('selected', selectedSeats.includes(button.textContent)));
                seatSelectionNote.textContent = `${selectedSeats.length}/${quantity} seats selected`;
              });
            }
            seatSelection.appendChild(seat);
          }
          seatSelectionNote.textContent = `0/${quantity} seats selected`;
        };
        form.elements.showtimeAt.addEventListener('change', loadSoldSeats);
        form.elements.quantity.addEventListener('change', () => {
          if (selectedSeats.length > Number(form.elements.quantity.value)) selectedSeats = selectedSeats.slice(0, Number(form.elements.quantity.value));
          Array.from(seatSelection.children).forEach((button) => button.classList.toggle('selected', selectedSeats.includes(button.textContent)));
          seatSelectionNote.textContent = `${selectedSeats.length}/${Number(form.elements.quantity.value)} seats selected`;
        });
        loadSoldSeats();
      }
      const health = await api('/api/health');
      const stripePaymentsConfigured = Boolean(health.stripePaymentsConfigured);
      const nowpaymentsConfigured = Boolean(health.nowpaymentsConfigured);
      const paypalConfigured = Boolean(health.paypalConfigured);
      const googlePayConfigured = Boolean(health.googlePayConfigured);
      const applePayServerConfigured = Boolean(health.applePayConfigured);
      const applePayConfiguredForDevice = applePayServerConfigured &&
        Boolean(window.valorApplePay && window.valorApplePay.isSupported());
      const nowpaymentsKesPerUsd = Number(health.nowpaymentsKesPerUsd);
      const googlePayKesPerUsd = Number(health.googlePayKesPerUsd);
      const applePayKesPerUsd = Number(health.applePayKesPerUsd);
      const mpesaOption = form.elements.paymentMethod.querySelector('option[value="mpesa"]');
      mpesaOption.disabled = !health.paymentsConfigured;
      mpesaOption.textContent = health.paymentsConfigured ? 'M-Pesa' : 'M-Pesa (coming soon)';
      const stripeOption = form.elements.paymentMethod.querySelector('option[value="stripe"]');
      stripeOption.disabled = !stripePaymentsConfigured;
      stripeOption.textContent = stripePaymentsConfigured ? 'Card (Stripe Checkout)' : 'Card (Stripe Checkout; coming soon)';
      const nowpaymentsOption = form.elements.paymentMethod.querySelector('option[value="nowpayments"]');
      nowpaymentsOption.disabled = !nowpaymentsConfigured;
      nowpaymentsOption.textContent = nowpaymentsConfigured
        ? 'Cryptocurrency (NOWPayments)'
        : 'Cryptocurrency (NOWPayments; coming soon)';
      const paypalOption = form.elements.paymentMethod.querySelector('option[value="paypal"]');
      paypalOption.disabled = !paypalConfigured;
      paypalOption.textContent = paypalConfigured ? 'PayPal' : 'PayPal (coming soon)';
      const googlePayOption = form.elements.paymentMethod.querySelector('option[value="googlepay"]');
      googlePayOption.disabled = !googlePayConfigured;
      googlePayOption.textContent = googlePayConfigured ? 'Google Pay' : 'Google Pay (coming soon)';
      const applePayOption = form.elements.paymentMethod.querySelector('option[value="applepay"]');
      applePayOption.disabled = !applePayConfiguredForDevice;
      applePayOption.textContent = !applePayServerConfigured
        ? 'Apple Pay (coming soon)'
        : applePayConfiguredForDevice ? 'Apple Pay' : 'Apple Pay (not available on this device)';
      if (!health.paymentsConfigured && form.elements.paymentMethod.value === 'mpesa') {
        form.elements.paymentMethod.value = paypalConfigured
          ? 'paypal'
          : googlePayConfigured ? 'googlepay'
            : applePayConfiguredForDevice ? 'applepay'
              : nowpaymentsConfigured ? 'nowpayments'
              : stripePaymentsConfigured ? 'stripe' : 'wallet';
      }
      const anyOnlinePaymentConfigured = Boolean(health.paymentsConfigured || stripePaymentsConfigured || nowpaymentsConfigured || paypalConfigured || googlePayConfigured || applePayConfiguredForDevice);
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
        document.getElementById('pageFeedback').textContent = 'M-Pesa, Stripe, NOWPayments, PayPal, Google Pay, and Apple Pay are unavailable; free registration and funded Valor Wallet payments remain available.';
      }
      const paymentMethod = form.elements.paymentMethod;
      const phoneInput = form.elements.phone;
      const cryptoPriceNote = document.getElementById('nowpaymentsPriceNote');
      const googlePayPriceNote = document.getElementById('googlePayPriceNote');
      const googlePayButtonContainer = document.getElementById('googlePayButtonContainer');
      const googlePayStatus = document.getElementById('googlePayStatus');
      const applePayPriceNote = document.getElementById('applePayPriceNote');
      const applePayButtonContainer = document.getElementById('applePayButtonContainer');
      const applePayStatus = document.getElementById('applePayStatus');
      let googlePayReady = false;
      let googlePayPreparation = null;
      let googlePaySubmitting = false;
      let applePayReady = false;
      let applePayPreparation = null;
      let applePaySubmitting = false;
      const submitButton = form.querySelector('[type=submit]');
      const prepareGooglePay = () => {
        const accountToken = window.valorAccountToken();
        if (!googlePayConfigured || !accountToken || googlePayReady || googlePayPreparation) return;
        googlePayStatus.textContent = 'Preparing Google Pay…';
        googlePayStatus.hidden = false;
        googlePayPreparation = window.valorGooglePay.prepare({ api, accountToken })
          .then(() => {
            googlePayReady = true;
            if (paymentMethod.value === 'googlepay') {
              window.valorGooglePay.mountButton(googlePayButtonContainer, submitGooglePayTicket);
              googlePayButtonContainer.hidden = false;
              googlePayStatus.hidden = true;
              submitButton.hidden = true;
            }
          })
          .catch((error) => {
            googlePayOption.disabled = true;
            googlePayOption.textContent = 'Google Pay unavailable';
            const fallback = ['mpesa','paypal','googlepay','applepay','nowpayments','stripe','wallet'].find((method) =>
              Array.from(paymentMethod.options).some((option) => option.value === method && !option.disabled)
            );
            if (fallback) paymentMethod.value = fallback;
            updatePaymentFields();
            googlePayStatus.textContent = error.message;
            googlePayStatus.hidden = false;
          })
          .finally(() => { googlePayPreparation = null; });
      };
      const prepareApplePay = () => {
        const accountToken = window.valorAccountToken();
        if (!applePayConfiguredForDevice || !accountToken || applePayReady || applePayPreparation) return;
        applePayStatus.textContent = 'Preparing Apple Pay…';
        applePayStatus.hidden = false;
        applePayPreparation = window.valorApplePay.prepare({ api, accountToken })
          .then(() => {
            applePayReady = true;
            if (paymentMethod.value === 'applepay') {
              window.valorApplePay.mountButton(applePayButtonContainer, submitApplePayTicket);
              applePayButtonContainer.hidden = false;
              applePayStatus.hidden = true;
              submitButton.hidden = true;
            }
          })
          .catch((error) => {
            applePayOption.disabled = true;
            applePayOption.textContent = 'Apple Pay unavailable';
            const fallback = ['mpesa','paypal','googlepay','applepay','nowpayments','stripe','wallet'].find((method) =>
              Array.from(paymentMethod.options).some((option) => option.value === method && !option.disabled)
            );
            if (fallback) paymentMethod.value = fallback;
            updatePaymentFields();
            applePayStatus.textContent = error.message;
            applePayStatus.hidden = false;
          })
          .finally(() => { applePayPreparation = null; });
      };
      const updateCryptoPriceNote = () => {
        const ticket = event.tickets.find((entry) => entry.name === select.value);
        if (paymentMethod.value !== 'nowpayments' || !nowpaymentsConfigured ||
            !Number.isFinite(nowpaymentsKesPerUsd) || nowpaymentsKesPerUsd <= 0 ||
            Number(ticket && ticket.price) === 0) {
          cryptoPriceNote.hidden = true;
          cryptoPriceNote.textContent = '';
          return;
        }
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
        const selectedTicket = event.tickets.find((entry) => entry.name === select.value);
        const isFreeTicket = Number(selectedTicket && selectedTicket.price) === 0;
        if (!isFreeTicket) {
          const selectedOption = Array.from(paymentMethod.options).find((option) => option.value === paymentMethod.value);
          if (selectedOption && selectedOption.disabled) {
            const fallback = ['mpesa','paypal','googlepay','applepay','nowpayments','stripe','wallet'].find((method) =>
              Array.from(paymentMethod.options).some((option) => option.value === method && !option.disabled)
            );
            if (fallback) paymentMethod.value = fallback;
          }
        }
        const usesWallet = !isFreeTicket && paymentMethod.value === 'wallet';
        const usesStripe = !isFreeTicket && paymentMethod.value === 'stripe';
        const usesNowpayments = !isFreeTicket && paymentMethod.value === 'nowpayments';
        const usesPaypal = !isFreeTicket && paymentMethod.value === 'paypal';
        const usesGooglePay = !isFreeTicket && paymentMethod.value === 'googlepay';
        const usesApplePay = !isFreeTicket && paymentMethod.value === 'applepay';
        const paymentMethodLabel = paymentMethod.closest('label');
        if (paymentMethodLabel) paymentMethodLabel.hidden = isFreeTicket;
        paymentMethod.disabled = isFreeTicket;
        phoneInput.required = isFreeTicket || (!usesWallet && !usesNowpayments && !usesPaypal && !usesGooglePay && !usesApplePay);
        phoneInput.disabled = !isFreeTicket && (usesWallet || usesNowpayments || usesPaypal || usesGooglePay || usesApplePay);
        const phoneLabel = phoneInput.closest('label');
        if (phoneLabel) {
          phoneLabel.hidden = !isFreeTicket && (usesWallet || usesNowpayments || usesPaypal || usesGooglePay || usesApplePay);
          phoneLabel.firstChild.textContent = isFreeTicket
            ? 'WhatsApp number'
            : usesStripe ? 'Contact phone number' : 'Safaricom M-Pesa number';
        }
        submitButton.textContent = isFreeTicket ? 'Get free ticket' : usesPaypal ? 'Continue to PayPal' : `Pay with ${usesWallet
          ? 'Valor Wallet'
          : usesStripe ? 'Stripe Checkout' : usesNowpayments ? 'NOWPayments' : usesGooglePay ? 'Google Pay' : usesApplePay ? 'Apple Pay' : 'M-Pesa'}`;
        if (googlePayButtonContainer) {
          googlePayButtonContainer.hidden = !usesGooglePay || !googlePayReady;
        }
        if (googlePayStatus && !usesGooglePay) googlePayStatus.hidden = true;
        if (applePayButtonContainer) {
          applePayButtonContainer.hidden = !usesApplePay || !applePayReady;
        }
        if (applePayStatus && !usesApplePay) applePayStatus.hidden = true;
        if (googlePayPriceNote) {
          const ticket = event.tickets.find((entry) => entry.name === select.value);
          const quantity = Number(form.elements.quantity.value) || 1;
          const totalKes = Number(ticket && ticket.price) * quantity;
          const amountUsd = Math.round((totalKes / googlePayKesPerUsd) * 100) / 100;
          googlePayPriceNote.hidden = !usesGooglePay || !Number.isFinite(amountUsd) || amountUsd <= 0 ||
            !Number.isFinite(googlePayKesPerUsd) || googlePayKesPerUsd <= 0;
          googlePayPriceNote.textContent = googlePayPriceNote.hidden
            ? ''
            : `Google Pay total: USD ${amountUsd.toFixed(2)} (KES ${totalKes.toLocaleString('en-KE')} at 1 USD = KES ${googlePayKesPerUsd.toLocaleString('en-KE')}).`;
        }
        if (applePayPriceNote) {
          const ticket = event.tickets.find((entry) => entry.name === select.value);
          const quantity = Number(form.elements.quantity.value) || 1;
          const totalKes = Number(ticket && ticket.price) * quantity;
          const amountUsd = Math.round((totalKes / applePayKesPerUsd) * 100) / 100;
          applePayPriceNote.hidden = !usesApplePay || !Number.isFinite(amountUsd) || amountUsd <= 0 ||
            !Number.isFinite(applePayKesPerUsd) || applePayKesPerUsd <= 0;
          applePayPriceNote.textContent = applePayPriceNote.hidden
            ? ''
            : `Apple Pay total: USD ${amountUsd.toFixed(2)} (KES ${totalKes.toLocaleString('en-KE')} at 1 USD = KES ${applePayKesPerUsd.toLocaleString('en-KE')}).`;
        }
        if (usesGooglePay) {
          if (!window.valorAccountToken()) {
            submitButton.hidden = false;
            if (googlePayStatus && googlePayConfigured) {
              googlePayStatus.textContent = 'Sign in to prepare Google Pay checkout.';
              googlePayStatus.hidden = false;
            }
          } else if (googlePayReady) {
            submitButton.hidden = true;
            if (googlePayStatus) googlePayStatus.hidden = true;
          } else {
            submitButton.hidden = true;
            prepareGooglePay();
          }
        } else {
          submitButton.hidden = false;
        }
        if (usesApplePay) {
          if (!window.valorAccountToken()) {
            submitButton.hidden = false;
            if (applePayStatus && applePayConfiguredForDevice) {
              applePayStatus.textContent = 'Sign in to prepare Apple Pay checkout.';
              applePayStatus.hidden = false;
            }
          } else if (applePayReady) {
            submitButton.hidden = true;
            if (applePayStatus) applePayStatus.hidden = true;
          } else {
            submitButton.hidden = true;
            prepareApplePay();
          }
        }
        updateCryptoPriceNote();
      };
      const submitGooglePayTicket = async () => {
        if (googlePaySubmitting || !form.reportValidity()) return;
        const accountToken = window.valorAccountToken();
        if (!accountToken) return;
        const ticket = event.tickets.find((entry) => entry.name === select.value);
        const quantity = Number(form.elements.quantity.value);
        if (!ticket || Number(ticket.price) <= 0 ||
            !Number.isSafeInteger(quantity) || quantity < 1) {
          showError(document.getElementById('pageFeedback'), 'Choose a valid paid ticket and quantity.');
          return;
        }
        if (isMovie && selectedSeats.length !== quantity) {
          showError(document.getElementById('pageFeedback'), `Choose exactly ${quantity} seat(s).`);
          return;
        }
        const totalKes = Number(ticket.price) * quantity;
        const amountUsd = Math.round((totalKes / googlePayKesPerUsd) * 100) / 100;
        if (!Number.isFinite(amountUsd) || amountUsd < 0.01) {
          showError(document.getElementById('pageFeedback'), 'This ticket total is below the minimum Google Pay amount.');
          return;
        }
        googlePaySubmitting = true;
        googlePayStatus.textContent = 'Opening Google Pay…';
        googlePayStatus.hidden = false;
        let order = null;
        try {
          const payment = await window.valorGooglePay.requestPayment({
            amountUsd,
            merchantName: 'Valor Africa Events'
          });
          await window.valorAffiliateReferralReady;
          order = await api('/api/orders/tickets', {
            method: 'POST',
            headers: { Authorization: `Bearer ${accountToken}` },
            body: JSON.stringify({
              eventId: event.id,
              ticketType: select.value,
              quantity,
              buyerName: form.elements.buyerName.value,
              phone: '',
              paymentMethod: 'googlepay',
              googlePayQuotedAmountUsd: amountUsd,
              giftRecipientName: form.elements.deliveryType.value === 'gift' ? form.elements.giftRecipientName.value : '',
              giftRecipientContact: form.elements.deliveryType.value === 'gift' ? form.elements.giftRecipientContact.value : '',
              giftMessage: form.elements.deliveryType.value === 'gift' ? form.elements.giftMessage.value : '',
              showtimeAt: isMovie ? form.elements.showtimeAt.value : '',
              seatLabels: isMovie ? selectedSeats : [],
              affiliateReferralToken: window.valorAffiliateReferralToken(),
              sponsorshipClickId: window.valorSponsorshipClickId(event.id)
            })
          });
          saveAccess(order);
          await api(`/api/orders/${encodeURIComponent(order.orderId)}/googlepay-capture`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accountToken}`,
              'X-Order-Access': order.accessToken
            },
            body: JSON.stringify(payment)
          });
          window.location.assign(`order.html?orderId=${encodeURIComponent(order.orderId)}`);
        } catch (error) {
          if (order) {
            saveAccess(order);
            window.location.assign(`order.html?orderId=${encodeURIComponent(order.orderId)}`);
            return;
          }
          showError(document.getElementById('pageFeedback'), error.message);
          googlePayStatus.hidden = true;
        } finally {
          googlePaySubmitting = false;
        }
      };
      const submitApplePayTicket = async () => {
        if (applePaySubmitting || !form.reportValidity()) return;
        const accountToken = window.valorAccountToken();
        if (!accountToken) return;
        const ticket = event.tickets.find((entry) => entry.name === select.value);
        const quantity = Number(form.elements.quantity.value);
        if (!ticket || Number(ticket.price) <= 0 ||
            !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10) {
          showError(document.getElementById('pageFeedback'), 'Choose a valid paid ticket and quantity.');
          return;
        }
        if (isMovie && selectedSeats.length !== quantity) {
          showError(document.getElementById('pageFeedback'), `Choose exactly ${quantity} seat(s).`);
          return;
        }
        const totalKes = Number(ticket.price) * quantity;
        const amountUsd = Math.round((totalKes / applePayKesPerUsd) * 100) / 100;
        if (!Number.isFinite(amountUsd) || amountUsd < 0.01) {
          showError(document.getElementById('pageFeedback'), 'This ticket total is below the minimum Apple Pay amount.');
          return;
        }
        applePaySubmitting = true;
        applePayStatus.textContent = 'Opening Apple Pay…';
        applePayStatus.hidden = false;
        let order = null;
        try {
          await window.valorApplePay.authorizePayment({
            amountUsd,
            merchantName: 'Valor Africa Events',
            onAuthorized: async (payment) => {
              await window.valorAffiliateReferralReady;
              order = await api('/api/orders/tickets', {
                method: 'POST',
                headers: { Authorization: `Bearer ${accountToken}` },
                body: JSON.stringify({
                  eventId: event.id,
                  ticketType: select.value,
                  quantity,
                  buyerName: form.elements.buyerName.value,
                  phone: '',
                  paymentMethod: 'applepay',
                  applePayQuotedAmountUsd: amountUsd,
                  giftRecipientName: form.elements.deliveryType.value === 'gift' ? form.elements.giftRecipientName.value : '',
                  giftRecipientContact: form.elements.deliveryType.value === 'gift' ? form.elements.giftRecipientContact.value : '',
                  giftMessage: form.elements.deliveryType.value === 'gift' ? form.elements.giftMessage.value : '',
                  showtimeAt: isMovie ? form.elements.showtimeAt.value : '',
                  seatLabels: isMovie ? selectedSeats : [],
                  affiliateReferralToken: window.valorAffiliateReferralToken(),
                  sponsorshipClickId: window.valorSponsorshipClickId(event.id)
                })
              });
              saveAccess(order);
              return api(`/api/orders/${encodeURIComponent(order.orderId)}/applepay-capture`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${accountToken}`,
                  'X-Order-Access': order.accessToken
                },
                body: JSON.stringify(payment)
              });
            }
          });
          if (!order) throw new Error('Apple Pay did not create a ticket order.');
          window.location.assign(`order.html?orderId=${encodeURIComponent(order.orderId)}`);
        } catch (error) {
          if (order) {
            saveAccess(order);
            window.location.assign(`order.html?orderId=${encodeURIComponent(order.orderId)}`);
            return;
          }
          showError(document.getElementById('pageFeedback'), error.message);
          applePayStatus.hidden = true;
        } finally {
          applePaySubmitting = false;
        }
      };
      paymentMethod.addEventListener('change', updatePaymentFields);
      select.addEventListener('change', updatePaymentFields);
      form.elements.quantity.addEventListener('input', updatePaymentFields);
      updatePaymentFields();
      form.addEventListener('submit', async (submitEvent) => {
        submitEvent.preventDefault();
        const button = form.querySelector('[type=submit]');
        button.disabled = true;
        const selectedTicket = event.tickets.find((ticket) => ticket.name === select.value);
        const isFreeTicket = Number(selectedTicket && selectedTicket.price) === 0;
        const selectedMethod = isFreeTicket ? 'mpesa' : paymentMethod.value;
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
        if (selectedMethod === 'googlepay') {
          showError(document.getElementById('pageFeedback'), 'Use the Google Pay button to authorize this payment.');
          button.disabled = false;
          return;
        }
        if (selectedMethod === 'applepay') {
          showError(document.getElementById('pageFeedback'), 'Use the Apple Pay button to authorize this payment.');
          button.disabled = false;
          return;
        }
        if (!isFreeTicket && selectedMethod === 'mpesa' && !health.paymentsConfigured) {
          showError(document.getElementById('pageFeedback'), 'M-Pesa checkout is not configured yet. Choose another available payment method.');
          button.disabled = false;
          return;
        }
        if (!isFreeTicket && selectedMethod === 'stripe' && !stripePaymentsConfigured) {
          showError(document.getElementById('pageFeedback'), 'Stripe Checkout is not configured yet. Choose another available payment method.');
          button.disabled = false;
          return;
        }
        if (!isFreeTicket && selectedMethod === 'nowpayments' && !nowpaymentsConfigured) {
          showError(document.getElementById('pageFeedback'), 'NOWPayments is not configured yet. Choose another available payment method.');
          button.disabled = false;
          return;
        }
        if (!isFreeTicket && selectedMethod === 'paypal' && !paypalConfigured) {
          showError(document.getElementById('pageFeedback'), 'PayPal is not configured yet. Choose another available payment method.');
          button.disabled = false;
          return;
        }
        if (isMovie && selectedSeats.length !== Number(form.elements.quantity.value)) {
          showError(document.getElementById('pageFeedback'), `Choose exactly ${form.elements.quantity.value} seat(s).`);
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
          giftRecipientName: form.elements.deliveryType.value === 'gift' ? form.elements.giftRecipientName.value : '',
          giftRecipientContact: form.elements.deliveryType.value === 'gift' ? form.elements.giftRecipientContact.value : '',
          giftMessage: form.elements.deliveryType.value === 'gift' ? form.elements.giftMessage.value : '',
          showtimeAt: isMovie ? form.elements.showtimeAt.value : '',
          seatLabels: isMovie ? selectedSeats : [],
          affiliateReferralToken: window.valorAffiliateReferralToken(),
          sponsorshipClickId: window.valorSponsorshipClickId(event.id)
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

  const adPlacementLabels = {
    listing: 'Listings', category: 'Category', homepage: 'Homepage', premium: 'Premium'
  };

  function setupAdBooking() {
    const form = document.getElementById('adBookingForm');
    if (!form) return;
    const feedback = document.getElementById('pageFeedback');
    const eventSelect = form.elements.eventId;
    const tierGrid = document.getElementById('adTierGrid');
    const daysInput = form.elements.days;
    const priceSummary = document.getElementById('adPriceSummary');
    const paymentMethod = form.elements.paymentMethod;
    const phoneInput = form.elements.phone;
    let paymentsConfigured = false;
    let tiers = [];

    const adPaymentLabels = { mpesa: 'M-Pesa', wallet: 'Valor Wallet', nowpayments: 'NOWPayments', paypal: 'PayPal' };
    const updatePaymentFields = () => {
      const needsPhone = paymentMethod.value === 'mpesa';
      phoneInput.required = needsPhone;
      phoneInput.disabled = !needsPhone;
      form.querySelector('button[type=submit]').textContent = `Pay with ${adPaymentLabels[paymentMethod.value] || 'M-Pesa'}`;
    };
    paymentMethod.addEventListener('change', updatePaymentFields);
    updatePaymentFields();

    function selectedTier() {
      const checked = tierGrid.querySelector('input[name=packageId]:checked');
      return checked && tiers.find((tier) => tier.id === checked.value);
    }

    function updatePriceSummary() {
      const tier = selectedTier();
      if (!tier) {
        priceSummary.textContent = '';
        daysInput.min = '1';
        daysInput.max = '30';
        return;
      }
      daysInput.min = String(tier.minDays);
      daysInput.max = String(tier.maxDays);
      const days = Math.min(Math.max(Number(daysInput.value) || tier.minDays, tier.minDays), tier.maxDays);
      const total = days * tier.pricePerDayKes;
      priceSummary.textContent = `KES ${tier.pricePerDayKes.toLocaleString('en-KE')}/day × ${days} day${days === 1 ? '' : 's'} = KES ${total.toLocaleString('en-KE')} total`;
    }

    function renderTiers() {
      tierGrid.replaceChildren();
      tiers.forEach((tier, index) => {
        const card = document.createElement('label');
        card.className = 'ad-tier-card';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'packageId';
        input.value = tier.id;
        input.required = true;
        if (index === 0) input.checked = true;
        input.addEventListener('change', updatePriceSummary);
        const badge = document.createElement('span');
        badge.className = `ad-tier-card-badge ad-tier-card-badge-${tier.placement}`;
        badge.textContent = adPlacementLabels[tier.placement] || tier.placement;
        const name = document.createElement('strong');
        name.className = 'ad-tier-card-name';
        name.textContent = tier.name;
        const price = document.createElement('span');
        price.className = 'ad-tier-card-price';
        price.textContent = `KES ${tier.pricePerDayKes.toLocaleString('en-KE')} / day`;
        const description = document.createElement('p');
        description.className = 'ad-tier-card-desc';
        description.textContent = tier.description;
        card.append(input, badge, name, price, description);
        tierGrid.appendChild(card);
      });
      updatePriceSummary();
    }

    daysInput.addEventListener('input', updatePriceSummary);

    (async () => {
      const [eventResponse, packageResponse, health] = await Promise.all([
        api('/api/events'),
        api('/api/ads/packages'),
        api('/api/health')
      ]);
      paymentsConfigured = Boolean(health.paymentsConfigured);
      eventSelect.replaceChildren(new Option('Choose your approved event', ''));
      eventResponse.events.forEach((event) => eventSelect.add(new Option(event.title, event.id)));
      tiers = packageResponse.packages;
      renderTiers();
      if (!paymentsConfigured) {
        feedback.textContent = 'M-Pesa is unavailable. You can still pay from an existing funded wallet.';
      }
    })().catch((error) => showError(feedback, error.message));

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      feedback.classList.remove('error');
      const values = Object.fromEntries(new FormData(form));
      values.days = Number(values.days);
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
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('orderId');
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
    const paypalCaptureKey = `valor-order-paypal-captured-${orderId}`;
    if (params.get('payment') === 'paypal' && !window.sessionStorage.getItem(paypalCaptureKey)) {
      window.sessionStorage.setItem(paypalCaptureKey, '1');
      try {
        await api(`/api/orders/${encodeURIComponent(orderId)}/paypal-capture`, {
          method: 'POST',
          headers: { 'X-Order-Access': token }
        });
      } catch (error) {
        console.error('Could not confirm the PayPal payment automatically:', error.message);
      }
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
      heading.textContent = order.status === 'paid' ? 'Payment confirmed' : order.status === 'confirmed' ? 'Free registration confirmed' : order.status === 'failed' ? 'Payment not completed' : order.status === 'review' ? 'Payment needs support review' : order.paymentMethod === 'stripe' ? 'Waiting for Stripe payment confirmation' : order.paymentMethod === 'nowpayments' ? 'Waiting for crypto payment confirmation' : order.paymentMethod === 'paypal' ? 'Waiting for PayPal payment confirmation' : order.paymentMethod === 'googlepay' ? 'Waiting for Google Pay payment confirmation' : order.paymentMethod === 'applepay' ? 'Waiting for Apple Pay payment confirmation' : 'Waiting for M-Pesa payment';
      const details = document.createElement('p');
      const cryptoPrice = order.cryptoPriceAmountUsd !== null &&
        order.cryptoPriceAmountUsd !== undefined &&
        Number.isFinite(Number(order.cryptoPriceAmountUsd))
        ? ` · NOWPayments invoice: USD ${Number(order.cryptoPriceAmountUsd).toFixed(2)}`
        : '';
      const paypalPrice = order.paypalAmountUsd !== null &&
        order.paypalAmountUsd !== undefined &&
        Number.isFinite(Number(order.paypalAmountUsd))
        ? ` · PayPal: USD ${Number(order.paypalAmountUsd).toFixed(2)}`
        : '';
      const googlePayPrice = order.googlePayAmountUsd !== null &&
        order.googlePayAmountUsd !== undefined &&
        Number.isFinite(Number(order.googlePayAmountUsd))
        ? ` · Google Pay: USD ${Number(order.googlePayAmountUsd).toFixed(2)}`
        : '';
      const applePayPrice = order.applePayAmountUsd !== null &&
        order.applePayAmountUsd !== undefined &&
        Number.isFinite(Number(order.applePayAmountUsd))
        ? ` · Apple Pay: USD ${Number(order.applePayAmountUsd).toFixed(2)}`
        : '';
      const total = order.orderType === 'ticket' && Number(order.amountKes) === 0
        ? 'Free'
        : `KES ${Number(order.amountKes).toLocaleString('en-KE')}`;
      details.textContent = `${order.orderType === 'ticket' ? `${order.quantity} ${order.ticketType} ticket(s)` : `Advertising: ${order.campaign?.packageName || 'Event promotion'}`} · ${total}${cryptoPrice}${paypalPrice}${googlePayPrice}${applePayPrice}${order.receipt ? ` · Receipt ${order.receipt}` : ''}`;
      root.replaceChildren(heading, details);
      if (order.status === 'pending') {
        const explanation = document.createElement('p');
        explanation.textContent = order.paymentMethod === 'stripe'
          ? 'Complete payment in Stripe Checkout. This page checks for confirmation automatically.'
          : order.paymentMethod === 'nowpayments'
            ? 'Complete the crypto payment on NOWPayments. Tickets are issued after the payment is confirmed; this page checks for confirmation automatically.'
            : order.paymentMethod === 'paypal'
              ? 'Complete the payment on PayPal. This page confirms it automatically when you return.'
              : order.paymentMethod === 'googlepay'
                ? 'Google Pay was authorized. The API is confirming the Braintree transaction; this page checks for the result automatically.'
                : order.paymentMethod === 'applepay'
                  ? 'Apple Pay was authorized. The API is confirming the Braintree transaction; this page checks for the result automatically.'
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
        const emailNotice = document.createElement('p');
        emailNotice.className = 'ticket-delivery-note checkout-note';
        emailNotice.textContent = order.ticketEmailStatus === 'sent'
          ? 'Ticket confirmation sent to your account email.'
          : order.ticketEmailStatus === 'sending'
            ? 'Ticket email is being sent to your account. Your QR passes are available below.'
            : order.ticketEmailStatus === 'failed'
              ? 'Email delivery could not be confirmed. Your QR passes are available below; contact support if the email does not arrive.'
              : 'Email delivery is not confirmed yet. Your QR passes are available below.';
        root.appendChild(emailNotice);

        const ticketLinks = order.tickets.map((ticket) => {
          const ticketUrl = new URL('ticket.html', window.location.href);
          ticketUrl.searchParams.set('code', ticket.code);
          return `${ticket.eventTitle || ticket.title} (${ticket.ticketType}): ${ticketUrl.href}`;
        });
        const message = [
          `My Valor Africa ticket${order.tickets.length === 1 ? '' : 's'}:`,
          ...ticketLinks,
          'Keep these ticket links private. Show the QR pass at the event.'
        ].join('\n');
        const whatsappLink = document.createElement('a');
        whatsappLink.className = 'button button-primary whatsapp-ticket-share';
        whatsappLink.href = `https://wa.me/?text=${encodeURIComponent(message)}`;
        whatsappLink.target = '_blank';
        whatsappLink.rel = 'noopener noreferrer';
        whatsappLink.textContent = 'Send tickets on WhatsApp';
        root.appendChild(whatsappLink);

        const whatsappNote = document.createElement('p');
        whatsappNote.className = 'ticket-whatsapp-note';
        whatsappNote.textContent = 'WhatsApp opens with a prepared message. Review it and tap Send; ticket links grant entry, so keep them private.';
        root.appendChild(whatsappNote);
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
      const feedbackDashboard = document.createElement('section');
      feedbackDashboard.className = 'ticket-feedback-dashboard';
      feedbackDashboard.setAttribute('aria-labelledby', 'ticketFeedbackHeading');
      const feedbackHeading = document.createElement('h2');
      feedbackHeading.id = 'ticketFeedbackHeading';
      feedbackHeading.textContent = 'Your event feedback';
      const feedbackIntro = document.createElement('p');
      feedbackIntro.textContent = 'Rate and review events you attended. Feedback opens after the event ends.';
      const feedbackList = document.createElement('div');
      feedbackList.className = 'ticket-feedback-dashboard-list';
      feedbackDashboard.append(feedbackHeading, feedbackIntro, feedbackList);
      const ticketList = document.createElement('section');
      ticketList.className = 'ticket-pass-list';
      const ticketHeading = document.createElement('h2');
      ticketHeading.textContent = 'Your tickets';
      ticketList.appendChild(ticketHeading);
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
          const feedbackItem = document.createElement('article');
          feedbackItem.className = 'ticket-feedback-dashboard-item';
          const feedbackTitle = document.createElement('h3');
          feedbackTitle.textContent = ticket.eventTitle;
          const feedbackDate = document.createElement('p');
          feedbackDate.textContent = `${escapeDate(ticket.startsAt)} · ${ticket.venueName || ticket.city}`;
          const feedback = createTicketFeedback({
            eventId: ticket.eventId,
            eventTitle: ticket.eventTitle,
            loved: ticket.loved,
            rating: ticket.rating,
            review: ticket.review,
            endsAt: ticket.endsAt
          });
          feedbackItem.append(feedbackTitle, feedbackDate, feedback);
          feedbackList.appendChild(feedbackItem);
        }
        if (['not_sent','sending','failed'].includes(ticket.ticketEmailStatus) && !emailNotices.has(ticket.orderId)) {
          const notice = document.createElement('p');
          notice.textContent = 'Your QR pass is available here. The confirmation email is pending delivery.';
          section.appendChild(notice);
          emailNotices.add(ticket.orderId);
        }
        ticketList.appendChild(section);
      });
      fragment.append(feedbackDashboard, ticketList);
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
