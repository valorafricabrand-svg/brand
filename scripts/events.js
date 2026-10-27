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
    },
    {
      id: 'mixed-tape-birthday',
      title: 'The Mixed Tape Experience: Birthday Edition (All Vinyl Party)',
      category: 'Concerts',
      location: 'Simba Saloon at Carnivore, Nairobi',
      startsAt: '2026-10-19T18:00:00+03:00',
      tickets: [{ name: 'Regular', price: 1100, currency: 'KES' }]
    },
    {
      id: 'padel-tennis-experience',
      title: 'Padel Tennis Experience',
      category: 'Sports',
      location: 'Sarit Centre, Lower Kabete Road, Nairobi',
      startsAt: '2026-10-20T19:00:00+03:00',
      tickets: [{ name: 'Regular', price: 6500, currency: 'KES' }]
    },
    {
      id: 'marketplace-mastery-miracles',
      title: 'Marketplace Mastery & Miracles',
      category: 'Business',
      location: 'Argyle Grand Hotel, Nairobi',
      startsAt: '2026-10-24T09:00:00+03:00',
      tickets: [{ name: 'Regular', price: 2200, currency: 'KES' }]
    },
    {
      id: 'south-africa-wine-fair',
      title: 'Wines of South Africa by the Glass: 3-Day Wine Fair',
      category: 'Food & Drink',
      location: 'Artcaffé, Rhapta Road, Nairobi',
      startsAt: '2026-10-30T12:00:00+03:00',
      tickets: [{ name: 'Regular', price: 2000, currency: 'KES' }]
    },
    {
      id: 'ballpoint-karaoke-halloween',
      title: 'Ballpoint Karaoke Night: Halloween Edition',
      category: 'Concerts',
      location: 'Ballpoint Social Club, Nairobi',
      startsAt: '2026-10-30T19:00:00+03:00',
      tickets: [{ name: 'Regular', price: 500, currency: 'KES' }]
    },
    {
      id: 'sensory-halloween-pairing',
      title: 'Sensory Halloween: Chocolate & Wine Pairing',
      category: 'Food & Drink',
      location: 'Karel T-Lounge, Village Market, Nairobi',
      startsAt: '2026-10-30T19:30:00+03:00',
      tickets: [{ name: 'Regular', price: 4000, currency: 'KES' }]
    },
    {
      id: 'halloween-fright-night',
      title: 'Halloween Fright Night',
      category: 'Festivals',
      location: 'Village Market, Limuru Road, Nairobi',
      startsAt: '2026-10-31T14:00:00+03:00',
      tickets: [{ name: 'Regular', price: 1500, currency: 'KES' }]
    },
    {
      id: 'graveyard-halloween-party',
      title: 'RaveYard: Thee Halloween Party',
      category: 'Concerts',
      location: 'Uptown Lavington, James Gichuru Road, Nairobi',
      startsAt: '2026-10-31T18:00:00+03:00',
      tickets: [{ name: 'Regular', price: 1500, currency: 'KES' }]
    },
    {
      id: 'eco-fashion-week-africa',
      title: 'Eco Fashion Week Africa: Season 4',
      category: 'Arts & Culture',
      location: 'Mawe Zuri Resort, Watamu',
      startsAt: '2026-11-07T17:00:00+03:00',
      tickets: [{ name: 'Regular', price: 4000, currency: 'KES' }]
    },
    {
      id: 'grace-to-heal',
      title: 'The Grace to Heal',
      category: 'Community',
      location: 'Global Trade Centre, Westlands, Nairobi',
      startsAt: '2026-11-07T13:00:00+03:00',
      tickets: [{ name: 'Regular', price: 12000, currency: 'KES' }]
    },
    {
      id: 'time-attack-last-lap',
      title: 'Time Attack: The Last Lap (Round 4 DMSC)',
      category: 'Sports',
      location: "Machakos People's Park, Machakos",
      startsAt: '2026-11-08T07:00:00+03:00',
      tickets: [{ name: 'Regular', price: 750, currency: 'KES' }]
    },
    {
      id: 'amac-awards-season-two',
      title: 'AMAC Awards: Season 2 (Ankara Edition)',
      category: 'Arts & Culture',
      location: 'KICC, Nairobi',
      startsAt: '2026-11-08T07:00:00+03:00',
      tickets: [{ name: 'Regular', price: 300, currency: 'KES' }]
    }
  ];
  const organizerPromo = {
    id: 'valor-organizer-promo',
    isPlatformPromo: true,
    title: 'Grow your event with Valor Africa',
    category: 'For organizers',
    location: 'Valor Africa Events',
    startsAt: new Date().toISOString(),
    adVideo: 'videos/valor-ads-organizer-intro.mp4',
    adPoster: 'images/events/valor-ads-promo-poster.svg',
    tickets: []
  };
  const ticketBuyerPromo = {
    id: 'valor-ticket-buyer-promo',
    isPlatformPromo: true,
    isTicketBuyerPromo: true,
    title: 'Your next great experience starts here.',
    category: 'For ticket buyers',
    location: 'Valor Africa Events',
    startsAt: new Date().toISOString(),
    adVideo: 'videos/valor-ticket-buyer.mp4',
    adPoster: 'images/events/valor-ticket-buyer-cover.png',
    tickets: []
  };
  let adEvents = [ticketBuyerPromo, organizerPromo, ...events.slice(0, 1)];
  let checkoutEnabled = false;
  let mpesaCheckoutEnabled = false;
  let stripeCheckoutEnabled = false;
  let nowpaymentsCheckoutEnabled = false;
  let nowpaymentsKesPerUsd = null;
  const apiBase = window.valorEventsApiBase;
  if (apiBase && !document.getElementById('hostEventForm')) {
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
      adEvents = [ticketBuyerPromo, organizerPromo, ...featured.events.map(toEvent)];
      mpesaCheckoutEnabled = Boolean(health.paymentsConfigured);
      stripeCheckoutEnabled = Boolean(health.stripePaymentsConfigured);
      nowpaymentsCheckoutEnabled = Boolean(health.nowpaymentsConfigured);
      nowpaymentsKesPerUsd = Number(health.nowpaymentsKesPerUsd) || null;
      checkoutEnabled = mpesaCheckoutEnabled || stripeCheckoutEnabled || nowpaymentsCheckoutEnabled;
      const status = document.querySelector('.listing-disclaimer, .hub-bottom p');
      if (status) {
        status.textContent = !events.length
          ? 'No approved upcoming events are listed right now. Check back soon or submit an event for review.'
          : checkoutEnabled
            ? `Paid tickets are available through ${[
              mpesaCheckoutEnabled && 'M-Pesa',
              stripeCheckoutEnabled && 'Stripe Checkout',
              nowpaymentsCheckoutEnabled && 'NOWPayments'
            ].filter(Boolean).join(' and ')}. Tickets are issued only after payment is confirmed.`
            : 'Paid ticket checkout is temporarily unavailable. Free-event registrations remain open.';
      }
      const adNote = document.querySelector('.ad-note');
      if (adNote) adNote.textContent = adEvents.some((event) => !event.isPlatformPromo)
        ? 'Organizer spotlight · sponsored events'
        : 'Host your next event with Valor Africa.';
      const sponsoredBadge = document.querySelector('.sponsored-badge');
      if (sponsoredBadge) {
        sponsoredBadge.textContent = 'FOR EVENT ORGANIZERS';
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
      adEvents = [ticketBuyerPromo, organizerPromo];
      const adNote = document.querySelector('.ad-note');
      if (adNote) adNote.textContent = 'Host your next event with Valor Africa.';
      const sponsoredBadge = document.querySelector('.sponsored-badge');
      if (sponsoredBadge) {
        sponsoredBadge.textContent = 'FOR EVENT ORGANIZERS';
        sponsoredBadge.hidden = false;
      }
      const status = document.querySelector('.listing-disclaimer');
      if (status) status.textContent = error.message;
      const empty = document.getElementById('homeEmpty');
      if (empty) {
        empty.hidden = false;
        empty.textContent = 'Events are temporarily unavailable. Please try again later.';
      }
    }
  }

  events.sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));

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
    if (event.poster) {
      const image = document.createElement('img');
      image.src = event.poster;
      image.alt = `${event.title} event poster`;
      image.loading = 'lazy';
      poster.appendChild(image);
    } else {
      const artwork = document.createElement('div');
      artwork.className = 'poster-art';
      artwork.dataset.theme = ({
        'Arts & Culture': 'culture',
        'Food & Drink': 'food',
        Business: 'business',
        Community: 'community',
        Concerts: 'music',
        Festivals: 'festival',
        Sports: 'sport'
      })[event.category] || 'community';
      artwork.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.className = 'poster-art-label';
      label.textContent = 'VALOR AFRICA PRESENTS';
      const title = document.createElement('strong');
      title.className = 'poster-art-title';
      title.textContent = event.title;
      const category = document.createElement('span');
      category.className = 'poster-art-category';
      category.textContent = event.category;
      artwork.append(label, title, category);
      poster.appendChild(artwork);
    }

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
    const eventLink = document.createElement('a');
    setEventDetailsLink(eventLink, event);
    eventLink.textContent = event.title;
    heading.appendChild(eventLink);
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

    const buy = document.createElement('a');
    setEventDetailsLink(buy, event);
    buy.className = 'ticket-link';
    buy.innerHTML = '<span aria-hidden="true">▣</span> Get tickets';
    body.appendChild(buy);
    body.appendChild(createEventShareActions(event));
    article.append(poster, body);
    return article;
  }

  function setEventDetailsLink(link, event) {
    link.href = event.slug
      ? `event.html?slug=${encodeURIComponent(event.slug)}`
      : `event.html?preview=${encodeURIComponent(event.id)}`;
    if (!event.slug) {
      link.addEventListener('click', () => {
        window.sessionStorage.setItem(`valor-preview-event-${event.id}`, JSON.stringify(event));
      });
    }
  }

  function eventShareUrl(event) {
    const url = new URL('event.html', window.location.href);
    if (event.slug) {
      url.searchParams.set('slug', event.slug);
    } else {
      const shareableEvent = {
        id: event.id,
        title: event.title,
        description: event.description || '',
        category: event.category || '',
        tags: Array.isArray(event.tags) ? event.tags : [],
        startsAt: event.startsAt,
        endsAt: event.endsAt || '',
        timezone: event.timezone || 'Africa/Nairobi',
        location: locationLine(event),
        poster: event.poster || '',
        tickets: Array.isArray(event.tickets) ? event.tickets : []
      };
      url.searchParams.set('share', JSON.stringify(shareableEvent));
    }
    return url.href;
  }

  function createEventShareActions(event) {
    const actions = document.createElement('div');
    actions.className = 'event-card-actions';
    const shareUrl = eventShareUrl(event);
    const shareText = `Check out ${event.title} on Valor Africa`;
    const shareButton = document.createElement('button');
    shareButton.className = 'event-share-button';
    shareButton.type = 'button';
    shareButton.textContent = 'Share';
    shareButton.setAttribute('aria-label', `Share ${event.title}`);
    shareButton.addEventListener('click', async () => {
      try {
        if (navigator.share) {
          await navigator.share({ title: event.title, text: shareText, url: shareUrl });
        } else {
          await copyEventLink(shareUrl);
          actions.querySelector('.event-share-feedback').textContent = 'Event link copied. Paste it into Instagram or any app.';
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          actions.querySelector('.event-share-feedback').textContent = `Could not share this event: ${error.message}`;
        }
      }
    });

    const whatsappLink = document.createElement('a');
    whatsappLink.className = 'event-share-button';
    whatsappLink.href = `https://wa.me/?text=${encodeURIComponent(`${shareText}: ${shareUrl}`)}`;
    whatsappLink.target = '_blank';
    whatsappLink.rel = 'noopener noreferrer';
    whatsappLink.textContent = 'WhatsApp';
    whatsappLink.setAttribute('aria-label', `Share ${event.title} on WhatsApp`);

    const copyButton = document.createElement('button');
    copyButton.className = 'event-share-button';
    copyButton.type = 'button';
    copyButton.textContent = 'Copy link';
    copyButton.setAttribute('aria-label', `Copy link to ${event.title}`);
    copyButton.addEventListener('click', async () => {
      const feedback = actions.querySelector('.event-share-feedback');
      try {
        await copyEventLink(shareUrl);
        feedback.textContent = 'Event link copied. Paste it into Instagram or any app.';
      } catch (error) {
        feedback.textContent = `Could not copy the event link: ${error.message}`;
      }
    });

    const feedback = document.createElement('span');
    feedback.className = 'event-share-feedback';
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    actions.append(shareButton, whatsappLink, copyButton, feedback);
    return actions;
  }

  async function copyEventLink(url) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
      return;
    }
    const input = document.createElement('textarea');
    input.value = url;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    if (!copied) throw new Error('Clipboard access is unavailable in this browser.');
  }

  function createSponsoredAdRail() {
    const rail = document.createElement('aside');
    rail.className = 'sponsored-ticket-rail';
    rail.setAttribute('aria-label', 'Top selling tickets and products');

    const header = document.createElement('div');
    header.className = 'sponsored-ticket-heading';
    header.innerHTML = '<div><span>★</span><strong>Top selling tickets &amp; products</strong></div><a href="advertise.html">Advertise &amp; sell <span aria-hidden="true">→</span></a>';

    const windowEl = document.createElement('div');
    windowEl.className = 'sponsored-ticket-window';
    const track = document.createElement('div');
    track.className = 'sponsored-ticket-track';

    const ticketEvents = events.filter((event) => Array.isArray(event.tickets) && event.tickets.length).slice(0, 2);
    const products = [
      { name: 'Valor Africa Tote Bag', price: 'KES 4,500', image: 'images/one.jpg' },
      { name: 'Community Print Tee', price: 'KES 2,800', image: 'images/IMG_0729.jpg' }
    ];

    ticketEvents.forEach((event) => {
      const ticket = event.tickets[0];
      const card = document.createElement('a');
      card.className = 'sponsored-ticket-card sponsored-event-card';
      setEventDetailsLink(card, event);
      card.innerHTML = `<span class="sponsored-ticket-label">TOP TICKET</span><img src="${event.poster || 'images/events/concert-crowd.svg'}" alt="" loading="lazy"><div><small>${event.category}</small><strong>${event.title}</strong><p>${formatMoney(ticket.price, ticket.currency || 'KES')} · ${shortDate(event.startsAt)}</p><span class="sponsored-ticket-button">Get tickets <b aria-hidden="true">→</b></span></div>`;
      track.appendChild(card);
    });

    products.forEach((product) => {
      const card = document.createElement('a');
      card.className = 'sponsored-ticket-card sponsored-merch-card';
      card.href = 'shop.html';
      card.innerHTML = `<span class="sponsored-ticket-label">TOP PRODUCT</span><img src="${product.image}" alt="${product.name}" loading="lazy"><div><small>Valor Africa shop</small><strong>${product.name}</strong><p>${product.price}</p><span class="sponsored-ticket-button">Buy now <b aria-hidden="true">→</b></span></div>`;
      track.appendChild(card);
    });

    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      [...track.children].forEach((card) => track.appendChild(card.cloneNode(true)));
    }
    windowEl.appendChild(track);
    rail.append(header, windowEl);
    rail.addEventListener('mouseenter', () => track.classList.add('is-paused'));
    rail.addEventListener('mouseleave', () => track.classList.remove('is-paused'));
    rail.addEventListener('focusin', () => track.classList.add('is-paused'));
    rail.addEventListener('focusout', () => track.classList.remove('is-paused'));
    return rail;
  }

  function renderEvents(container, list) {
    if (!container) return;
    const cards = list.map(createEventCard);
    if (container.id === 'allEvents' && list.length >= 2) {
      const insertionIndex = Math.min(2, cards.length);
      cards.splice(insertionIndex, 0, createSponsoredAdRail());
    }
    container.replaceChildren(...cards);
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
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let adPaused = reducedMotionQuery.matches;
  let adPointerInside = false;
  let adHasFocus = false;

  function createAdSlide(event, index) {
    const slide = document.createElement('article');
    slide.className = 'ad-slide';
    if (event.isPlatformPromo) {
      slide.classList.add(event.isTicketBuyerPromo ? 'is-ticket-buyer-promo' : 'is-organizer-promo');
    }
    slide.dataset.adIndex = String(index);
    slide.dataset.eventId = event.id;
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-roledescription', 'slide');
    slide.setAttribute('aria-label', `${index + 1} of ${adEvents.length}: ${event.title}`);
    slide.hidden = index !== 0;

    const visual = document.createElement('div');
    visual.className = 'ad-visual';
    const adPoster = event.adPoster || 'images/events/concert-crowd.svg';

    if (event.isPlatformPromo) {
      const video = document.createElement('video');
      video.className = 'ad-video';
      video.src = event.adVideo;
      video.poster = adPoster;
      video.autoplay = index === 0 && (!adPaused || event.isTicketBuyerPromo);
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.controls = Boolean(event.isTicketBuyerPromo);
      video.setAttribute('aria-label', event.isTicketBuyerPromo
        ? 'Valor Africa ticket buyer video'
        : '15-second Valor Africa introduction for event organizers');
      visual.appendChild(video);

      if (event.isTicketBuyerPromo) {
        const content = document.createElement('div');
        content.className = 'ad-content';
        const category = document.createElement('p');
        category.className = 'ad-category';
        category.textContent = event.category;
        const title = document.createElement('h2');
        title.textContent = event.title;
        const details = document.createElement('p');
        details.className = 'ad-description';
        details.textContent = 'Discover concerts, festivals and experiences across Africa.';
        const cta = document.createElement('a');
        cta.className = 'ad-ticket-cta';
        cta.href = 'events.html';
        cta.innerHTML = '<span>Explore events</span><span aria-hidden="true">→</span>';
        content.append(category, title, details, cta);

        const playButton = document.createElement('button');
        playButton.type = 'button';
        playButton.className = 'buyer-video-play';
        playButton.setAttribute('aria-label', 'Play ticket buyer video');
        playButton.innerHTML = '<span aria-hidden="true">▶</span><span>Play video</span>';
        video.addEventListener('playing', () => { playButton.hidden = true; });
        video.addEventListener('pause', () => { playButton.hidden = false; });
        playButton.addEventListener('click', () => {
          video.muted = true;
          video.play().catch((error) => {
            console.error('Ticket buyer video could not be played', error);
            video.controls = true;
          });
        });
        slide.append(visual, content, playButton);
        return slide;
      }

      const hostLink = document.createElement('a');
      hostLink.className = 'ad-ticket-cta promo-host-cta';
      hostLink.href = 'host.html';
      hostLink.innerHTML = '<span>Host with Valor</span><span aria-hidden="true">→</span>';

      const transcript = document.createElement('p');
      transcript.className = 'sr-only';
      transcript.textContent = 'Turn your next event into a full house. Create your event listing, choose ticket types and prices, and promote your event with Valor Ads. Host with Valor Africa.';
      slide.append(visual, hostLink, transcript);
      return slide;
    }

    if (event.adVideo) {
      const video = document.createElement('video');
      video.className = 'ad-video';
      video.src = event.adVideo;
      video.poster = adPoster;
      video.autoplay = index === 0 && !adPaused;
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
    const cta = document.createElement('a');
    cta.href = event.isPlatformPromo
      ? event.isTicketBuyerPromo ? 'events.html' : 'host.html'
      : '#';
    if (!event.isPlatformPromo) setEventDetailsLink(cta, event);
    cta.className = 'ad-ticket-cta';
    cta.innerHTML = event.isPlatformPromo
      ? `<span>${event.isTicketBuyerPromo ? 'Browse events' : 'Host an event'}</span><span aria-hidden="true">→</span>`
      : '<span>Get tickets</span><span aria-hidden="true">→</span>';
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
          if (document.hidden) {
            video.pause();
          } else {
            video.play().catch(() => {
              const activeEvent = adEvents[activeAdIndex];
              if (!activeEvent.isPlatformPromo || activeEvent.isTicketBuyerPromo) video.controls = true;
            });
          }
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
    const sponsoredBadge = document.querySelector('.sponsored-badge');
    if (sponsoredBadge) {
      const activeEvent = adEvents[activeAdIndex];
      const isOrganizerPromo = activeEvent.isPlatformPromo && !activeEvent.isTicketBuyerPromo;
      sponsoredBadge.hidden = isOrganizerPromo;
      if (activeEvent.isTicketBuyerPromo) sponsoredBadge.textContent = 'TICKET BUYER VIDEO';
      else if (!isOrganizerPromo) sponsoredBadge.textContent = '✦ PAID PROMOTION';
    }
    if (adSoundToggle) {
      const video = adSlides.querySelector('.ad-slide:not([hidden]) video');
      adSoundToggle.hidden = !video || Boolean(
        adEvents[activeAdIndex].isPlatformPromo && !adEvents[activeAdIndex].isTicketBuyerPromo
      );
      if (video) {
        adSoundToggle.setAttribute('aria-pressed', String(!video.muted));
        adSoundToggle.setAttribute('aria-label', video.muted ? 'Turn sound on' : 'Turn sound off');
      }
    }
  }

  function stopAdRotation() {
    if (adTimer) window.clearTimeout(adTimer);
    adTimer = null;
  }

  function startAdRotation() {
    stopAdRotation();
    if (!adPaused && !adPointerInside && !adHasFocus && adEvents.length > 1) {
      const activeEvent = adEvents[activeAdIndex];
      const delay = activeEvent.isTicketBuyerPromo ? 30000 : activeEvent.isPlatformPromo ? 16000 : 7000;
      adTimer = window.setTimeout(() => {
        showAd(activeAdIndex + 1);
        startAdRotation();
      }, delay);
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
      showAd(activeAdIndex);
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
    reducedMotionQuery.addEventListener('change', (event) => {
      adPaused = event.matches;
      if (adPlayToggle) {
        adPlayToggle.setAttribute('aria-pressed', String(adPaused));
        adPlayToggle.setAttribute('aria-label', adPaused ? 'Play advertisement rotation' : 'Pause advertisement rotation');
        adPlayToggle.classList.toggle('is-paused', adPaused);
      }
      if (adPaused) stopAdRotation();
      else startAdRotation();
      showAd(activeAdIndex);
    });
    document.addEventListener('visibilitychange', () => showAd(activeAdIndex));
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
      const sponsoredRail = allEvents.querySelector('.sponsored-ticket-rail');
      if (sponsoredRail) sponsoredRail.hidden = visible === 0;
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
  const cryptoPriceEstimate = document.getElementById('cryptoPriceEstimate');
  const ticketForm = document.getElementById('ticketRequestForm');
  const ticketDraftKey = 'valor-pending-ticket';
  const ticketReturnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const accountLink = ticketDialog && ticketDialog.querySelector('a[href="account.html"]');
  if (accountLink) {
    accountLink.href = `account.html?returnTo=${encodeURIComponent(ticketReturnTo)}`;
    accountLink.addEventListener('click', () => {
      if (!window.sessionStorage.getItem('valor-account-token')) saveTicketDraft();
    });
  }

  function saveTicketDraft() {
    if (!activeEvent || !ticketForm) return;
    const values = Object.fromEntries(new FormData(ticketForm));
    window.sessionStorage.setItem(ticketDraftKey, JSON.stringify({
      eventId: activeEvent.id,
      ticketType: values.ticketType,
      quantity: values.quantity,
      name: values.name,
      paymentMethod: values.paymentMethod,
      phone: values.phone
    }));
  }

  function showAccountSignIn(feedback) {
    saveTicketDraft();
    feedback.replaceChildren(document.createTextNode('Sign in to your account before getting tickets. '));
    const link = document.createElement('a');
    link.href = `account.html?returnTo=${encodeURIComponent(ticketReturnTo)}`;
    link.textContent = 'Sign in to continue';
    feedback.appendChild(link);
    feedback.classList.add('error');
  }
  function updateTicketPaymentMethod() {
    const usesWallet = paymentMethodSelect.value === 'wallet';
    const usesStripe = paymentMethodSelect.value === 'stripe';
    const usesNowpayments = paymentMethodSelect.value === 'nowpayments';
    buyerPhoneInput.required = !usesWallet && !usesNowpayments;
    buyerPhoneInput.disabled = usesWallet || usesNowpayments;
    document.querySelector('label[for="buyerPhone"]').textContent = usesWallet
      ? 'M-Pesa number (not needed for wallet)'
      : usesStripe ? 'Contact phone number' : usesNowpayments ? 'WhatsApp number (not needed for crypto)' : 'WhatsApp number';
    ticketPaymentNote.textContent = usesWallet
      ? 'Your verified wallet balance will be charged immediately. Tickets are issued as soon as payment succeeds.'
      : usesStripe
        ? 'Continue to Stripe Checkout to pay by card. Your ticket is issued after Stripe confirms payment.'
        : usesNowpayments
          ? 'Continue to NOWPayments to choose a supported cryptocurrency. Your ticket is issued only after payment is confirmed.'
          : 'You will receive an M-Pesa payment prompt. Your ticket is issued only after payment is confirmed.';
    const paymentLabel = usesWallet ? 'Valor Wallet' : usesStripe ? 'Stripe Checkout' : usesNowpayments ? 'NOWPayments' : 'M-Pesa';
    if (cryptoPriceEstimate) {
      const ticket = activeEvent?.tickets.find((item) => item.name === ticketSelect.value);
      const quantity = Number(ticketForm.elements.quantity.value) || 1;
      const kesTotal = Number(ticket?.price) * quantity;
      cryptoPriceEstimate.hidden = !usesNowpayments;
      cryptoPriceEstimate.textContent = usesNowpayments && nowpaymentsKesPerUsd && Number.isFinite(kesTotal)
        ? `Estimated total: $${(kesTotal / nowpaymentsKesPerUsd).toFixed(2)} USD. The final crypto amount is set by NOWPayments.`
        : 'The final USD estimate will be shown at checkout.';
    }
    ticketForm.querySelector('[type=submit]').innerHTML = `Pay with ${paymentLabel} <span aria-hidden="true">→</span>`;
  }
  if (paymentMethodSelect && buyerPhoneInput && ticketPaymentNote && ticketForm) {
    const stripeTicketOption = paymentMethodSelect.querySelector('option[value="stripe"]');
    if (stripeTicketOption) {
      stripeTicketOption.disabled = !stripeCheckoutEnabled;
      stripeTicketOption.textContent = stripeCheckoutEnabled ? 'Card (Stripe Checkout)' : 'Card (Stripe Checkout; coming soon)';
    }
    const nowpaymentsTicketOption = paymentMethodSelect.querySelector('option[value="nowpayments"]');
    if (nowpaymentsTicketOption) {
      nowpaymentsTicketOption.disabled = !nowpaymentsCheckoutEnabled;
      nowpaymentsTicketOption.textContent = nowpaymentsCheckoutEnabled ? 'Cryptocurrency (NOWPayments)' : 'Cryptocurrency (NOWPayments; coming soon)';
    }
    paymentMethodSelect.addEventListener('change', updateTicketPaymentMethod);
    ticketSelect.addEventListener('change', updateTicketPaymentMethod);
    ticketForm.elements.quantity.addEventListener('input', updateTicketPaymentMethod);
  }
  let activeEvent = null;
  function openTicketDialog(eventId, draft = null) {
    if (!ticketDialog || !ticketSelect || !ticketForm) {
      console.error('Ticket dialog is not available on this page.');
      return;
    }
    activeEvent = events.find((item) => item.id === eventId);
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
    paymentMethodSelect.value = mpesaCheckoutEnabled || !nowpaymentsCheckoutEnabled ? 'mpesa' : 'nowpayments';
    if (draft) {
      if (availableTickets.some((ticket) => ticket.name === draft.ticketType)) ticketSelect.value = draft.ticketType;
      ticketForm.elements.quantity.value = String(Math.min(10, Math.max(1, Number(draft.quantity) || 1)));
      ticketForm.elements.name.value = typeof draft.name === 'string' ? draft.name : '';
      const paymentOption = Array.from(paymentMethodSelect.options).find((option) =>
        option.value === draft.paymentMethod && !option.disabled
      );
      if (paymentOption) paymentMethodSelect.value = paymentOption.value;
      ticketForm.elements.phone.value = typeof draft.phone === 'string' ? draft.phone : '';
    }
    updateTicketPaymentMethod();
    if (draft) {
      ticketFeedback.textContent = 'You’re signed in. Review your ticket details and continue to payment.';
      ticketFeedback.classList.remove('error');
    }
    if (!ticketDialog.open) ticketDialog.showModal();
  }

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('[data-buy-event], [data-get-tickets], .get-tickets-btn');
    if (!button) return;
    event.preventDefault();
    const eventId = button.dataset.eventId || button.dataset.buyEvent;
    openTicketDialog(eventId);
  });

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
      const accountToken = window.sessionStorage.getItem('valor-account-token');
      if (!accountToken) {
        showAccountSignIn(ticketFeedback);
        return;
      }
      if (paymentMethod === 'mpesa' && !mpesaCheckoutEnabled) {
        ticketFeedback.textContent = apiBase
          ? 'M-Pesa checkout is not available right now. Choose another available payment method or try again later.'
          : 'Secure ticket checkout is not connected on this preview website yet.';
        ticketFeedback.classList.add('error');
        return;
      }
      if (paymentMethod === 'stripe' && !stripeCheckoutEnabled) {
        ticketFeedback.textContent = 'Stripe Checkout is not configured yet. Choose another available payment method instead.';
        ticketFeedback.classList.add('error');
        return;
      }
      if (paymentMethod === 'nowpayments' && !nowpaymentsCheckoutEnabled) {
        ticketFeedback.textContent = 'NOWPayments is not configured yet. Choose another available payment method instead.';
        ticketFeedback.classList.add('error');
        return;
      }
      submitButton.disabled = true;
      ticketFeedback.classList.remove('error');
      ticketFeedback.textContent = Number(ticket.price) === 0
        ? 'Confirming your free registration…'
        : paymentMethod === 'wallet'
          ? 'Paying with your Valor Wallet…'
          : paymentMethod === 'stripe'
            ? 'Starting Stripe Checkout…'
            : paymentMethod === 'nowpayments' ? 'Starting NOWPayments checkout…' : 'Sending an M-Pesa payment prompt…';
      try {
        await window.valorAffiliateReferralReady;
        const order = await window.valorEventsApi('/api/orders/tickets', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accountToken}` },
          body: JSON.stringify({
            eventId: activeEvent.id,
            ticketType: ticket.name,
            quantity: Number(data.get('quantity')),
            buyerName: data.get('name'),
            phone: data.get('phone'),
            paymentMethod,
            affiliateReferralToken: window.valorAffiliateReferralToken()
          })
        });
        if (order.checkoutUrl) {
          window.sessionStorage.setItem(`valor-order-${order.orderId}`, order.accessToken);
          window.location.assign(order.checkoutUrl);
          return;
        }
        window.sessionStorage.setItem(`valor-order-${order.orderId}`, order.accessToken);
        window.location.assign(`order.html?orderId=${encodeURIComponent(order.orderId)}`);
      } catch (error) {
        if (/session has expired|sign in to your valor africa account/i.test(error.message)) {
          window.sessionStorage.removeItem('valor-account-token');
          showAccountSignIn(ticketFeedback);
          return;
        }
        ticketFeedback.textContent = error.message;
        ticketFeedback.classList.add('error');
        submitButton.disabled = false;
      }
    });
  }

  const savedTicketDraft = window.sessionStorage.getItem(ticketDraftKey);
  if (savedTicketDraft) {
    window.sessionStorage.removeItem(ticketDraftKey);
    try {
      const draft = JSON.parse(savedTicketDraft);
      if (draft && typeof draft.eventId === 'string') openTicketDialog(draft.eventId, draft);
    } catch (error) {
      console.error('Could not restore the saved ticket form.', error);
    }
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
    const serviceNotice = document.getElementById('hostServiceNotice');
    const titleInput = document.getElementById('eventTitle');
    const slugInput = document.getElementById('eventSlug');
    const startsInput = document.getElementById('eventStarts');
    const endsInput = document.getElementById('eventEnds');
    const earlyBirdPriceInput = document.getElementById('earlyBirdPrice');
    const earlyBirdEndsInput = document.getElementById('earlyBirdEnds');
    const publishWithoutEarlyBirdButton = document.getElementById('publishWithoutEarlyBirdButton');
    let editingId = null;
    let editingEventId = new URLSearchParams(window.location.search).get('editEvent');
    let slugWasEdited = false;
    const saveDraftButton = hostForm.querySelector('button[type="submit"]');
    const resetDraftButton = hostForm.querySelector('button[type="reset"]');
    const existingPoster = document.getElementById('existingEventPoster');
    const publishButton = document.getElementById('publishEventButton');

    function localDateTime(value) {
      const date = new Date(value);
      const pad = (part) => String(part).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    async function loadEventForEditing() {
      if (!editingEventId) return;
      saveDraftButton.hidden = true;
      resetDraftButton.hidden = true;
      publishButton.disabled = true;
      publishButton.textContent = 'Save event changes';
      publishWithoutEarlyBirdButton.textContent = 'Save without early-bird offer';
      try {
        const accountToken = window.sessionStorage.getItem('valor-account-token');
        if (!accountToken) throw new Error('Sign in to your organizer account to edit this event.');
        const result = await window.valorEventsApi('/api/events/mine', {
          headers: { Authorization: `Bearer ${accountToken}` }
        });
        const event = result.events.find((entry) => entry.id === editingEventId && !entry.archived);
        if (!event) throw new Error('This event is unavailable or was removed from your account.');
        const values = {
          eventTitle: event.title,
          eventDescription: event.description,
          eventCategory: event.category,
          eventFormat: event.format,
          eventTimezone: event.timezone,
          eventStarts: localDateTime(event.startsAt),
          eventEnds: localDateTime(event.endsAt),
          venueName: event.venueName,
          meetingUrl: event.meetingUrl,
          eventCity: event.city,
          eventCapacity: event.capacity == null ? '' : String(event.capacity),
          ticketPrice: String(event.regularPrice),
          earlyBirdPrice: event.earlyBirdPrice == null ? '' : String(event.earlyBirdPrice),
          earlyBirdEnds: event.earlyBirdEnds ? localDateTime(event.earlyBirdEnds) : '',
          vipPrice: event.vipPrice == null ? '' : String(event.vipPrice),
          eventSlug: event.slug,
          campaignTags: event.tags.join(', '),
          organizerName: event.organizerName,
          organizerEmail: event.organizerEmail,
          organizerPhone: event.organizerPhone
        };
        Object.entries(values).forEach(([id, value]) => {
          const input = document.getElementById(id);
          if (input) input.value = value || '';
        });
        slugWasEdited = true;
        if (event.poster) {
          existingPoster.hidden = false;
          existingPoster.textContent = 'Current poster will be kept unless you choose a replacement. ';
          const link = document.createElement('a');
          link.href = new URL(event.poster, window.valorEventsApiBase).href;
          link.target = '_blank';
          link.rel = 'noopener';
          link.textContent = 'View current poster';
          existingPoster.appendChild(link);
        }
        feedback.textContent = 'Update the event details below, then save your changes.';
        publishButton.disabled = false;
        hostForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (error) {
        publishButton.disabled = true;
        feedback.textContent = error.message;
        feedback.classList.add('error');
      }
    }

    loadEventForEditing();

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
      earlyBirdEndsInput.max = startsInput.value;
    });
    const hideEarlyBirdFallback = () => {
      publishWithoutEarlyBirdButton.hidden = true;
    };
    [earlyBirdPriceInput, earlyBirdEndsInput].forEach((input) => {
      input.addEventListener('input', hideEarlyBirdFallback);
      input.addEventListener('change', hideEarlyBirdFallback);
    });
    publishWithoutEarlyBirdButton.addEventListener('click', () => {
      earlyBirdPriceInput.value = '';
      earlyBirdEndsInput.value = '';
      hideEarlyBirdFallback();
      document.getElementById('publishEventButton').click();
    });
    const updateImageNames = () => {
      const files = Array.from(imageInput.files || []);
      imageNames.textContent = files.length
        ? `${files.length} selected: ${files.map((file) => file.name).join(', ')}`
        : 'No images selected.';
    };
    imageInput.addEventListener('input', updateImageNames);
    imageInput.addEventListener('change', updateImageNames);
    updateImageNames();

    if (serviceNotice) {
      if (!apiBase) {
        serviceNotice.textContent = 'The online event service is not connected. You can save a draft on this device or email your event to Valor Africa for manual review.';
      } else {
        window.valorEventsApi('/api/health').then((health) => {
          if (!health.ok) throw new Error('The event service did not confirm it is ready.');
          serviceNotice.textContent = 'Online event service connected. Publishing makes your event visible immediately; paid checkout depends on payment setup.';
        }).catch((error) => {
          serviceNotice.textContent = `Could not reach the online event service: ${error.message} You can save a draft on this device and try again later.`;
        });
      }
    }

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
      if (editingEventId) return;
      feedback.classList.remove('error');
      const data = new FormData(hostForm);
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
        feedback.textContent = 'Event draft saved on this device. Publish it when you are ready.';
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
      const earlyBirdPrice = data.get('earlyBirdPrice');
      if (earlyBirdPrice) {
        const earlyBirdAmount = Number(earlyBirdPrice);
        const regularPrice = Number(data.get('ticketPrice'));
        if (!Number.isSafeInteger(earlyBirdAmount) || earlyBirdAmount < 0 || earlyBirdAmount >= regularPrice) {
          feedback.textContent = 'Early-bird price must be a whole KES amount below the regular ticket price.';
          feedback.classList.add('error');
          publishWithoutEarlyBirdButton.hidden = false;
          earlyBirdPriceInput.focus();
          return;
        }
        if (!earlyBirdEnds || !Number.isFinite(earlyBirdEnds.getTime()) || earlyBirdEnds <= new Date() || earlyBirdEnds >= startsAt) {
          feedback.textContent = 'Choose an early-bird end time in the future and before the event starts.';
          feedback.classList.add('error');
          publishWithoutEarlyBirdButton.hidden = false;
          earlyBirdEndsInput.focus();
          return;
        }
      } else {
        hideEarlyBirdFallback();
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
      if (!apiBase && editingEventId) {
        feedback.textContent = 'The online event service is not connected. Event changes cannot be saved right now.';
        feedback.classList.add('error');
        return;
      }
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
      feedback.textContent = editingEventId ? 'Saving your event changes…' : 'Submitting your event…';
      try {
        const headers = {};
        const accountToken = window.sessionStorage.getItem('valor-account-token');
        if (accountToken) headers.Authorization = `Bearer ${accountToken}`;
        const result = await window.valorEventsApi(
          editingEventId ? `/api/events/mine/${encodeURIComponent(editingEventId)}` : '/api/events/submissions',
          { method: editingEventId ? 'PATCH' : 'POST', headers, body: submission }
        );
        feedback.textContent = editingEventId
          ? `${result.message} View it at event.html?slug=${result.slug}`
          : `${result.message} View it at /event.html?slug=${result.slug}`;
        feedback.classList.remove('error');
      } catch (error) {
        feedback.textContent = error.message;
        feedback.classList.add('error');
        if (/early-bird price must be below the regular price/i.test(error.message)) {
          publishWithoutEarlyBirdButton.hidden = false;
        }
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
