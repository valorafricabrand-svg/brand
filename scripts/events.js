(async function () {
  'use strict';

  let events = [];
  const ticketBuyerPromo = {
    id: 'valor-ticket-buyer-promo',
    isPlatformPromo: true,
    isTicketBuyerPromo: true,
    title: 'Your next great experience starts here.',
    category: 'For ticket buyers',
    location: 'Valor Africa Events',
    startsAt: new Date().toISOString(),
    adVideo: 'videos/valor-ticket-buyer.mp4?v=mp4-faststart-1',
    adPoster: 'images/events/valor-ticket-buyer-cover.jpg',
    tickets: []
  };
  const featuredVideoPromos = [
    {
      id: 'valor-sponsored-video-promo',
      isSponsoredVideoPromo: true,
      title: 'Valor Events and Tickets',
      category: 'Featured on Valor Africa',
      adVideo: 'videos/valor-sponsored-video.mp4',
      adPoster: 'images/events/video-ad-poster.svg',
      adDescription: 'Explore experiences and find your next event.',
      adLink: 'events.html',
      adCta: 'Get tickets now'
    },
    {
      id: 'valor-organizer-promo',
      isPlatformPromo: true,
      title: 'Grow your event with Valor Africa',
      category: 'For organizers',
      adVideo: 'videos/valor-ads-organizer-intro.mp4',
      adPoster: 'images/events/valor-ads-promo-poster.svg',
      adDescription: 'Create your event listing, set ticket prices, and promote with Valor Ads.',
      adLink: 'host.html',
      adCta: 'Host with Valor'
    },
    ticketBuyerPromo,
    {
      id: 'valor-featured-clip-002',
      isSponsoredVideoPromo: true,
      title: 'Discover Valor Africa',
      category: 'Featured on Valor Africa',
      adVideo: 'videos/valor-featured-clip-002.mp4?v=mp4-faststart-1',
      adPoster: 'images/events/video-ad-poster.svg',
      adDescription: 'Explore events and experiences across Africa.',
      adLink: 'events.html',
      adCta: 'Explore events'
    },
    {
      id: 'valor-featured-clip-001',
      isSponsoredVideoPromo: true,
      title: 'Discover Valor Africa',
      category: 'Featured on Valor Africa',
      adVideo: 'videos/valor-featured-clip-001.mp4?v=mp4-faststart-1',
      adPoster: 'images/events/video-ad-poster.svg',
      adDescription: 'Explore events and experiences across Africa.',
      adLink: 'events.html',
      adCta: 'Explore events'
    }
  ];
  const billboardPromos = [
    {
      id: 'valor-brand-advertising-promo',
      isPartnershipPromo: true,
      title: 'Put your brand here',
      category: 'Brand advertising',
      adDescription: 'Feature your business on this billboard and reach live-event audiences.',
      adLink: 'advertise.html',
      adCta: 'Advertise your brand',
      adPoster: 'images/events/video-ad-poster.svg',
      accent: 'green'
    },
    {
      id: 'valor-dj-artist-promo',
      isPartnershipPromo: true,
      title: 'DJs and artists: get discovered',
      category: 'Artist & DJ partnerships',
      adDescription: 'Create your artist profile and connect with event organizers.',
      adLink: 'partner-dashboard.html?program=artist#artist-application',
      adCta: 'Join as an artist',
      adPoster: 'images/events/concert-crowd.svg',
      accent: 'gold'
    },
    {
      id: 'valor-sponsor-visibility-promo',
      isPartnershipPromo: true,
      title: 'Sponsor an event with Valor',
      category: 'Paid sponsor visibility',
      adDescription: 'Choose event sponsorship and put your brand in front of live audiences.',
      adLink: 'partner-dashboard.html?program=sponsor#sponsorship',
      adCta: 'Explore sponsorship',
      adPoster: 'images/events/valor-ads-promo-poster.svg',
      accent: 'blue'
    },
    {
      id: 'valor-event-promotion-promo',
      isPartnershipPromo: true,
      title: 'Promote your next event',
      category: 'Event promoters',
      adDescription: 'Put your event in front of people looking for their next experience.',
      adLink: 'advertise.html',
      adCta: 'Promote an event',
      adPoster: 'images/events/video-ad-poster.svg',
      accent: 'red'
    }
  ];
  let adEvents = [...featuredVideoPromos, ...billboardPromos];
  let checkoutEnabled = false;
  let mpesaCheckoutEnabled = false;
  let stripeCheckoutEnabled = false;
  let nowpaymentsCheckoutEnabled = false;
  let paypalCheckoutEnabled = false;
  let googlePayCheckoutEnabled = false;
  let applePayConfigured = false;
  let applePayCheckoutEnabled = false;
  let nowpaymentsKesPerUsd = null;
  let googlePayKesPerUsd = null;
  let applePayKesPerUsd = null;
  const apiBase = window.valorEventsApiBase;
  let requestEventListing = null;
  let toPublicEvent = (event) => event;
  let promotionDataPromise = Promise.resolve(null);
  let promotedEvents = [];
  let homepagePromotedEvents = [];
  let billboardSponsors = [];
  let listingAvailable = null;
  let listingRequestInProgress = false;
  let listingRetryTimer = null;
  let paymentHealthAvailable = false;
  if (apiBase && !document.getElementById('hostEventForm')) {
    toPublicEvent = (event, sourceApiBase = apiBase) => {
      const availableTickets = Array.isArray(event.tickets) ? event.tickets : [];
      return {
        ...event,
        location: event.location || [event.venueName, event.city].filter(Boolean).join(', '),
        poster: event.poster ? new URL(event.poster, sourceApiBase).href : 'images/events/concert-crowd.svg',
        earlyBirdEnds: availableTickets.find((ticket) => ticket.name === 'Early bird')?.saleEnds || '',
        tickets: availableTickets.map((ticket) => ({ ...ticket, currency: ticket.currency || 'KES' }))
      };
    };
    requestEventListing = () => window.valorEventsApi('/api/events', {
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(30000) : undefined
    });
    promotionDataPromise = Promise.allSettled([
      window.valorEventsApi('/api/ads/featured'),
      window.valorEventsApi('/api/health'),
      window.valorEventsApi('/api/ads/featured?placement=homepage'),
      window.valorEventsApi('/api/sponsorships/featured-billboard')
    ]).then(([featuredResult, healthResult, homepageResult, billboardResult]) => ({
      featuredEvents: featuredResult.status === 'fulfilled' && Array.isArray(featuredResult.value.events)
        ? featuredResult.value.events.map((event) => toPublicEvent(event, featuredResult.value.apiBase))
        : [],
      featuredError: featuredResult.status === 'rejected' ? featuredResult.reason : null,
      homepageEvents: homepageResult.status === 'fulfilled' && Array.isArray(homepageResult.value.events)
        ? homepageResult.value.events.map((event) => toPublicEvent(event, homepageResult.value.apiBase))
        : [],
      health: healthResult.status === 'fulfilled' ? healthResult.value : null,
      healthError: healthResult.status === 'rejected' ? healthResult.reason : null,
      billboardSponsors: billboardResult.status === 'fulfilled' && Array.isArray(billboardResult.value.sponsors)
        ? billboardResult.value.sponsors.map((sponsor) => ({
          id: sponsor.id,
          isPartnershipPromo: true,
          sponsorshipId: sponsor.id,
          accent: 'blue',
          title: sponsor.brandName,
          category: 'Valor Africa Partner',
          adVideo: sponsor.videoUrl,
          adPoster: sponsor.videoPosterUrl || 'images/events/video-ad-poster.svg',
          adDescription: sponsor.tagline || 'A proud partner of Valor Africa Events.',
          adLink: apiBase ? `${apiBase}/api/sponsorships/${encodeURIComponent(sponsor.id)}/click?placement=homepage-billboard` : sponsor.websiteUrl,
          adCta: 'Learn more'
        }))
        : []
    }));
  }

  events.sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));

  const formatMoney = (amount, currency) => {
    if (Number(amount) === 0) return 'Free';
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

  function createEventFavoriteButton(poster, event) {
    if (!event.id) return;
    const token = window.valorAccountToken ? window.valorAccountToken() : '';
    let button;
    if (!token) {
      button = document.createElement('a');
      button.href = 'account.html?returnTo=' + encodeURIComponent(window.location.pathname + window.location.search);
      button.setAttribute('aria-label', `Sign in to favorite ${event.title}`);
    } else {
      button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', `Favorite ${event.title}`);
    }
    button.className = 'event-favorite-button';
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78a5.5 5.5 0 0 0 1.06-8.84Z"/></svg>';

    const setFavorite = (loved) => {
      button.classList.toggle('is-favorite', loved);
      button.setAttribute('aria-pressed', String(loved));
      button.setAttribute('title', loved ? 'Remove from favorites' : 'Add to favorites');
    };

    if (token && window.valorEventsApi) {
      window.valorEventsApi(`/api/account/events/${encodeURIComponent(event.id)}/feedback`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then((saved) => setFavorite(saved.loved)).catch(() => setFavorite(false));

      button.addEventListener('click', async (clickEvent) => {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
        const loved = button.getAttribute('aria-pressed') !== 'true';
        button.disabled = true;
        try {
          const saved = await window.valorEventsApi(`/api/account/events/${encodeURIComponent(event.id)}/feedback`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${window.valorAccountToken()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ loved, rating: null, review: '' })
          });
          setFavorite(saved.loved);
        } catch (error) {
          button.setAttribute('title', error.message);
        } finally {
          button.disabled = false;
        }
      });
    }
    poster.appendChild(button);
  }

  function createEventCard(event) {
    const article = document.createElement('article');
    article.className = 'event-card';
    article.dataset.eventId = event.id;
    article.dataset.category = event.category;

    const poster = document.createElement('div');
    poster.className = 'event-poster';
    const posterLink = document.createElement('a');
    posterLink.className = 'event-poster-link';
    posterLink.setAttribute('aria-label', `View details for ${event.title}`);
    setEventDetailsLink(posterLink, event);
    if (event.poster) {
      const image = document.createElement('img');
      image.src = event.poster;
      image.alt = `${event.title} event poster`;
      image.loading = 'lazy';
      posterLink.appendChild(image);
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
        Sports: 'sport',
        Comedy: 'festival',
        Nightlife: 'music',
        'Workshops & Classes': 'business',
        'Conferences & Networking': 'business',
        'Religious & Faith': 'culture'
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
      posterLink.appendChild(artwork);
    }
    poster.appendChild(posterLink);
    createEventFavoriteButton(poster, event);

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

    const promotion = promotedEvents.find((promoted) => promoted.id === event.id);
    if (promotion) {
      const sponsored = document.createElement('span');
      sponsored.className = `poster-sponsored-badge poster-sponsored-badge-${promotion.adPlacement || 'listing'}`;
      sponsored.textContent = promotion.adPlacement === 'premium' ? '★ PREMIUM' : 'SPONSORED';
      poster.appendChild(sponsored);
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

  function optimizedShopImage(valorShopUrl, alt) {
    const basename = decodeURIComponent(valorShopUrl.split('/').pop()).replace(/\.[^.]+$/, '');
    const widths = [640, 1024, 1600];
    const webpSrcset = widths.map((w) => `images/optimized/w_${w}/${basename}.webp ${w}w`).join(', ');
    const jpgSrcset = widths.map((w) => `images/optimized/w_${w}/${basename}.jpg ${w}w`).join(', ');
    return `<picture><source type="image/webp" srcset="${webpSrcset}" sizes="164px"><img src="images/optimized/w_640/${basename}.jpg" srcset="${jpgSrcset}" sizes="164px" alt="${alt}" loading="lazy"></picture>`;
  }

  function eventShareUrl(event) {
    if (event.slug && window.valorEventsApiBase) {
      // A shared link needs to be readable by WhatsApp/Facebook/X preview bots, which fetch the
      // URL's raw HTML and never run event.html's client-side script that fills in the real
      // title, description, and poster image. /share/event/:slug server-renders those tags for
      // that one event, then sends a human visitor straight on to the interactive page.
      return `${window.valorEventsApiBase}/share/event/${encodeURIComponent(event.slug)}`;
    }
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
    rail.setAttribute('aria-label', 'Featured tickets, products and event branding');

    const header = document.createElement('div');
    header.className = 'sponsored-ticket-heading';
    header.innerHTML = '<div><span>★</span><strong>Featured tickets, products &amp; branding</strong></div><a href="advertise.html">Advertise &amp; sell <span aria-hidden="true">→</span></a>';

    const windowEl = document.createElement('div');
    windowEl.className = 'sponsored-ticket-window';
    const track = document.createElement('div');
    track.className = 'sponsored-ticket-track';

    const ticketEvents = events.filter((event) => Array.isArray(event.tickets) && event.tickets.length).slice(0, 2);
    const products = [
      { name: 'Valor Africa Tote Bag', image: 'images/Valor%20Shop/52D62502-C0A7-4EDD-AEE3-370A48668A0E.jpg' },
      { name: 'Valor Africa Sweatshirt and Joggers', image: 'images/Valor%20Shop/IMG_0729.jpg' }
    ];

    ticketEvents.forEach((event) => {
      const ticket = event.tickets[0];
      const card = document.createElement('a');
      card.className = 'sponsored-ticket-card sponsored-event-card';
      setEventDetailsLink(card, event);
      card.innerHTML = `<span class="sponsored-ticket-label">TOP TICKET</span><img src="${event.poster || 'images/events/concert-crowd.svg'}" alt="" loading="lazy"><div><small>${event.category}</small><strong>${event.title}</strong><p>${formatMoney(ticket.price, ticket.currency || 'KES')} · ${shortDate(event.startsAt)}</p><span class="sponsored-ticket-button">Get tickets <b aria-hidden="true">→</b></span></div>`;
      track.appendChild(card);
    });

    const brandingCard = document.createElement('a');
    brandingCard.className = 'sponsored-ticket-card sponsored-merch-card';
    brandingCard.href = 'branding.html';
    brandingCard.setAttribute('aria-label', 'Explore event branding and merchandise ideas');
    brandingCard.innerHTML = '<span class="sponsored-ticket-label">EVENT BRANDING</span><picture><source type="image/webp" srcset="images/optimized/w_640/7b3dbcf1bf8b05bc890e6fb02faccc8f.webp"><img src="images/optimized/w_640/7b3dbcf1bf8b05bc890e6fb02faccc8f.jpg" alt="Branded event canopy and flags" loading="lazy"></picture><div><small>For events, vendors &amp; sponsors</small><strong>Make your brand part of the event</strong><p>Explore branded displays and merchandise</p><span class="sponsored-ticket-button">See branding ideas <b aria-hidden="true">→</b></span></div>';
    track.appendChild(brandingCard);

    products.forEach((product) => {
      const card = document.createElement('a');
      card.className = 'sponsored-ticket-card sponsored-merch-card';
      card.href = 'shop.html';
      card.innerHTML = `<span class="sponsored-ticket-label">VALOR COLLECTION</span>${optimizedShopImage(product.image, product.name)}<div><small>Official merchandise</small><strong>${product.name}</strong><p>Explore the Valor Africa collection</p><span class="sponsored-ticket-button">View collection <b aria-hidden="true">→</b></span></div>`;
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

  function createSponsoredEventsRail() {
    const rail = document.createElement('aside');
    rail.className = 'sponsored-ticket-rail sponsored-events-rail';
    rail.setAttribute('aria-label', 'Sponsored events');

    const header = document.createElement('div');
    header.className = 'sponsored-ticket-heading';
    header.innerHTML = '<div><span>✦</span><strong>Sponsored events</strong></div><a href="advertise.html">Promote an event <span aria-hidden="true">→</span></a>';

    const windowEl = document.createElement('div');
    windowEl.className = 'sponsored-ticket-window';
    const track = document.createElement('div');
    track.className = 'sponsored-ticket-track';
    const sponsoredEvents = promotedEvents.filter((event) => Array.isArray(event.tickets) && event.tickets.length);
    if (!sponsoredEvents.length) { rail.hidden = true; }

    sponsoredEvents.slice(0, 5).forEach((event) => {
      const ticket = event.tickets[0];
      const card = document.createElement('a');
      card.className = 'sponsored-ticket-card sponsored-event-card';
      setEventDetailsLink(card, event);
      card.innerHTML = `<span class="sponsored-ticket-label">SPONSORED</span><img src="${event.poster || 'images/events/concert-crowd.svg'}" alt="${event.title}" loading="lazy"><div><small>${event.category} · ${shortDate(event.startsAt)}</small><strong>${event.title}</strong><p>${formatMoney(ticket.price, ticket.currency || 'KES')} · ${event.location}</p><span class="sponsored-ticket-button">Get tickets <b aria-hidden="true">→</b></span></div>`;
      track.appendChild(card);
    });

    [...track.children].forEach((card) => {
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) track.appendChild(card.cloneNode(true));
    });
    windowEl.appendChild(track);
    rail.append(header, windowEl);
    rail.addEventListener('mouseenter', () => track.classList.add('is-paused'));
    rail.addEventListener('mouseleave', () => track.classList.remove('is-paused'));
    rail.addEventListener('focusin', () => track.classList.add('is-paused'));
    rail.addEventListener('focusout', () => track.classList.remove('is-paused'));
    return rail;
  }

  function createSkeletonCard() {
    const card = document.createElement('div');
    card.className = 'event-card is-skeleton';
    card.setAttribute('aria-hidden', 'true');
    card.innerHTML = '<div class="event-poster skeleton-block"></div><div class="event-card-body"><div class="skeleton-line skeleton-line-title"></div><div class="skeleton-line skeleton-line-meta"></div><div class="skeleton-block skeleton-prices"></div><div class="skeleton-line skeleton-line-button"></div></div>';
    return card;
  }

  function renderSkeletonCards(container, count) {
    if (!container) return;
    container.replaceChildren(...Array.from({ length: count }, createSkeletonCard));
  }

  function renderEvents(container, list) {
    if (!container) return;
    const cards = list.map(createEventCard);
    if (container.id === 'featuredEvents') {
      cards.splice(Math.min(2, cards.length), 0, createSponsoredAdRail());
    } else if (container.id === 'allEvents' && list.length >= 8) {
      cards.splice(Math.min(8, cards.length), 0, createSponsoredEventsRail());
    }
    container.replaceChildren(...cards);
  }

  function renderTopSellingEvents() {
    if (!topSellingEventsSection || !topSellingEventsGrid) return;
    const topEvents = events
      .filter((event) => Number(event.ticketsSold) > 0 && Array.isArray(event.tickets) && event.tickets.length)
      .sort((left, right) => Number(right.ticketsSold) - Number(left.ticketsSold) ||
        Date.parse(left.startsAt) - Date.parse(right.startsAt))
      .slice(0, 3);
    topSellingEventsGrid.replaceChildren(...topEvents.map((event) => {
      const card = createEventCard(event);
      card.classList.add('top-selling-event-card');
      const body = card.querySelector('.event-card-body');
      if (body) {
        const sales = document.createElement('p');
        sales.className = 'top-selling-event-sales';
        const count = Number(event.ticketsSold).toLocaleString('en-KE');
        sales.textContent = `${count} confirmed ${Number(event.ticketsSold) === 1 ? 'ticket' : 'tickets'} sold`;
        body.insertBefore(sales, body.querySelector('.event-countdown'));
      }
      return card;
    }));
    topSellingEventsSection.hidden = topEvents.length === 0;
  }

  function renderFeaturedOffers() {
    if (featuredOffers) featuredOffers.replaceChildren(createSponsoredAdRail());
  }

  const featured = document.getElementById('featuredEvents');
  renderSkeletonCards(featured, 4);
  const allEvents = document.getElementById('allEvents');
  renderSkeletonCards(allEvents, 6);
  const topSellingEventsSection = document.getElementById('topSellingEventsSection');
  const topSellingEventsGrid = document.getElementById('topSellingEventsGrid');
  const featuredOffers = document.getElementById('featuredOffers');

  const adSlides = document.getElementById('adSlides');
  const adStage = document.getElementById('adStage');
  const adSoundToggle = document.getElementById('adSoundToggle');
  const adPlayToggle = document.getElementById('adPlayToggle');
  let adObserver = null;
  let adSoundEnabled = false;
  let billboardVideoPlaybackEnabled = false;
  let billboardVideoAutoplayUsed = false;
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let adPaused = reducedMotionQuery.matches;

  function createAdSlide(event, index) {
    const slide = document.createElement('article');
    slide.className = 'ad-slide';
    if (event.isPlatformPromo) {
      slide.classList.add(event.isTicketBuyerPromo ? 'is-ticket-buyer-promo' : 'is-organizer-promo');
    }
    if (event.isSponsoredVideoPromo) slide.classList.add('is-sponsored-video-promo');
    if (event.isPartnershipPromo) slide.classList.add('is-partnership-promo', `is-${event.accent || 'green'}-promo`);
    if (!event.isPlatformPromo && !event.isSponsoredVideoPromo && !event.isPartnershipPromo) {
      slide.classList.add('is-paid-event-promo');
    }
    slide.dataset.adIndex = String(index);
    slide.dataset.eventId = event.id;
    if (event.sponsorshipId) slide.dataset.sponsorshipId = event.sponsorshipId;
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-roledescription', 'slide');
    slide.setAttribute('aria-label', `${index + 1} of ${adEvents.length}: ${event.title}`);

    const visual = document.createElement('div');
    visual.className = 'ad-visual';
    const adPoster = event.adPoster || event.poster || 'images/events/concert-crowd.svg';

    if (event.isPartnershipPromo) {
      if (event.adVideo) {
        const video = document.createElement('video');
        video.className = 'ad-video';
        video.dataset.src = event.adVideo;
        video.poster = adPoster;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = 'none';
        video.setAttribute('aria-label', `Promotional video for ${event.title}`);
        visual.appendChild(video);
      } else {
        const image = document.createElement('img');
        image.className = 'ad-poster';
        image.src = adPoster;
        image.alt = '';
        image.loading = 'lazy';
        visual.appendChild(image);
      }
      const content = document.createElement('div');
      content.className = 'ad-content';
      const category = document.createElement('p');
      category.className = 'ad-category';
      category.textContent = event.category;
      const title = document.createElement('h2');
      title.textContent = event.title;
      const details = document.createElement('p');
      details.className = 'ad-description';
      details.textContent = event.adDescription;
      const cta = document.createElement('a');
      cta.className = 'ad-ticket-cta';
      cta.href = event.adLink;
      cta.innerHTML = `<span>${event.adCta}</span><span aria-hidden="true">→</span>`;
      content.append(category, title, details, cta);
      slide.append(visual, content);
      return slide;
    }

    if (event.isPlatformPromo || event.isSponsoredVideoPromo || event.adVideo) {
      const video = document.createElement('video');
      video.className = 'ad-video';
      video.dataset.src = event.adVideo;
      video.poster = adPoster;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'none';
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
    category.textContent = event.isPlatformPromo || event.isSponsoredVideoPromo
      ? event.category
      : `${event.adPlacement === 'premium' ? '★ PREMIUM PROMOTION' : 'PAID EVENT PROMOTION'} · ${event.category}`;
    const title = document.createElement('h2');
    title.textContent = event.title;
    const details = document.createElement('p');
    details.className = 'ad-description';
    details.textContent = event.isPlatformPromo
      ? 'Discover concerts, festivals and experiences across Africa.'
      : event.isSponsoredVideoPromo
        ? event.adDescription
        : `${event.location} · ${dateLine(event.startsAt)}`;
    const cta = document.createElement('a');
    cta.href = event.isPlatformPromo
      ? event.isTicketBuyerPromo ? 'events.html' : 'host.html'
      : event.isSponsoredVideoPromo ? event.adLink : '#';
    if (!event.isPlatformPromo && !event.isSponsoredVideoPromo) setEventDetailsLink(cta, event);
    cta.className = 'ad-ticket-cta';
    cta.innerHTML = `<span>${event.isPlatformPromo
      ? event.isTicketBuyerPromo ? 'Browse events' : 'Host an event'
      : event.isSponsoredVideoPromo ? event.adCta
        : 'Get tickets'}</span><span aria-hidden="true">→</span>`;
    content.append(category, title, details, cta);
    if (!event.isPlatformPromo && !event.isSponsoredVideoPromo) {
      const ticket = event.tickets?.[0];
      if (ticket) {
        const saleActive = ticket.regularPrice && ticket.saleEnds && new Date(ticket.saleEnds).getTime() > Date.now();
        const price = document.createElement('p');
        price.className = 'ad-price';
        price.textContent = `Tickets from ${formatMoney(saleActive ? ticket.price : ticket.regularPrice || ticket.price, ticket.currency)}`;
        content.insertBefore(price, cta);
      }
    }
    slide.append(visual, content);
    slide.style.setProperty('--ad-index', String(index));
    return slide;
  }

  function getCurrentBillboardVideo() {
    const stage = adStage.getBoundingClientRect();
    const center = stage.left + stage.width / 2;
    const visibleVideos = [...adSlides.querySelectorAll('.ad-slide video')]
      .filter((video) => video.dataset.inBillboard === 'true' && video.dataset.src);
    const candidates = billboardVideoAutoplayUsed
      ? visibleVideos.filter((video) => video.src)
      : visibleVideos;
    return candidates
      .sort((left, right) => (
        Math.abs(left.getBoundingClientRect().left + left.getBoundingClientRect().width / 2 - center)
        - Math.abs(right.getBoundingClientRect().left + right.getBoundingClientRect().width / 2 - center)
      ))[0] || null;
  }

  function updateBillboardPlayback() {
    const currentVideo = getCurrentBillboardVideo();
    adSlides.querySelectorAll('.ad-slide video').forEach((video) => {
      const shouldPlay = video === currentVideo
        && billboardVideoPlaybackEnabled
        && !adPaused
        && !document.hidden;
      if (!shouldPlay) {
        video.pause();
        return;
      }
      if (!video.src) {
        if (billboardVideoAutoplayUsed) return;
        billboardVideoAutoplayUsed = true;
        video.src = video.dataset.src;
      }
      video.play().catch(() => {});
    });
    updateBillboardAudio();
  }

  function updateBillboardAudio() {
    const currentVideo = getCurrentBillboardVideo();
    const targetVideo = adSoundEnabled ? currentVideo : null;
    adSlides.querySelectorAll('video').forEach((video) => {
      video.muted = video !== targetVideo;
    });
    if (adSoundToggle) {
      adSoundToggle.hidden = !currentVideo;
      adSoundToggle.setAttribute('aria-pressed', String(adSoundEnabled));
      adSoundToggle.setAttribute('aria-label', adSoundEnabled ? 'Turn sound off' : 'Turn sound on');
    }
  }

  function setBillboardMotion(paused) {
    adPaused = paused;
    adStage.classList.toggle('is-paused', adPaused);
    adPlayToggle?.setAttribute('aria-pressed', String(adPaused));
    adPlayToggle?.setAttribute('aria-label', adPaused ? 'Resume billboard movement' : 'Pause billboard movement');
    adPlayToggle?.classList.toggle('is-paused', adPaused);
    if (adPlayToggle) adPlayToggle.title = adPaused ? 'Resume billboard movement' : 'Pause billboard movement';
    updateBillboardPlayback();
  }

  function observeBillboardSponsorImpression(element, sponsorshipId) {
    if (!('IntersectionObserver' in window) || !window.crypto?.randomUUID) return;
    let timer = null;
    let recorded = false;
    let isViewable = false;
    let observer;

    function stopTimer() {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    }

    function startTimer() {
      if (recorded || timer !== null || !isViewable || document.visibilityState !== 'visible') return;
      timer = window.setTimeout(async () => {
        timer = null;
        if (recorded || !isViewable || document.visibilityState !== 'visible') return;
        recorded = true;
        observer.disconnect();
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        try {
          await window.valorEventsApi(`/api/sponsorships/${encodeURIComponent(sponsorshipId)}/viewable-impressions`, {
            method: 'POST',
            keepalive: true,
            body: JSON.stringify({ impressionId: window.crypto.randomUUID(), placement: 'homepage-billboard' })
          });
        } catch (error) {
          console.error('Could not record the billboard viewable impression:', error.message);
        }
      }, 1000);
    }

    observer = new IntersectionObserver(([entry]) => {
      isViewable = entry.isIntersecting && entry.intersectionRatio >= 0.5;
      if (isViewable) startTimer();
      else stopTimer();
    }, { threshold: [0, 0.5] });

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') startTimer();
      else stopTimer();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    observer.observe(element);
  }

  function renderAdSlides() {
    if (!adSlides || !adStage) return;
    if (adObserver) adObserver.disconnect();
    adSlides.replaceChildren();
    const group = document.createElement('div');
    group.className = 'ad-billboard-group';
    group.setAttribute('role', 'list');
    group.setAttribute('aria-label', 'Valor Africa promotions, partners and promoted events');
    adEvents.forEach((event, index) => {
      const slide = createAdSlide(event, index);
      slide.setAttribute('role', 'listitem');
      group.appendChild(slide);
    });
    group.querySelectorAll('[data-sponsorship-id]').forEach((slide) => {
      observeBillboardSponsorImpression(slide, slide.dataset.sponsorshipId);
    });
    const duplicate = group.cloneNode(true);
    duplicate.setAttribute('aria-hidden', 'true');
    duplicate.removeAttribute('aria-label');
    duplicate.querySelectorAll('a,button').forEach((control) => control.setAttribute('tabindex', '-1'));
    duplicate.querySelectorAll('video').forEach((video) => {
      video.pause();
      video.removeAttribute('src');
      video.removeAttribute('data-src');
      video.removeAttribute('aria-label');
      video.preload = 'none';
    });
    adSlides.replaceChildren(group, duplicate);
    adSlides.style.setProperty('--ad-billboard-duration', `${Math.max(30, group.scrollWidth / 44)}s`);
    if ('IntersectionObserver' in window) {
      adObserver = new IntersectionObserver((entries) => {
        entries.forEach(({ target: video, isIntersecting }) => {
          video.dataset.inBillboard = String(isIntersecting);
        });
        updateBillboardPlayback();
      });
      adSlides.querySelectorAll('video[data-src]').forEach((video) => adObserver.observe(video));
    } else {
      adSlides.querySelectorAll('video[data-src]').forEach((video) => {
        video.dataset.inBillboard = 'true';
      });
      updateBillboardPlayback();
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setBillboardMotion(true);
    else setBillboardMotion(adPaused);
    updateBillboardPlayback();
  }

  if (adSlides && adStage) {
    renderAdSlides();
    const enableVideosWhenIdle = () => {
      const enable = () => {
        billboardVideoPlaybackEnabled = true;
        updateBillboardPlayback();
      };
      if (window.requestIdleCallback) window.requestIdleCallback(enable, { timeout: 2500 });
      else window.setTimeout(enable, 1200);
    };
    if (document.readyState === 'complete') enableVideosWhenIdle();
    else window.addEventListener('load', enableVideosWhenIdle, { once: true });
    if (adPlayToggle) {
      adPlayToggle.addEventListener('click', () => setBillboardMotion(!adPaused));
    }
    adSoundToggle?.addEventListener('click', () => {
      adSoundEnabled = !adSoundEnabled;
      updateBillboardAudio();
    });
    document.addEventListener('visibilitychange', () => {
      updateBillboardPlayback();
    });
    reducedMotionQuery.addEventListener('change', (event) => setBillboardMotion(event.matches));
  }

  const nextCountdown = document.getElementById('nextEventCountdown');
  function updateNextCountdown() {
    if (!nextCountdown) return;
    const next = events
      .filter((event) => new Date(event.startsAt).getTime() > Date.now())
      .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt))[0];
    nextCountdown.textContent = next ? `◷ ${countdown(next.startsAt, 'Next event')}` : '◷ New events coming soon';
    nextCountdown.dataset.countdownTo = next ? next.startsAt : '';
  }
  updateNextCountdown();

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
    if (empty) {
      empty.hidden = visible > 0 || listingAvailable !== true;
      if (!events.length) {
        empty.textContent = 'No approved upcoming events are listed right now. Browse all events or check back soon.';
      } else {
        empty.innerHTML = 'No events match your search yet. <a href="events.html">Browse all events</a>.';
      }
    }
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
  const allCities = document.getElementById('allCities');
  const allSearch = document.getElementById('eventSearch');
  if (allCategories) {
    const requestedCategory = new URLSearchParams(window.location.search).get('category');
    const requestedCategoryChip = Array.from(allCategories.querySelectorAll('button[data-category]'))
      .find((button) => button.dataset.category === requestedCategory);
    if (requestedCategoryChip) {
      allCategories.querySelectorAll('button[data-category]').forEach((chip) => {
        const isActive = chip === requestedCategoryChip;
        chip.classList.toggle('is-active', isActive);
        chip.setAttribute('aria-pressed', String(isActive));
      });
    }
  }
  if (allCities) {
    const requestedCity = new URLSearchParams(window.location.search).get('city');
    const requestedCityChip = requestedCity
      ? Array.from(allCities.querySelectorAll('button[data-city]'))
        .find((button) => button.dataset.city.toLowerCase() === requestedCity.toLowerCase())
      : null;
    if (requestedCityChip) {
      allCities.querySelectorAll('button[data-city]').forEach((chip) => {
        const isActive = chip === requestedCityChip;
        chip.classList.toggle('is-active', isActive);
        chip.setAttribute('aria-pressed', String(isActive));
      });
      const cityName = requestedCityChip.dataset.city;
      const cityDescription = `Browse upcoming events in ${cityName}, Kenya with Valor Africa Events & Tickets. Find concerts, festivals, sports, arts, and community gatherings, then check available ticket options.`;
      const canonicalHref = `https://valorafrica.co.ke/events.html?city=${encodeURIComponent(cityName)}`;
      document.title = `Events & Tickets in ${cityName}, Kenya | Valor Africa`;
      const setMetaContent = (selector, content) => {
        const element = document.head.querySelector(selector);
        if (element) element.setAttribute('content', content);
      };
      setMetaContent('meta[name="description"]', cityDescription);
      setMetaContent('meta[property="og:title"]', document.title);
      setMetaContent('meta[property="og:description"]', cityDescription);
      setMetaContent('meta[property="og:url"]', canonicalHref);
      const canonicalLink = document.head.querySelector('link[rel="canonical"]');
      if (canonicalLink) canonicalLink.href = canonicalHref;
      const heading = document.querySelector('.page-intro h1');
      if (heading) heading.textContent = `Upcoming events & tickets in ${cityName}, Kenya`;
    }
  }
  let refreshAllEvents = () => {};
  if (allCategories && allEvents) {
    const filterAllEvents = () => {
      const active = allCategories.querySelector('.is-active');
      const category = active ? active.dataset.category : 'All';
      const activeCity = allCities ? allCities.querySelector('.is-active') : null;
      const city = activeCity ? activeCity.dataset.city : 'All';
      const query = allSearch ? allSearch.value.trim().toLowerCase() : '';
      let visible = 0;
      allEvents.querySelectorAll('.event-card').forEach((card) => {
        const event = events.find((item) => item.id === card.dataset.eventId);
        const matchesCategory = category === 'All' || event.category === category;
        const matchesCity = city === 'All' || (event.city || '').toLowerCase().includes(city.toLowerCase());
        const matchesQuery = !query || `${event.title} ${event.location} ${event.category}`.toLowerCase().includes(query);
        const show = matchesCategory && matchesCity && matchesQuery;
        card.hidden = !show;
        if (show) visible += 1;
      });
      const noResults = document.getElementById('noResults');
      if (noResults) {
        noResults.hidden = listingAvailable !== true || visible > 0;
        noResults.textContent = events.length
          ? 'No events match that search. Try another name, category, or city.'
          : 'No approved upcoming events are listed right now. Check back soon.';
      }
      allEvents.querySelectorAll('.sponsored-ticket-rail').forEach((rail) => {
        rail.hidden = visible === 0 && rail.classList.contains('sponsored-events-rail');
      });
    };
    refreshAllEvents = filterAllEvents;
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
    if (allCities) {
      allCities.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-city]');
        if (!button) return;
        allCities.querySelectorAll('button').forEach((chip) => {
          const isActive = chip === button;
          chip.classList.toggle('is-active', isActive);
          chip.setAttribute('aria-pressed', String(isActive));
        });
        filterAllEvents();
      });
    }
    if (allSearch) allSearch.addEventListener('input', filterAllEvents);
  }

  function updateListingStatus() {
    const status = document.querySelector('.listing-disclaimer, .hub-bottom p');
    const retryButton = document.getElementById('retryEventListings');
    if (retryButton) {
      retryButton.hidden = listingAvailable !== false;
      retryButton.disabled = listingRequestInProgress;
    }
    if (!status) return;
    status.firstChild.textContent = listingAvailable === null
      ? 'Loading live event listings… '
      : !listingAvailable
        ? 'Could not connect to live event listings. We’ll retry automatically. '
      : !events.length
        ? 'No approved upcoming events are listed right now. Check back soon or submit an event for review.'
        : !paymentHealthAvailable
          ? 'Event listings are available. Ticket payment options may be temporarily unavailable.'
          : checkoutEnabled
            ? `Paid tickets are available through ${[
              mpesaCheckoutEnabled && 'M-Pesa',
              stripeCheckoutEnabled && 'Stripe Checkout',
              nowpaymentsCheckoutEnabled && 'NOWPayments',
              paypalCheckoutEnabled && 'PayPal',
              googlePayCheckoutEnabled && 'Google Pay',
              applePayCheckoutEnabled && 'Apple Pay'
            ].filter(Boolean).join(' and ')}. Tickets are issued only after payment is confirmed.`
            : 'Paid ticket checkout is temporarily unavailable. Free-event registrations remain open.';
  }

  function refreshPromotionalCarousel() {
    adEvents = [
      ...featuredVideoPromos,
      ...billboardSponsors,
      ...billboardPromos,
      ...homepagePromotedEvents
    ];
    renderAdSlides();
    const adNote = document.querySelector('.ad-note');
    if (adNote) adNote.textContent = 'Featured on Valor Africa · sponsored events';
    const sponsoredBadge = document.querySelector('.sponsored-badge');
    if (sponsoredBadge) sponsoredBadge.hidden = !adEvents.length;
  }

  async function refreshLiveEvents() {
    if (!requestEventListing || listingRequestInProgress) return;
    listingRequestInProgress = true;
    updateListingStatus();
    if (listingRetryTimer) window.clearTimeout(listingRetryTimer);
    listingRetryTimer = null;
    try {
      let listing;
      try {
        listing = await requestEventListing();
      } catch (error) {
        console.warn('The first live event listing request failed; retrying once:', error);
        listing = await requestEventListing();
      }
      if (!listing || !Array.isArray(listing.events)) {
        throw new Error('The event service returned an invalid event list.');
      }
      events = listing.events.map((event) => toPublicEvent(event, listing.apiBase));
      events.sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
      listingAvailable = true;
    } catch (error) {
      listingAvailable = false;
      console.error('Live event listings could not be loaded:', error);
    } finally {
      listingRequestInProgress = false;
    }

    if (featured) renderEvents(featured, events);
    if (allEvents) renderEvents(allEvents, events);
    renderTopSellingEvents();
    renderFeaturedOffers();
    applyHomeFilters();
    refreshAllEvents();
    updateNextCountdown();
    refreshPromotionalCarousel();
    updateListingStatus();
    if (!listingAvailable) {
      listingRetryTimer = window.setTimeout(refreshLiveEvents, 15000);
    }
  }

  document.getElementById('retryEventListings')?.addEventListener('click', refreshLiveEvents);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && listingAvailable === false) refreshLiveEvents();
  });
  refreshLiveEvents();

  promotionDataPromise.then((data) => {
    if (!data) return;
    promotedEvents = data.featuredEvents;
    homepagePromotedEvents = data.homepageEvents;
    billboardSponsors = data.billboardSponsors;
    if (data.featuredError) console.warn('Sponsored event listings could not be loaded:', data.featuredError);
    if (featured) renderEvents(featured, events);
    if (allEvents) renderEvents(allEvents, events);
    renderTopSellingEvents();
    renderFeaturedOffers();
    applyHomeFilters();
    refreshAllEvents();
    refreshPromotionalCarousel();
    if (data.health) {
      paymentHealthAvailable = true;
      mpesaCheckoutEnabled = Boolean(data.health.paymentsConfigured);
      stripeCheckoutEnabled = Boolean(data.health.stripePaymentsConfigured);
      nowpaymentsCheckoutEnabled = Boolean(data.health.nowpaymentsConfigured);
      paypalCheckoutEnabled = Boolean(data.health.paypalConfigured);
      googlePayCheckoutEnabled = Boolean(data.health.googlePayConfigured);
      applePayConfigured = Boolean(data.health.applePayConfigured);
      applePayCheckoutEnabled = applePayConfigured &&
        Boolean(window.valorApplePay && window.valorApplePay.isSupported());
      nowpaymentsKesPerUsd = Number(data.health.nowpaymentsKesPerUsd) || null;
      googlePayKesPerUsd = Number(data.health.googlePayKesPerUsd) || null;
      applePayKesPerUsd = Number(data.health.applePayKesPerUsd) || null;
      checkoutEnabled = mpesaCheckoutEnabled || stripeCheckoutEnabled || nowpaymentsCheckoutEnabled || paypalCheckoutEnabled || googlePayCheckoutEnabled || applePayCheckoutEnabled;
      if (paymentMethodSelect && buyerPhoneInput && ticketPaymentNote && ticketForm) {
        updateTicketPaymentMethod();
      }
    } else {
      console.warn('Payment availability could not be confirmed:', data.healthError);
    }
    refreshPromotionalCarousel();
    updateListingStatus();
  }).catch((error) => {
    console.error('Could not update sponsored event and payment information:', error);
  });

  const ticketDialog = document.getElementById('ticketDialog');
  const ticketSelect = document.getElementById('ticketType');
  const paymentMethodSelect = document.getElementById('ticketPaymentMethod');
  const buyerPhoneInput = document.getElementById('buyerPhone');
  const ticketPaymentNote = document.getElementById('ticketPaymentNote');
  const cryptoPriceEstimate = document.getElementById('cryptoPriceEstimate');
  const googlePayPriceEstimate = document.getElementById('googlePayPriceEstimate');
  const googlePayStatus = document.getElementById('googlePayStatus');
  const googlePayButtonContainer = document.getElementById('googlePayButtonContainer');
  const applePayPriceEstimate = document.getElementById('applePayPriceEstimate');
  const applePayStatus = document.getElementById('applePayStatus');
  const applePayButtonContainer = document.getElementById('applePayButtonContainer');
  const ticketForm = document.getElementById('ticketRequestForm');
  let googlePayReady = false;
  let googlePayPreparation = null;
  let googlePaySubmitting = false;
  let applePayReady = false;
  let applePayPreparation = null;
  let applePaySubmitting = false;
  const ticketDraftKey = 'valor-pending-ticket';
  const ticketReturnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const accountLink = ticketDialog && ticketDialog.querySelector('a[href="account.html"]');
  if (accountLink) {
    accountLink.href = `account.html?returnTo=${encodeURIComponent(ticketReturnTo)}`;
    accountLink.addEventListener('click', () => {
      if (!window.valorAccountToken()) saveTicketDraft();
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
    const mpesaTicketOption = paymentMethodSelect.querySelector('option[value="mpesa"]');
    if (mpesaTicketOption && paymentHealthAvailable) {
      mpesaTicketOption.disabled = !mpesaCheckoutEnabled;
      mpesaTicketOption.textContent = mpesaCheckoutEnabled ? 'M-Pesa' : 'M-Pesa (coming soon)';
    }
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
    const paypalTicketOption = paymentMethodSelect.querySelector('option[value="paypal"]');
    if (paypalTicketOption) {
      paypalTicketOption.disabled = !paypalCheckoutEnabled;
      paypalTicketOption.textContent = paypalCheckoutEnabled ? 'PayPal' : 'PayPal (coming soon)';
    }
    const googlePayTicketOption = paymentMethodSelect.querySelector('option[value="googlepay"]');
    if (googlePayTicketOption) {
      googlePayTicketOption.disabled = !googlePayCheckoutEnabled;
      googlePayTicketOption.textContent = googlePayCheckoutEnabled ? 'Google Pay' : 'Google Pay (coming soon)';
    }
    const applePayTicketOption = paymentMethodSelect.querySelector('option[value="applepay"]');
    if (applePayTicketOption) {
      applePayTicketOption.disabled = !applePayCheckoutEnabled;
      applePayTicketOption.textContent = !applePayConfigured
        ? 'Apple Pay (coming soon)'
        : applePayCheckoutEnabled ? 'Apple Pay' : 'Apple Pay (not available on this device)';
    }
    const selectedTicket = activeEvent && activeEvent.tickets.find((item) => item.name === ticketSelect.value);
    const isFreeTicket = Number(selectedTicket && selectedTicket.price) === 0;
    if (!isFreeTicket) {
      const selectedOption = Array.from(paymentMethodSelect.options).find((option) => option.value === paymentMethodSelect.value);
      if (selectedOption && selectedOption.disabled) {
        const fallback = ['mpesa','paypal','googlepay','applepay','nowpayments','stripe','wallet'].find((method) =>
          Array.from(paymentMethodSelect.options).some((option) => option.value === method && !option.disabled)
        );
        if (fallback) paymentMethodSelect.value = fallback;
      }
    }
    const usesWallet = !isFreeTicket && paymentMethodSelect.value === 'wallet';
    const usesStripe = !isFreeTicket && paymentMethodSelect.value === 'stripe';
    const usesNowpayments = !isFreeTicket && paymentMethodSelect.value === 'nowpayments';
    const usesPaypal = !isFreeTicket && paymentMethodSelect.value === 'paypal';
    const usesGooglePay = !isFreeTicket && paymentMethodSelect.value === 'googlepay';
    const usesApplePay = !isFreeTicket && paymentMethodSelect.value === 'applepay';
    const paymentMethodLabel = document.getElementById('ticketPaymentMethodLabel');
    if (paymentMethodLabel) paymentMethodLabel.hidden = isFreeTicket;
    paymentMethodSelect.hidden = isFreeTicket;
    paymentMethodSelect.disabled = isFreeTicket;
    buyerPhoneInput.required = isFreeTicket || (!usesWallet && !usesNowpayments && !usesPaypal && !usesGooglePay && !usesApplePay);
    buyerPhoneInput.disabled = !isFreeTicket && (usesWallet || usesNowpayments || usesPaypal || usesGooglePay || usesApplePay);
    const buyerPhoneLabel = document.querySelector('label[for="buyerPhone"]');
    if (buyerPhoneLabel) buyerPhoneLabel.hidden = usesPaypal || usesGooglePay || usesApplePay;
    if (buyerPhoneLabel) buyerPhoneLabel.firstChild.textContent = usesWallet
      ? 'M-Pesa number (not needed for wallet)'
      : isFreeTicket ? 'WhatsApp number'
        : usesPaypal ? 'Phone number' : usesStripe ? 'Contact phone number' : usesNowpayments ? 'WhatsApp number (not needed for crypto)' : 'WhatsApp number';
    ticketPaymentNote.textContent = isFreeTicket
      ? 'No payment is required. Your confirmed ticket will be emailed to your account; use the WhatsApp button after registration to send a copy.'
      : usesWallet
      ? 'Your verified wallet balance will be charged immediately. Tickets are issued as soon as payment succeeds.'
      : usesStripe
        ? 'Continue to Stripe Checkout to pay by card. Your ticket is issued after Stripe confirms payment.'
        : usesNowpayments
          ? 'Continue to NOWPayments to choose a supported cryptocurrency. Your ticket is issued only after payment is confirmed.'
          : usesPaypal
            ? 'Continue to PayPal to pay securely. Your ticket is issued after PayPal confirms payment.'
            : usesGooglePay
              ? 'Authorize payment securely with Google Pay. Your ticket is issued after Braintree confirms the charge.'
            : usesApplePay
              ? 'Authorize payment securely with Apple Pay. Your ticket is issued after Braintree confirms the charge.'
          : 'You will receive an M-Pesa payment prompt. Your ticket is issued only after payment is confirmed.';
    const paymentLabel = usesWallet ? 'Valor Wallet' : usesStripe ? 'Stripe Checkout' : usesNowpayments ? 'NOWPayments' : usesPaypal ? 'PayPal' : usesGooglePay ? 'Google Pay' : usesApplePay ? 'Apple Pay' : 'M-Pesa';
    if (cryptoPriceEstimate) {
      const ticket = activeEvent?.tickets.find((item) => item.name === ticketSelect.value);
      const quantity = Number(ticketForm.elements.quantity.value) || 1;
      const kesTotal = Number(ticket?.price) * quantity;
      cryptoPriceEstimate.hidden = !usesNowpayments;
      cryptoPriceEstimate.textContent = usesNowpayments && nowpaymentsKesPerUsd && Number.isFinite(kesTotal)
        ? `Estimated total: $${(kesTotal / nowpaymentsKesPerUsd).toFixed(2)} USD. The final crypto amount is set by NOWPayments.`
        : 'The final USD estimate will be shown at checkout.';
    }
    if (googlePayPriceEstimate) {
      const ticket = activeEvent?.tickets.find((item) => item.name === ticketSelect.value);
      const quantity = Number(ticketForm.elements.quantity.value) || 1;
      const kesTotal = Number(ticket?.price) * quantity;
      const amountUsd = Math.round((kesTotal / googlePayKesPerUsd) * 100) / 100;
      googlePayPriceEstimate.hidden = !usesGooglePay || !Number.isFinite(amountUsd) ||
        !Number.isFinite(googlePayKesPerUsd) || googlePayKesPerUsd <= 0 || amountUsd <= 0;
      googlePayPriceEstimate.textContent = googlePayPriceEstimate.hidden
        ? ''
        : `Google Pay total: USD ${amountUsd.toFixed(2)} (KES ${kesTotal.toLocaleString('en-KE')} at 1 USD = KES ${googlePayKesPerUsd.toLocaleString('en-KE')}).`;
    }
    if (applePayPriceEstimate) {
      const ticket = activeEvent?.tickets.find((item) => item.name === ticketSelect.value);
      const quantity = Number(ticketForm.elements.quantity.value) || 1;
      const kesTotal = Number(ticket?.price) * quantity;
      const amountUsd = Math.round((kesTotal / applePayKesPerUsd) * 100) / 100;
      applePayPriceEstimate.hidden = !usesApplePay || !Number.isFinite(amountUsd) ||
        !Number.isFinite(applePayKesPerUsd) || applePayKesPerUsd <= 0 || amountUsd <= 0;
      applePayPriceEstimate.textContent = applePayPriceEstimate.hidden
        ? ''
        : `Apple Pay total: USD ${amountUsd.toFixed(2)} (KES ${kesTotal.toLocaleString('en-KE')} at 1 USD = KES ${applePayKesPerUsd.toLocaleString('en-KE')}).`;
    }
    const submitButton = ticketForm.querySelector('[type=submit]');
    if (isFreeTicket) submitButton.textContent = 'Get free ticket';
    else submitButton.innerHTML = usesPaypal
      ? 'Continue to PayPal <span aria-hidden="true">→</span>'
      : `Pay with ${paymentLabel} <span aria-hidden="true">→</span>`;
    if (googlePayButtonContainer) {
      googlePayButtonContainer.hidden = !usesGooglePay || !googlePayReady;
    }
    if (applePayButtonContainer) {
      applePayButtonContainer.hidden = !usesApplePay || !applePayReady;
    }
    if (googlePayStatus && !usesGooglePay) googlePayStatus.hidden = true;
    if (applePayStatus && !usesApplePay) applePayStatus.hidden = true;
    if (usesGooglePay) {
      const accountToken = window.valorAccountToken();
      if (!accountToken) {
        submitButton.hidden = false;
        if (googlePayStatus && googlePayCheckoutEnabled) {
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
      const accountToken = window.valorAccountToken();
      if (!accountToken) {
        submitButton.hidden = false;
        if (applePayStatus && applePayCheckoutEnabled) {
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
  }
  const prepareGooglePay = () => {
    const accountToken = window.valorAccountToken();
    if (!googlePayCheckoutEnabled || !accountToken || googlePayReady || googlePayPreparation) return;
    googlePayStatus.textContent = 'Preparing Google Pay…';
    googlePayStatus.hidden = false;
    googlePayPreparation = window.valorGooglePay.prepare({
      api: window.valorEventsApi,
      accountToken
    }).then(() => {
      googlePayReady = true;
      if (paymentMethodSelect.value === 'googlepay') {
        window.valorGooglePay.mountButton(googlePayButtonContainer, submitGooglePayTicket);
        googlePayButtonContainer.hidden = false;
        googlePayStatus.hidden = true;
        ticketForm.querySelector('[type=submit]').hidden = true;
      }
    }).catch((error) => {
      const option = paymentMethodSelect.querySelector('option[value="googlepay"]');
      if (option) {
        option.disabled = true;
        option.textContent = 'Google Pay unavailable';
      }
      const fallback = ['mpesa','paypal','applepay','nowpayments','stripe','wallet'].find((method) =>
        Array.from(paymentMethodSelect.options).some((entry) => entry.value === method && !entry.disabled)
      );
      if (fallback) paymentMethodSelect.value = fallback;
      updateTicketPaymentMethod();
      googlePayStatus.textContent = error.message;
      googlePayStatus.hidden = false;
    }).finally(() => { googlePayPreparation = null; });
  };
  const prepareApplePay = () => {
    const accountToken = window.valorAccountToken();
    if (!applePayCheckoutEnabled || !accountToken || applePayReady || applePayPreparation) return;
    applePayStatus.textContent = 'Preparing Apple Pay…';
    applePayStatus.hidden = false;
    applePayPreparation = window.valorApplePay.prepare({
      api: window.valorEventsApi,
      accountToken
    }).then(() => {
      applePayReady = true;
      if (paymentMethodSelect.value === 'applepay') {
        window.valorApplePay.mountButton(applePayButtonContainer, submitApplePayTicket);
        applePayButtonContainer.hidden = false;
        applePayStatus.hidden = true;
        ticketForm.querySelector('[type=submit]').hidden = true;
      }
    }).catch((error) => {
      const option = paymentMethodSelect.querySelector('option[value="applepay"]');
      if (option) {
        option.disabled = true;
        option.textContent = 'Apple Pay unavailable';
      }
      const fallback = ['mpesa','paypal','googlepay','nowpayments','stripe','wallet'].find((method) =>
        Array.from(paymentMethodSelect.options).some((entry) => entry.value === method && !entry.disabled)
      );
      if (fallback) paymentMethodSelect.value = fallback;
      updateTicketPaymentMethod();
      applePayStatus.textContent = error.message;
      applePayStatus.hidden = false;
    }).finally(() => { applePayPreparation = null; });
  };
  const submitGooglePayTicket = async () => {
    if (googlePaySubmitting || !ticketForm.reportValidity()) return;
    if (!activeEvent) return;
    const accountToken = window.valorAccountToken();
    if (!accountToken) {
      showAccountSignIn(document.getElementById('ticketFeedback'));
      return;
    }
    const data = new FormData(ticketForm);
    const ticket = activeEvent.tickets.find((item) => item.name === data.get('ticketType'));
    const quantity = Number(data.get('quantity'));
    if (!ticket || Number(ticket.price) <= 0 ||
        !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10) {
      showError(document.getElementById('ticketFeedback'), 'Choose a valid paid ticket and quantity.');
      return;
    }
    const totalKes = Number(ticket.price) * quantity;
    const amountUsd = Math.round((totalKes / googlePayKesPerUsd) * 100) / 100;
    if (!Number.isFinite(amountUsd) || amountUsd < 0.01) {
      showError(document.getElementById('ticketFeedback'), 'This ticket total is below the minimum Google Pay amount.');
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
      order = await window.valorEventsApi('/api/orders/tickets', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accountToken}` },
        body: JSON.stringify({
          eventId: activeEvent.id,
          ticketType: ticket.name,
          quantity,
          buyerName: data.get('name'),
          phone: '',
          paymentMethod: 'googlepay',
          googlePayQuotedAmountUsd: amountUsd,
          affiliateReferralToken: window.valorAffiliateReferralToken()
        })
      });
      window.sessionStorage.setItem(`valor-order-${order.orderId}`, order.accessToken);
      await window.valorEventsApi(`/api/orders/${encodeURIComponent(order.orderId)}/googlepay-capture`, {
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
        window.sessionStorage.setItem(`valor-order-${order.orderId}`, order.accessToken);
        window.location.assign(`order.html?orderId=${encodeURIComponent(order.orderId)}`);
        return;
      }
      if (/session has expired|sign in to your valor africa account/i.test(error.message)) {
        window.valorClearAccountToken();
        showAccountSignIn(document.getElementById('ticketFeedback'));
      } else {
        showError(document.getElementById('ticketFeedback'), error.message);
      }
      googlePayStatus.hidden = true;
    } finally {
      googlePaySubmitting = false;
    }
  };
  const submitApplePayTicket = async () => {
    if (applePaySubmitting || !ticketForm.reportValidity()) return;
    if (!activeEvent) return;
    const accountToken = window.valorAccountToken();
    if (!accountToken) {
      showAccountSignIn(document.getElementById('ticketFeedback'));
      return;
    }
    const data = new FormData(ticketForm);
    const ticket = activeEvent.tickets.find((item) => item.name === data.get('ticketType'));
    const quantity = Number(data.get('quantity'));
    if (!ticket || Number(ticket.price) <= 0 ||
        !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10) {
      showError(document.getElementById('ticketFeedback'), 'Choose a valid paid ticket and quantity.');
      return;
    }
    const totalKes = Number(ticket.price) * quantity;
    const amountUsd = Math.round((totalKes / applePayKesPerUsd) * 100) / 100;
    if (!Number.isFinite(amountUsd) || amountUsd < 0.01) {
      showError(document.getElementById('ticketFeedback'), 'This ticket total is below the minimum Apple Pay amount.');
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
          order = await window.valorEventsApi('/api/orders/tickets', {
            method: 'POST',
            headers: { Authorization: `Bearer ${accountToken}` },
            body: JSON.stringify({
              eventId: activeEvent.id,
              ticketType: ticket.name,
              quantity,
              buyerName: data.get('name'),
              phone: '',
              paymentMethod: 'applepay',
              applePayQuotedAmountUsd: amountUsd,
              affiliateReferralToken: window.valorAffiliateReferralToken()
            })
          });
          window.sessionStorage.setItem(`valor-order-${order.orderId}`, order.accessToken);
          return window.valorEventsApi(`/api/orders/${encodeURIComponent(order.orderId)}/applepay-capture`, {
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
        window.sessionStorage.setItem(`valor-order-${order.orderId}`, order.accessToken);
        window.location.assign(`order.html?orderId=${encodeURIComponent(order.orderId)}`);
        return;
      }
      if (/session has expired|sign in to your valor africa account/i.test(error.message)) {
        window.valorClearAccountToken();
        showAccountSignIn(document.getElementById('ticketFeedback'));
      } else {
        showError(document.getElementById('ticketFeedback'), error.message);
      }
      applePayStatus.hidden = true;
    } finally {
      applePaySubmitting = false;
    }
  };
  if (paymentMethodSelect && buyerPhoneInput && ticketPaymentNote && ticketForm) {
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
    paymentMethodSelect.value = mpesaCheckoutEnabled
      ? 'mpesa'
      : paypalCheckoutEnabled ? 'paypal'
        : googlePayCheckoutEnabled ? 'googlepay'
          : applePayCheckoutEnabled ? 'applepay'
            : nowpaymentsCheckoutEnabled ? 'nowpayments'
            : stripeCheckoutEnabled ? 'stripe' : 'wallet';
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
      const isFreeTicket = Number(ticket.price) === 0;
      const paymentMethod = isFreeTicket ? 'mpesa' : data.get('paymentMethod');
      const accountToken = window.valorAccountToken();
      if (!accountToken) {
        showAccountSignIn(ticketFeedback);
        return;
      }
      if (!isFreeTicket && paymentMethod === 'googlepay') {
        ticketFeedback.textContent = 'Use the Google Pay button to authorize this payment.';
        ticketFeedback.classList.add('error');
        return;
      }
      if (!isFreeTicket && paymentMethod === 'applepay') {
        ticketFeedback.textContent = 'Use the Apple Pay button to authorize this payment.';
        ticketFeedback.classList.add('error');
        return;
      }
      if (!isFreeTicket && paymentMethod === 'mpesa' && !mpesaCheckoutEnabled) {
        ticketFeedback.textContent = apiBase
          ? 'M-Pesa checkout is not available right now. Choose another available payment method or try again later.'
          : 'Secure ticket checkout is not connected on this preview website yet.';
        ticketFeedback.classList.add('error');
        return;
      }
      if (!isFreeTicket && paymentMethod === 'stripe' && !stripeCheckoutEnabled) {
        ticketFeedback.textContent = 'Stripe Checkout is not configured yet. Choose another available payment method instead.';
        ticketFeedback.classList.add('error');
        return;
      }
      if (!isFreeTicket && paymentMethod === 'nowpayments' && !nowpaymentsCheckoutEnabled) {
        ticketFeedback.textContent = 'NOWPayments is not configured yet. Choose another available payment method instead.';
        ticketFeedback.classList.add('error');
        return;
      }
      if (!isFreeTicket && paymentMethod === 'paypal' && !paypalCheckoutEnabled) {
        ticketFeedback.textContent = 'PayPal is not configured yet. Choose another available payment method instead.';
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
            : paymentMethod === 'nowpayments' ? 'Starting NOWPayments checkout…'
              : paymentMethod === 'paypal' ? 'Redirecting to PayPal…'
                : paymentMethod === 'googlepay' ? 'Preparing Google Pay…'
                  : paymentMethod === 'applepay' ? 'Preparing Apple Pay…' : 'Sending an M-Pesa payment prompt…';
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
          window.valorClearAccountToken();
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
    const categoryInput = document.getElementById('eventCategory');
    const movieListingFields = document.getElementById('movieListingFields');
    const movieShowtimesInput = document.getElementById('movieShowtimes');
    const movieRuntimeInput = document.getElementById('movieRuntime');
    const eventStartField = startsInput.closest('.form-field');
    const eventEndField = endsInput.closest('.form-field');
    const earlyBirdPriceInput = document.getElementById('earlyBirdPrice');
    const earlyBirdEndsInput = document.getElementById('earlyBirdEnds');
    const regularTicketPriceInput = document.getElementById('ticketPrice');
    const freeRegularTicketToggle = document.getElementById('freeRegularTicket');
    const regularTicketPriceField = document.getElementById('regularTicketPriceField');
    const freeTicketPriceDisplay = document.getElementById('freeTicketPriceDisplay');
    const ticketPriceHint = document.getElementById('ticketPriceHint');
    let lastPaidTicketPrice = '';
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

    function isMovieListing() {
      return /movie|cinema|film/i.test(categoryInput.value);
    }

    function updateRegularTicketPriceMode() {
      const isFree = freeRegularTicketToggle.checked;
      regularTicketPriceField.hidden = isFree;
      freeTicketPriceDisplay.hidden = !isFree;
      regularTicketPriceInput.required = !isFree;
      regularTicketPriceInput.min = isFree ? '0' : '1';
      ticketPriceHint.textContent = isFree
        ? 'Regular tickets cost nothing. Paid VIP tickets can still be added below.'
        : 'Enter a whole-number KES price for each Regular ticket.';
    }

    updateRegularTicketPriceMode();
    freeRegularTicketToggle.addEventListener('change', () => {
      if (freeRegularTicketToggle.checked) {
        if (Number(regularTicketPriceInput.value) > 0) lastPaidTicketPrice = regularTicketPriceInput.value;
        regularTicketPriceInput.value = '0';
      } else {
        regularTicketPriceInput.value = lastPaidTicketPrice;
      }
      updateRegularTicketPriceMode();
    });
    regularTicketPriceInput.addEventListener('input', () => {
      if (!freeRegularTicketToggle.checked) lastPaidTicketPrice = regularTicketPriceInput.value;
    });

    function parsedMovieShowtimes() {
      return movieShowtimesInput.value.split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => ({ value, date: new Date(value) }));
    }

    function updateMovieListingFields() {
      const isMovie = isMovieListing();
      movieListingFields.hidden = !isMovie;
      eventStartField.hidden = isMovie;
      eventEndField.hidden = isMovie;
      startsInput.required = !isMovie;
      endsInput.required = !isMovie;
      movieShowtimesInput.required = isMovie;
      if (!isMovie) return;

      if (!movieShowtimesInput.value.trim() && startsInput.value) {
        movieShowtimesInput.value = startsInput.value;
      }
      const showtimes = parsedMovieShowtimes()
        .filter(({ date }) => Number.isFinite(date.getTime()))
        .sort((left, right) => left.date - right.date);
      if (!showtimes.length) return;

      const runtime = Number(movieRuntimeInput.value);
      if (!Number.isSafeInteger(runtime) || runtime < 15 || runtime > 600) return;
      startsInput.value = localDateTime(showtimes[0].date);
      endsInput.value = localDateTime(new Date(showtimes[showtimes.length - 1].date.getTime() + runtime * 60000));
    }

    categoryInput.addEventListener('change', updateMovieListingFields);
    movieShowtimesInput.addEventListener('input', updateMovieListingFields);
    movieRuntimeInput.addEventListener('input', updateMovieListingFields);
    updateMovieListingFields();

    async function loadEventForEditing() {
      if (!editingEventId) return;
      saveDraftButton.hidden = true;
      resetDraftButton.hidden = true;
      publishButton.disabled = true;
      publishButton.textContent = 'Save event changes';
      publishWithoutEarlyBirdButton.textContent = 'Save without early-bird offer';
      try {
        const accountToken = window.valorAccountToken();
        if (!accountToken) throw new Error('Sign in to your organizer account to edit this event.');
        const result = await window.valorEventsApi('/api/events/mine', {
          headers: { Authorization: `Bearer ${accountToken}` }
        });
        const event = result.events.find((entry) => entry.id === editingEventId && !entry.archived);
        if (!event) throw new Error('This event is unavailable or was removed from your account.');
        const eventShowtimes = event.tags
          .map((tag) => typeof tag === 'string' ? tag.match(/^Showtime:\s*(.+)$/i)?.[1] : '')
          .filter((value) => value && !Number.isNaN(Date.parse(value)));
        const lastShowtime = eventShowtimes.length
          ? Math.max(...eventShowtimes.map((value) => Date.parse(value)))
          : null;
        const savedRuntime = lastShowtime === null
          ? 120
          : Math.round((Date.parse(event.endsAt) - lastShowtime) / 60000);
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
          campaignTags: event.tags
            .filter((tag) => !/^Showtime:\s*/i.test(tag))
            .join(', '),
          movieShowtimes: event.tags
            .filter((tag) => typeof tag === 'string' && /^Showtime:\s*/i.test(tag))
            .map((tag) => localDateTime(tag.replace(/^Showtime:\s*/i, '')))
            .join('\n') || (/movie|cinema|film/i.test(event.category) ? localDateTime(event.startsAt) : ''),
          movieRuntime: String(Number.isSafeInteger(savedRuntime) && savedRuntime >= 15 && savedRuntime <= 600 ? savedRuntime : 120),
          organizerName: event.organizerName,
          organizerEmail: event.organizerEmail,
          organizerPhone: event.organizerPhone
        };
        Object.entries(values).forEach(([id, value]) => {
          const input = document.getElementById(id);
          if (input) input.value = value || '';
        });
        freeRegularTicketToggle.checked = Number(event.regularPrice) === 0;
        lastPaidTicketPrice = freeRegularTicketToggle.checked ? '' : String(event.regularPrice);
        updateRegularTicketPriceMode();
        updateMovieListingFields();
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
      let movieShowtimes = [];
      if (isMovieListing()) {
        movieShowtimes = parsedMovieShowtimes();
        if (!movieShowtimes.length || movieShowtimes.length > 8
          || movieShowtimes.some(({ date }) => !Number.isFinite(date.getTime()))) {
          feedback.textContent = 'Add between 1 and 8 valid movie showtimes, one per line.';
          feedback.classList.add('error');
          movieShowtimesInput.focus();
          return;
        }
        movieShowtimes.sort((left, right) => left.date - right.date);
        if (new Set(movieShowtimes.map(({ date }) => date.getTime())).size !== movieShowtimes.length) {
          feedback.textContent = 'Each movie showtime must be unique.';
          feedback.classList.add('error');
          movieShowtimesInput.focus();
          return;
        }
        const runtime = Number(data.get('movieRuntime'));
        if (!Number.isSafeInteger(runtime) || runtime < 15 || runtime > 600) {
          feedback.textContent = 'Enter a movie runtime between 15 and 600 minutes.';
          feedback.classList.add('error');
          movieRuntimeInput.focus();
          return;
        }
        const capacity = Number(data.get('eventCapacity'));
        if (capacity && (!Number.isSafeInteger(capacity) || capacity > 64)) {
          feedback.textContent = 'Movie screenings support up to 64 selectable seats per showtime.';
          feedback.classList.add('error');
          document.getElementById('eventCapacity').focus();
          return;
        }
        startsAt.setTime(movieShowtimes[0].date.getTime());
        endsAt.setTime(movieShowtimes[movieShowtimes.length - 1].date.getTime() + runtime * 60000);
        startsInput.value = localDateTime(startsAt);
        endsInput.value = localDateTime(endsAt);
      }
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
        tags: [
          ...movieShowtimes.map(({ date }) => `Showtime: ${date.toISOString()}`),
          ...String(data.get('campaignTags') || '').split(',').map((tag) => tag.trim()).filter(Boolean)
        ].join(', '),
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
          `Regular ticket price: ${Number(fields.regularPrice) === 0 ? 'Free' : `KES ${fields.regularPrice}`}`,
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
        const accountToken = window.valorAccountToken();
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
          freeRegularTicketToggle.checked = Number(regularTicketPriceInput.value) === 0;
          lastPaidTicketPrice = freeRegularTicketToggle.checked ? '' : regularTicketPriceInput.value;
          updateRegularTicketPriceMode();
          updateMovieListingFields();
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
      window.setTimeout(() => {
        lastPaidTicketPrice = '';
        updateRegularTicketPriceMode();
        updateMovieListingFields();
      }, 0);
    });
    renderDrafts();
  }
})();
