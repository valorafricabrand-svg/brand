(async function () {
  'use strict';

  let events = [
    {
      id: 'baminto-festival',
      title: 'Baminto Festival at KICC',
      category: 'Festivals',
      location: 'KICC, Nairobi, Kenya',
      startsAt: '2026-12-12T15:00:00+03:00',
      endsAt: '2026-12-13T01:00:00+03:00',
      poster: 'images/events/baminto-festival.svg',
      earlyBirdEnds: '2026-11-20T23:59:00+03:00',
      tickets: [
        { name: 'Early bird', price: 1500, currency: 'KES', regularPrice: 2500, saleEnds: '2026-11-20T23:59:00+03:00' },
        { name: 'VIP', price: 10000, currency: 'KES' }
      ]
    },
    {
      id: 'kikuyu-homecoming',
      title: 'Kikuyu Homecoming',
      category: 'Community',
      location: 'Limuru, Kenya',
      startsAt: '2026-11-20T22:00:00+03:00',
      endsAt: '2026-11-21T04:00:00+03:00',
      poster: 'images/events/kikuyu-homecoming.svg',
      tickets: [
        { name: 'Regular', price: 10, currency: 'USD' }
      ]
    }
  ];
  let adEvents = events;
  let checkoutEnabled = false;
  const apiBase = window.valorEventsApiBase;
  if (apiBase) {
    try {
      const [listing, featured, health] = await Promise.all([
        window.valorEventsApi('/api/events'),
        window.valorEventsApi('/api/ads/featured'),
        window.valorEventsApi('/api/health')
      ]);
      const toEvent = (event) => ({
        ...event,
        location: event.location || [event.venueName, event.city].filter(Boolean).join(', '),
        poster: event.poster ? new URL(event.poster, apiBase).href : 'images/events/concert-crowd.svg',
        earlyBirdEnds: event.tickets.find((ticket) => ticket.name === 'Early bird')?.saleEnds || '',
        tickets: event.tickets.map((ticket) => ({ ...ticket, currency: 'KES' }))
      });
      events = listing.events.map(toEvent);
      adEvents = featured.events.map(toEvent);
      checkoutEnabled = Boolean(health.paymentsConfigured);
      const status = document.querySelector('.listing-disclaimer, .hub-bottom p');
      if (status) {
        status.textContent = !events.length
          ? 'No approved upcoming events are listed right now. Check back soon or submit an event for review.'
          : checkoutEnabled
            ? 'Tickets are purchased securely through M-Pesa. A ticket is issued only after payment is confirmed.'
            : 'Paid ticket checkout is temporarily unavailable. Free-event registrations remain open.';
      }
      const adNote = document.querySelector('.ad-note');
      if (adNote) adNote.textContent = adEvents.length ? 'Sponsored event placements' : 'No paid event placements are live right now.';
      const sponsoredBadge = document.querySelector('.sponsored-badge');
      if (sponsoredBadge) {
        sponsoredBadge.textContent = adEvents.length ? '✦ PAID PROMOTION' : 'VALOR ADS';
        sponsoredBadge.hidden = !adEvents.length;
      }
      if (!adEvents.length) {
        const stage = document.getElementById('adStage');
        const controls = document.querySelector('.ad-controls');
        if (stage) stage.hidden = true;
        if (controls) controls.hidden = true;
        const sponsoredBadge = document.querySelector('.sponsored-badge');
        if (sponsoredBadge) sponsoredBadge.hidden = true;
      }
    } catch (error) {
      events = [];
      adEvents = [];
      const stage = document.getElementById('adStage');
      const controls = document.querySelector('.ad-controls');
      if (stage) stage.hidden = true;
      if (controls) controls.hidden = true;
      const status = document.querySelector('.listing-disclaimer');
      if (status) status.textContent = error.message;
      const empty = document.getElementById('homeEmpty');
      if (empty) {
        empty.hidden = false;
        empty.textContent = 'Events are temporarily unavailable. Please try again later.';
      }
    }
  }

  const formatMoney = (amount, currency) => {
    const formatted = new Intl.NumberFormat('en-KE', {
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2
    }).format(amount);
    return `${currency === 'KES' ? 'KSH' : currency} ${formatted}`;
  };

  const shortDate = (value) => new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short'
  }).format(new Date(value)).toUpperCase();

  const dateLine = (value) => new Intl.DateTimeFormat('en-KE', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Africa/Nairobi'
  }).format(new Date(value));

  const locationLine = (event) => `${event.location} · ${dateLine(event.startsAt)}`;

  function countdown(value, prefix) {
    const remaining = new Date(value).getTime() - Date.now();
    if (remaining <= 0) return `${prefix} has started`;
    const days = Math.floor(remaining / 86400000);
    const hours = Math.floor((remaining % 86400000) / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    return `${prefix} in ${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;
  }

  function makePriceRow(ticket, event) {
    const saleActive = ticket.regularPrice && ticket.saleEnds && new Date(ticket.saleEnds).getTime() > Date.now();
    const row = document.createElement('div');
    row.className = 'price-line';

    const label = document.createElement('span');
    label.className = 'price-label';
    label.textContent = ticket.regularPrice && !saleActive ? 'Regular' : ticket.name;
    row.appendChild(label);

    const values = document.createElement('span');
    values.className = 'price-values';
    if (saleActive) {
      const oldPrice = document.createElement('span');
      oldPrice.className = 'price-was';
      oldPrice.textContent = formatMoney(ticket.regularPrice, ticket.currency);
      values.appendChild(oldPrice);
    }
    const price = document.createElement('span');
    price.className = saleActive ? 'price-now' : 'price-standard';
    price.textContent = formatMoney(saleActive ? ticket.price : ticket.regularPrice || ticket.price, ticket.currency);
    values.appendChild(price);
    row.appendChild(values);
    row.dataset.eventId = event.id;
    row.dataset.ticketName = ticket.name;
    return row;
  }

  function createEventCard(event) {
    const article = document.createElement('article');
    article.className = 'event-card';
    article.dataset.eventId = event.id;
    article.dataset.category = event.category;

    const poster = document.createElement('div');
    poster.className = 'event-poster';
    const image = document.createElement('img');
    image.src = event.poster;
    image.alt = `${event.title} event poster`;
    image.loading = 'lazy';
    poster.appendChild(image);

    const badgeDate = document.createElement('span');
    badgeDate.className = 'poster-date';
    badgeDate.append(document.createTextNode(shortDate(event.startsAt).split(' ')[0]));
    const month = document.createElement('small');
    month.textContent = shortDate(event.startsAt).split(' ')[1];
    badgeDate.appendChild(month);
    poster.appendChild(badgeDate);

    if (event.earlyBirdEnds && new Date(event.earlyBirdEnds).getTime() > Date.now()) {
      const earlyBird = document.createElement('span');
      earlyBird.className = 'poster-badge';
      earlyBird.textContent = '⚡ Early bird';
      poster.appendChild(earlyBird);
    }

    const body = document.createElement('div');
    body.className = 'event-card-body';
    const heading = document.createElement('h3');
    if (event.slug) {
      const eventLink = document.createElement('a');
      eventLink.href = `event.html?slug=${encodeURIComponent(event.slug)}`;
      eventLink.textContent = event.title;
      heading.appendChild(eventLink);
    } else {
      heading.textContent = event.title;
    }
    heading.title = event.title;
    body.appendChild(heading);

    const meta = document.createElement('p');
    meta.className = 'event-meta';
    const locationIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    locationIcon.setAttribute('viewBox', '0 0 16 16');
    locationIcon.setAttribute('width', '14');
    locationIcon.setAttribute('height', '14');
    locationIcon.setAttribute('aria-hidden', 'true');
    locationIcon.innerHTML = '<path d="M8 14s5-4.6 5-8A5 5 0 0 0 3 6c0 3.4 5 8 5 8Z" fill="currentColor"/><circle cx="8" cy="6" r="1.6" fill="#fff"/>';
    meta.appendChild(locationIcon);
    const metaText = document.createElement('span');
    metaText.textContent = locationLine(event);
    meta.appendChild(metaText);
    body.appendChild(meta);

    const time = document.createElement('p');
    time.className = 'event-countdown';
    time.textContent = countdown(event.startsAt, '◷ Starts');
    time.dataset.countdownTo = event.startsAt;
    body.appendChild(time);

    const prices = document.createElement('div');
    prices.className = 'event-prices';
    event.tickets.forEach((ticket) => prices.appendChild(makePriceRow(ticket, event)));
    body.appendChild(prices);

    if (event.earlyBirdEnds && new Date(event.earlyBirdEnds).getTime() > Date.now()) {
      const bird = document.createElement('p');
      bird.className = 'bird-countdown';
      bird.textContent = `⚡ Early bird ends ${countdown(event.earlyBirdEnds, '').trim()}`;
      bird.dataset.countdownTo = event.earlyBirdEnds;
      body.appendChild(bird);
    }

    const buy = document.createElement('button');
    buy.type = 'button';
    buy.className = 'ticket-link';
    buy.dataset.buyEvent = event.id;
    buy.innerHTML = '<span aria-hidden="true">▣</span> Get tickets';
    body.appendChild(buy);
    article.append(poster, body);
    return article;
  }

  function renderEvents(container, list) {
    if (!container) return;
    container.replaceChildren(...list.map(createEventCard));
  }

  const featured = document.getElementById('featuredEvents');
  renderEvents(featured, events);
  const allEvents = document.getElementById('allEvents');
  renderEvents(allEvents, events);
  if (allEvents && !events.length) {
    const noResults = document.getElementById('noResults');
    if (noResults) noResults.hidden = false;
  }
  if (featured && !events.length) {
    const empty = document.getElementById('homeEmpty');
    if (empty) {
      empty.hidden = false;
      if (apiBase) empty.textContent = 'No approved upcoming events are listed right now. Check back soon or host one with Valor Africa.';
    }
  }

  const adSlides = document.getElementById('adSlides');
  const adDots = document.getElementById('adDots');
  const adStage = document.getElementById('adStage');
  const adSoundToggle = document.getElementById('adSoundToggle');
  const adPlayToggle = document.getElementById('adPlayToggle');
  let activeAdIndex = 0;
  let adTimer = null;
  let adPaused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let adPointerInside = false;
  let adHasFocus = false;

  function createAdSlide(event, index) {
    const slide = document.createElement('article');
    slide.className = 'ad-slide';
    slide.dataset.adIndex = String(index);
    slide.dataset.eventId = event.id;
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-roledescription', 'slide');
    slide.setAttribute('aria-label', `${index + 1} of ${adEvents.length}: ${event.title}`);
    slide.hidden = index !== 0;

    const visual = document.createElement('div');
    visual.className = 'ad-visual';
    const adPoster = event.adPoster || 'images/events/concert-crowd.svg';

    if (event.adVideo) {
      const video = document.createElement('video');
      video.className = 'ad-video';
      video.src = event.adVideo;
      video.poster = adPoster;
      video.autoplay = index === 0;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.setAttribute('aria-label', `Promotional video for ${event.title}`);
      visual.appendChild(video);
    } else {
      const image = document.createElement('img');
      image.className = 'ad-poster';
      image.src = adPoster;
      image.alt = '';
      image.loading = index === 0 ? 'eager' : 'lazy';
      visual.appendChild(image);
      const motion = document.createElement('span');
      motion.className = 'ad-motion';
      motion.setAttribute('aria-hidden', 'true');
      visual.appendChild(motion);
    }

    const content = document.createElement('div');
    content.className = 'ad-content';
    const category = document.createElement('p');
    category.className = 'ad-category';
    category.textContent = `${event.category} · ${new Intl.DateTimeFormat('en-KE', { month: 'short', day: 'numeric' }).format(new Date(event.startsAt))}`;
    const title = document.createElement('h2');
    title.textContent = event.title;
    const details = document.createElement('p');
    details.className = 'ad-description';
    details.textContent = `${event.location} · ${dateLine(event.startsAt)}`;
    const ticket = event.tickets[0];
    const saleActive = ticket.regularPrice && ticket.saleEnds && new Date(ticket.saleEnds).getTime() > Date.now();
    const price = document.createElement('p');
    price.className = 'ad-price';
    price.textContent = `Tickets from ${formatMoney(saleActive ? ticket.price : ticket.regularPrice || ticket.price, ticket.currency)}`;
    const cta = document.createElement('button');
    cta.type = 'button';
    cta.className = 'ad-ticket-cta';
    cta.dataset.buyEvent = event.id;
    cta.innerHTML = `<span>Get tickets</span><span aria-hidden="true">→</span>`;
    content.append(category, title, details, price, cta);
    slide.append(visual, content);
    slide.style.setProperty('--ad-index', String(index));
    return slide;
  }

  function showAd(index) {
    if (!adSlides || !adDots || !adEvents.length) return;
    activeAdIndex = (index + adEvents.length) % adEvents.length;
    adSlides.querySelectorAll('.ad-slide').forEach((slide, slideIndex) => {
      const active = slideIndex === activeAdIndex;
      slide.hidden = !active;
      const video = slide.querySelector('video');
      if (video) {
        if (active) {
          video.muted = true;
          video.play().catch(() => {
            video.controls = true;
          });
        } else {
          video.pause();
          video.currentTime = 0;
        }
      }
    });
    adDots.querySelectorAll('button').forEach((dot, dotIndex) => {
      const active = dotIndex === activeAdIndex;
      dot.classList.toggle('is-active', active);
      dot.setAttribute('aria-current', active ? 'true' : 'false');
      dot.setAttribute('aria-label', `Show advertisement ${dotIndex + 1}: ${adEvents[dotIndex].title}`);
    });
    if (adSoundToggle) {
      const video = adSlides.querySelector('.ad-slide:not([hidden]) video');
      adSoundToggle.hidden = !video;
      if (video) {
        adSoundToggle.setAttribute('aria-pressed', String(!video.muted));
        adSoundToggle.setAttribute('aria-label', video.muted ? 'Turn sound on' : 'Turn sound off');
      }
    }
  }

  function stopAdRotation() {
    if (adTimer) window.clearInterval(adTimer);
    adTimer = null;
  }

  function startAdRotation() {
    stopAdRotation();
    if (!adPaused && !adPointerInside && !adHasFocus && adEvents.length > 1) {
      adTimer = window.setInterval(() => showAd(activeAdIndex + 1), 7000);
    }
  }

  if (adSlides && adDots && adStage) {
    adEvents.forEach((event, index) => {
      adSlides.appendChild(createAdSlide(event, index));
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'ad-dot';
      dot.setAttribute('aria-current', 'false');
      dot.addEventListener('click', () => {
        showAd(index);
        startAdRotation();
      });
      adDots.appendChild(dot);
    });
    showAd(0);
    if (adPlayToggle) {
      adPlayToggle.setAttribute('aria-pressed', String(adPaused));
      adPlayToggle.setAttribute('aria-label', adPaused ? 'Play advertisement rotation' : 'Pause advertisement rotation');
      adPlayToggle.classList.toggle('is-paused', adPaused);
    }
    startAdRotation();

    document.getElementById('adPrevious')?.addEventListener('click', () => {
      showAd(activeAdIndex - 1);
      startAdRotation();
    });
    document.getElementById('adNext')?.addEventListener('click', () => {
      showAd(activeAdIndex + 1);
      startAdRotation();
    });
    adPlayToggle?.addEventListener('click', () => {
      adPaused = !adPaused;
      adPlayToggle.setAttribute('aria-pressed', String(adPaused));
      adPlayToggle.setAttribute('aria-label', adPaused ? 'Play advertisement rotation' : 'Pause advertisement rotation');
      adPlayToggle.classList.toggle('is-paused', adPaused);
      if (adPaused) stopAdRotation();
      else startAdRotation();
    });
    adSoundToggle?.addEventListener('click', () => {
      const video = adSlides.querySelector('.ad-slide:not([hidden]) video');
      if (!video) return;
      video.muted = !video.muted;
      adSoundToggle.setAttribute('aria-pressed', String(!video.muted));
      adSoundToggle.setAttribute('aria-label', video.muted ? 'Turn sound on' : 'Turn sound off');
    });
    adStage.addEventListener('mouseenter', () => {
      adPointerInside = true;
      stopAdRotation();
    });
    adStage.addEventListener('mouseleave', () => {
      adPointerInside = false;
      startAdRotation();
    });
    adStage.addEventListener('focusin', () => {
      adHasFocus = true;
      stopAdRotation();
    });
    adStage.addEventListener('focusout', (event) => {
      if (!adStage.contains(event.relatedTarget)) {
        adHasFocus = false;
        startAdRotation();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopAdRotation();
      else startAdRotation();
    });
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (event) => {
      adPaused = event.matches;
      if (adPlayToggle) {
        adPlayToggle.setAttribute('aria-pressed', String(adPaused));
        adPlayToggle.setAttribute('aria-label', adPaused ? 'Play advertisement rotation' : 'Pause advertisement rotation');
        adPlayToggle.classList.toggle('is-paused', adPaused);
      }
      if (adPaused) stopAdRotation();
      else startAdRotation();
    });
  }

  const nextCountdown = document.getElementById('nextEventCountdown');
  if (nextCountdown) {
    const next = events
      .filter((event) => new Date(event.startsAt).getTime() > Date.now())
      .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt))[0];
    nextCountdown.textContent = next ? `◷ ${countdown(next.startsAt, 'Next event')}` : '◷ New events coming soon';
    nextCountdown.dataset.countdownTo = next ? next.startsAt : '';
  }

  let homeCategory = 'All';

  function applyHomeFilters() {
    if (!featured) return;
    const nameQuery = document.getElementById('homeEventSearch')?.value.trim().toLowerCase() || '';
    const cityQuery = document.getElementById('homeCitySearch')?.value.trim().toLowerCase() || '';
    let visible = 0;
    featured.querySelectorAll('.event-card').forEach((card) => {
      const event = events.find((item) => item.id === card.dataset.eventId);
      const matchesCategory = homeCategory === 'All' || card.dataset.category === homeCategory;
      const matchesName = !nameQuery || `${event.title} ${event.category}`.toLowerCase().includes(nameQuery);
      const matchesCity = !cityQuery || event.location.toLowerCase().includes(cityQuery);
      const show = matchesCategory && matchesName && matchesCity;
      card.hidden = !show;
      if (show) visible += 1;
    });
    const empty = document.getElementById('homeEmpty');
    if (empty) empty.hidden = visible > 0;
  }

  const exploreNav = document.querySelector('.explore-nav');
  if (exploreNav) {
    exploreNav.addEventListener('click', (event) => {
      const link = event.target.closest('a[data-home-category]');
      if (!link) return;
      event.preventDefault();
      homeCategory = link.dataset.homeCategory;
      exploreNav.querySelectorAll('a[data-home-category]').forEach((item) => {
        const isActive = item === link;
        item.classList.toggle('is-active', isActive);
        item.setAttribute('aria-current', isActive ? 'true' : 'false');
      });
      applyHomeFilters();
      document.getElementById('events')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  const homeSearchForm = document.getElementById('homeSearchForm');
  if (homeSearchForm) {
    homeSearchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      applyHomeFilters();
      document.getElementById('events')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    homeSearchForm.querySelectorAll('input').forEach((input) => {
      input.addEventListener('input', applyHomeFilters);
    });
  }

  const allCategories = document.getElementById('allCategories');
  const allSearch = document.getElementById('eventSearch');
  if (allCategories && allEvents) {
    const filterAllEvents = () => {
      const active = allCategories.querySelector('.is-active');
      const category = active ? active.dataset.category : 'All';
      const query = allSearch ? allSearch.value.trim().toLowerCase() : '';
      let visible = 0;
      allEvents.querySelectorAll('.event-card').forEach((card) => {
        const event = events.find((item) => item.id === card.dataset.eventId);
        const matchesCategory = category === 'All' || event.category === category;
        const matchesQuery = !query || `${event.title} ${event.location} ${event.category}`.toLowerCase().includes(query);
        const show = matchesCategory && matchesQuery;
        card.hidden = !show;
        if (show) visible += 1;
      });
      const noResults = document.getElementById('noResults');
      if (noResults) noResults.hidden = visible > 0;
    };
    allCategories.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-category]');
      if (!button) return;
      allCategories.querySelectorAll('button').forEach((chip) => {
        const isActive = chip === button;
        chip.classList.toggle('is-active', isActive);
        chip.setAttribute('aria-pressed', String(isActive));
      });
      filterAllEvents();
    });
    if (allSearch) allSearch.addEventListener('input', filterAllEvents);
  }

  const ticketDialog = document.getElementById('ticketDialog');
  const ticketSelect = document.getElementById('ticketType');
  const paymentMethodSelect = document.getElementById('ticketPaymentMethod');
  const buyerPhoneInput = document.getElementById('buyerPhone');
  const ticketPaymentNote = document.getElementById('ticketPaymentNote');
  function updateTicketPaymentMethod() {
    const usesWallet = paymentMethodSelect.value === 'wallet';
    buyerPhoneInput.required = !usesWallet;
    buyerPhoneInput.disabled = usesWallet;
    document.querySelector('label[for="buyerPhone"]').textContent = usesWallet ? 'M-Pesa number (not needed for wallet)' : 'WhatsApp number';
    ticketPaymentNote.textContent = usesWallet
      ? 'Your verified wallet balance will be charged immediately. Tickets are issued as soon as payment succeeds.'
      : 'You will receive an M-Pesa payment prompt. Your ticket is issued only after payment is confirmed.';
    ticketForm.querySelector('[type=submit]').innerHTML = `Pay with ${usesWallet ? 'Valor Wallet' : 'M-Pesa'} <span aria-hidden="true">→</span>`;
  }
  paymentMethodSelect.addEventListener('change', updateTicketPaymentMethod);
  let activeEvent = null;
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-buy-event]');
    if (!button || !ticketDialog || !ticketSelect) return;
    activeEvent = events.find((item) => item.id === button.dataset.buyEvent);
    if (!activeEvent) return;
    document.getElementById('ticketEventName').textContent = `${activeEvent.title} · ${locationLine(activeEvent)}`;
    const availableTickets = activeEvent.tickets.filter((ticket) =>
      !ticket.regularPrice || !ticket.saleEnds || new Date(ticket.saleEnds).getTime() > Date.now()
    );
    ticketSelect.replaceChildren(...availableTickets.map((ticket) => {
      const option = document.createElement('option');
      option.value = ticket.name;
      option.textContent = `${ticket.name} — ${formatMoney(ticket.price, ticket.currency)}`;
      return option;
    }));
    const ticketSubmit = ticketForm.querySelector('[type=submit]');
    const ticketFeedback = document.getElementById('ticketFeedback');
    ticketSubmit.disabled = availableTickets.length === 0;
    ticketFeedback.textContent = availableTickets.length ? '' : 'Ticket sales are not available right now.';
    ticketFeedback.classList.toggle('error', availableTickets.length === 0);
    paymentMethodSelect.value = 'mpesa';
    updateTicketPaymentMethod();
    ticketDialog.showModal();
  });

  const ticketForm = document.getElementById('ticketRequestForm');
  if (ticketForm) {
    ticketForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!activeEvent) return;
      const data = new FormData(ticketForm);
      const ticket = activeEvent.tickets.find((item) => item.name === data.get('ticketType'));
      if (!ticket) return;
      const ticketFeedback = document.getElementById('ticketFeedback');
      const submitButton = ticketForm.querySelector('[type=submit]');
      const paymentMethod = data.get('paymentMethod');
      if (!checkoutEnabled && Number(ticket.price) > 0 && paymentMethod === 'mpesa') {
        ticketFeedback.textContent = apiBase
          ? 'M-Pesa checkout is not available right now. Choose Valor Wallet or try again later.'
          : 'Secure ticket checkout is not connected on this preview website yet.';
        ticketFeedback.classList.add('error');
        return;
      }
      const walletToken = window.sessionStorage.getItem('valor-account-token');
      if (paymentMethod === 'wallet' && !walletToken) {
        ticketFeedback.textContent = 'Sign in to your account and link a phone wallet before paying with your balance.';
        ticketFeedback.classList.add('error');
        return;
      }
      submitButton.disabled = true;
      ticketFeedback.classList.remove('error');
      ticketFeedback.textContent = Number(ticket.price) === 0
        ? 'Confirming your free registration…'
        : paymentMethod === 'wallet' ? 'Paying with your Valor Wallet…' : 'Sending an M-Pesa payment prompt…';
      try {
        const order = await window.valorEventsApi('/api/orders/tickets', {
          method: 'POST',
          headers: paymentMethod === 'wallet' ? { Authorization: `Bearer ${walletToken}` } : {},
          body: JSON.stringify({
            eventId: activeEvent.id,
            ticketType: ticket.name,
            quantity: Number(data.get('quantity')),
            buyerName: data.get('name'),
            phone: data.get('phone'),
            paymentMethod
          })
        });
        window.sessionStorage.setItem(`valor-order-${order.orderId}`, order.accessToken);
        window.location.assign(`order.html?orderId=${encodeURIComponent(order.orderId)}`);
      } catch (error) {
        ticketFeedback.textContent = error.message;
        ticketFeedback.classList.add('error');
        submitButton.disabled = false;
      }
    });
  }

  document.querySelectorAll('[data-countdown-to]').forEach((element) => {
    const updateCountdown = () => {
      const target = element.dataset.countdownTo;
      if (!target) return;
      const isBird = element.classList.contains('bird-countdown');
      element.textContent = isBird
        ? `⚡ Early bird ends ${countdown(target, '').trim()}`
        : countdown(target, '◷ Starts');
    };
    updateCountdown();
    window.setInterval(updateCountdown, 60000);
  });

  const menuToggle = document.getElementById('menuToggle');
  const navLinks = document.getElementById('navLinks');
  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', () => {
      const open = navLinks.classList.toggle('is-open');
      menuToggle.setAttribute('aria-expanded', String(open));
      menuToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    });
    navLinks.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
      navLinks.classList.remove('is-open');
      menuToggle.setAttribute('aria-expanded', 'false');
      menuToggle.setAttribute('aria-label', 'Open navigation');
    }));
  }

  const hostForm = document.getElementById('hostEventForm');
  if (hostForm) {
    const storageKey = 'valor-event-drafts-v1';
    const feedback = document.getElementById('draftFeedback');
    const draftList = document.getElementById('draftList');
    const imageInput = document.getElementById('eventImages');
    const imageNames = document.getElementById('imageNames');
    const titleInput = document.getElementById('eventTitle');
    const slugInput = document.getElementById('eventSlug');
    const startsInput = document.getElementById('eventStarts');
    const endsInput = document.getElementById('eventEnds');
    let editingId = null;
    let slugWasEdited = false;

    slugInput.addEventListener('input', () => { slugWasEdited = true; });
    titleInput.addEventListener('input', () => {
      if (slugWasEdited) return;
      slugInput.value = titleInput.value
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    });
    startsInput.addEventListener('change', () => {
      endsInput.min = startsInput.value;
      document.getElementById('earlyBirdEnds').max = startsInput.value;
    });
    imageInput.addEventListener('change', () => {
      const files = Array.from(imageInput.files || []);
      imageNames.textContent = files.length
        ? `${files.length} selected: ${files.map((file) => file.name).join(', ')}`
        : 'No images selected.';
    });

    function readDrafts() {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return [];
      const drafts = JSON.parse(raw);
      if (!Array.isArray(drafts)) throw new Error('Saved event drafts are in an unexpected format.');
      return drafts;
    }

    function renderDrafts() {
      try {
        const drafts = readDrafts();
        if (!drafts.length) {
          const empty = document.createElement('p');
          empty.className = 'draft-empty';
          empty.textContent = 'Your saved event drafts will appear here.';
          draftList.replaceChildren(empty);
          return;
        }
        draftList.replaceChildren(...drafts.map((draft) => {
          const item = document.createElement('article');
          item.className = 'draft-item';
          const title = document.createElement('strong');
          title.textContent = draft.eventTitle || 'Untitled event';
          const date = document.createElement('time');
          date.textContent = draft.eventStarts
            ? new Date(draft.eventStarts).toLocaleString()
            : 'Date not set';
          const actions = document.createElement('div');
          actions.className = 'draft-actions';
          const edit = document.createElement('button');
          edit.type = 'button';
          edit.dataset.editDraft = draft.id;
          edit.textContent = 'Edit draft';
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.dataset.deleteDraft = draft.id;
          remove.textContent = 'Delete';
          actions.append(edit, remove);
          item.append(title, date, actions);
          return item;
        }));
      } catch (error) {
        draftList.textContent = 'Could not read saved drafts. Your browser storage may be unavailable or corrupted.';
        feedback.textContent = error.message;
        feedback.classList.add('error');
      }
    }

    hostForm.addEventListener('submit', (event) => {
      event.preventDefault();
      feedback.classList.remove('error');
      const data = new FormData(hostForm);
      const startsAt = new Date(data.get('eventStarts')).getTime();
      const endsAt = new Date(data.get('eventEnds')).getTime();
      const regularPrice = Number(data.get('ticketPrice'));
      const earlyBirdPrice = data.get('earlyBirdPrice') ? Number(data.get('earlyBirdPrice')) : null;
      const vipPrice = data.get('vipPrice') ? Number(data.get('vipPrice')) : null;
      const earlyBirdEnds = data.get('earlyBirdEnds') ? new Date(data.get('earlyBirdEnds')).getTime() : null;
      if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
        feedback.textContent = 'Add a valid end time that is after the event start.';
        feedback.classList.add('error');
        endsInput.focus();
        return;
      }
      if (earlyBirdPrice !== null && (earlyBirdPrice >= regularPrice || !earlyBirdEnds || earlyBirdEnds >= startsAt)) {
        feedback.textContent = 'Early-bird pricing must be below the regular price, with an end time before the event starts.';
        feedback.classList.add('error');
        document.getElementById('earlyBirdPrice').focus();
        return;
      }
      if (vipPrice !== null && vipPrice <= regularPrice) {
        feedback.textContent = 'VIP ticket price must be higher than the regular ticket price.';
        feedback.classList.add('error');
        document.getElementById('vipPrice').focus();
        return;
      }
      if (imageInput.files.length > 0 && Array.from(imageInput.files).some((file) => file.size > 10 * 1024 * 1024)) {
        feedback.textContent = 'Each event image must be 10 MB or smaller.';
        feedback.classList.add('error');
        imageInput.focus();
        return;
      }
      const draft = Object.fromEntries(data.entries());
      draft.id = editingId || (window.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
      draft.imageNames = Array.from(imageInput.files || []).map((file) => file.name);
      try {
        const drafts = readDrafts();
        const currentIndex = drafts.findIndex((item) => item.id === draft.id);
        if (currentIndex === -1) drafts.unshift(draft);
        else drafts[currentIndex] = draft;
        window.localStorage.setItem(storageKey, JSON.stringify(drafts));
        editingId = draft.id;
        feedback.textContent = 'Event draft saved on this device. Submit it for review when you are ready to publish.';
        feedback.classList.remove('error');
        renderDrafts();
      } catch (error) {
        feedback.textContent = `Could not save this draft: ${error.message}`;
        feedback.classList.add('error');
      }
    });

    document.getElementById('publishEventButton').addEventListener('click', async (event) => {
      feedback.classList.remove('error');
      if (!hostForm.reportValidity()) return;
      const button = event.currentTarget;
      const data = new FormData(hostForm);
      const startsAt = new Date(data.get('eventStarts'));
      const endsAt = new Date(data.get('eventEnds'));
      const earlyBirdEnds = data.get('earlyBirdEnds') ? new Date(data.get('earlyBirdEnds')) : null;
      if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
        feedback.textContent = 'Choose a valid end time after the event start.';
        feedback.classList.add('error');
        endsInput.focus();
        return;
      }
      const submission = new FormData();
      const fields = {
        title: data.get('eventTitle'),
        description: data.get('eventDescription'),
        category: data.get('eventCategory'),
        format: data.get('eventFormat'),
        timezone: data.get('eventTimezone'),
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        venueName: data.get('venueName'),
        meetingUrl: data.get('meetingUrl'),
        city: data.get('eventCity'),
        capacity: data.get('eventCapacity'),
        regularPrice: data.get('ticketPrice'),
        earlyBirdPrice: data.get('earlyBirdPrice'),
        earlyBirdEnds: earlyBirdEnds ? earlyBirdEnds.toISOString() : '',
        vipPrice: data.get('vipPrice'),
        slug: data.get('eventSlug'),
        tags: data.get('campaignTags'),
        organizerName: data.get('organizerName'),
        organizerEmail: data.get('organizerEmail'),
        organizerPhone: data.get('organizerPhone')
      };
      if (!apiBase) {
        const subject = `Event submission: ${fields.title}`;
        const body = [
          'Please review this event for listing on Valor Africa.',
          '',
          `Event: ${fields.title}`,
          `Category: ${fields.category}`,
          `Format: ${fields.format}`,
          `Starts: ${startsAt.toLocaleString()}`,
          `Ends: ${endsAt.toLocaleString()}`,
          `Timezone: ${fields.timezone}`,
          `Venue: ${fields.venueName || 'Not provided'}`,
          `City: ${fields.city}`,
          `Capacity: ${fields.capacity || 'Not specified'}`,
          `Regular ticket price: KES ${fields.regularPrice}`,
          `Early-bird ticket price: ${fields.earlyBirdPrice || 'Not offered'}`,
          `VIP ticket price: ${fields.vipPrice || 'Not offered'}`,
          `Organizer: ${fields.organizerName}`,
          `Organizer email: ${fields.organizerEmail}`,
          `Organizer phone: ${fields.organizerPhone}`,
          '',
          'Description:',
          String(fields.description || '').slice(0, 1500),
          '',
          'Please attach the event poster to this email before sending.'
        ].join('\n');
        const mailto = `mailto:hello@valorafrica.co.ke?${new URLSearchParams({ subject, body })}`;
        const emailLink = document.createElement('a');
        emailLink.href = mailto;
        emailLink.textContent = 'Open email if your mail app did not open';
        emailLink.style.display = 'inline-block';
        emailLink.style.marginTop = '8px';
        feedback.replaceChildren(
          document.createTextNode('Your email app should open with the event details. Attach the event poster and send the email; Valor Africa will review it manually. '),
          emailLink
        );
        feedback.classList.remove('error');
        window.location.href = mailto;
        return;
      }
      Object.entries(fields).forEach(([key, value]) => submission.append(key, value == null ? '' : String(value)));
      const poster = data.get('eventImages');
      if (poster && poster.size > 0) submission.append('eventImage', poster);
      button.disabled = true;
      feedback.textContent = 'Submitting your event for review…';
      try {
        const result = await window.valorEventsApi('/api/events/submissions', { method: 'POST', body: submission });
        feedback.textContent = `${result.message} Your event page will be /event.html?slug=${result.slug}`;
        feedback.classList.remove('error');
      } catch (error) {
        feedback.textContent = error.message;
        feedback.classList.add('error');
      } finally {
        button.disabled = false;
      }
    });

    draftList.addEventListener('click', (event) => {
      const editButton = event.target.closest('[data-edit-draft]');
      const deleteButton = event.target.closest('[data-delete-draft]');
      try {
        const drafts = readDrafts();
        if (editButton) {
          const draft = drafts.find((item) => item.id === editButton.dataset.editDraft);
          if (!draft) return;
          Object.entries(draft).forEach(([name, value]) => {
            const field = hostForm.elements.namedItem(name);
            if (field && typeof value === 'string') field.value = value;
          });
          editingId = draft.id;
          slugWasEdited = true;
          feedback.textContent = 'Draft loaded. Save changes when you are ready.';
          hostForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (deleteButton) {
          const remaining = drafts.filter((item) => item.id !== deleteButton.dataset.deleteDraft);
          window.localStorage.setItem(storageKey, JSON.stringify(remaining));
          if (editingId === deleteButton.dataset.deleteDraft) {
            editingId = null;
            hostForm.reset();
          }
          feedback.textContent = 'Draft deleted from this device.';
          renderDrafts();
        }
      } catch (error) {
        feedback.textContent = `Could not update saved drafts: ${error.message}`;
        feedback.classList.add('error');
      }
    });

    hostForm.addEventListener('reset', () => {
      editingId = null;
      slugWasEdited = false;
      imageNames.textContent = 'No images selected.';
    });
    renderDrafts();
  }
})();
