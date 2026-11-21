(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const slug = params.get('slug') || '';
  const status = document.getElementById('artistProfileStatus');
  const profileHeader = document.getElementById('artistProfileHeader');
  const serviceList = document.getElementById('artistProfileServices');
  const bookingCard = document.getElementById('artistBookingFormCard');
  const bookingForm = document.getElementById('artistBookingForm');
  const bookingFeedback = document.getElementById('artistBookingFeedback');
  let selectedService = null;
  let artist = null;

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle('error', isError);
  }

  function setBookingFeedback(message, isError = false) {
    bookingFeedback.textContent = message;
    bookingFeedback.classList.toggle('error', isError);
  }

  function renderHeader(profile) {
    profileHeader.replaceChildren();
    const image = document.createElement('img');
    image.className = 'artist-profile-image';
    image.src = profile.profileImageUrl || 'images/events/concert-crowd.svg';
    image.alt = profile.profileImageUrl ? `${profile.displayName} profile` : '';
    const content = document.createElement('div');
    content.className = 'artist-profile-copy';
    const name = document.createElement('h1');
    name.textContent = profile.displayName;
    const type = document.createElement('p');
    type.className = 'artist-directory-type';
    type.textContent = `${profile.artistType === 'both' ? 'Artist & DJ' : profile.artistType.toUpperCase()} · ${profile.city}`;
    const genres = document.createElement('p');
    genres.textContent = profile.genres;
    const bio = document.createElement('p');
    bio.textContent = profile.bio;
    const availability = document.createElement('p');
    availability.textContent = profile.availabilityNote || 'Contact the artist to discuss availability.';
    content.append(name, type, genres, bio, availability);
    if (profile.portfolioUrl || profile.socialProfileUrl) {
      const links = document.createElement('p');
      links.className = 'artist-profile-links';
      if (profile.portfolioUrl) {
        const portfolio = document.createElement('a');
        portfolio.href = profile.portfolioUrl;
        portfolio.target = '_blank';
        portfolio.rel = 'noopener noreferrer';
        portfolio.textContent = 'Portfolio';
        links.appendChild(portfolio);
      }
      if (profile.socialProfileUrl) {
        const social = document.createElement('a');
        social.href = profile.socialProfileUrl;
        social.target = '_blank';
        social.rel = 'noopener noreferrer';
        social.textContent = `${profile.socialPlatform} profile`;
        links.appendChild(social);
      }
      content.appendChild(links);
    }
    profileHeader.append(image, content);
    profileHeader.hidden = false;
  }

  function renderServices(services) {
    serviceList.replaceChildren();
    if (!services.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'No active services are listed right now.';
      serviceList.appendChild(empty);
      return;
    }
    services.forEach((service) => {
      const card = document.createElement('article');
      card.className = 'artist-profile-service-card';
      const title = document.createElement('h3');
      title.textContent = service.title;
      const price = document.createElement('p');
      price.className = 'artist-service-price';
      price.textContent = `${service.category} · KES ${Number(service.priceKes).toLocaleString('en-KE')} · ${service.durationMinutes} minutes`;
      const description = document.createElement('p');
      description.textContent = service.description;
      const cancellation = document.createElement('p');
      cancellation.textContent = `Cancellation policy: ${service.cancellationPolicy}`;
      const button = document.createElement('button');
      button.className = 'button button-primary';
      button.type = 'button';
      button.textContent = 'Request this service';
      button.addEventListener('click', () => {
        selectedService = service;
        document.getElementById('artistBookingTitle').textContent = `Request ${service.title}`;
        document.getElementById('artistSelectedService').textContent =
          `${artist.displayName} · KES ${Number(service.priceKes).toLocaleString('en-KE')} · ${service.durationMinutes} minutes`;
        bookingCard.hidden = false;
        setBookingFeedback('');
        bookingCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      card.append(title, price, description, cancellation, button);
      serviceList.appendChild(card);
    });
  }

  async function loadProfile() {
    if (!slug || slug.length > 100) {
      setStatus('Choose an artist profile from the directory.', true);
      return;
    }
    try {
      const result = await window.valorEventsApi(`/api/artists/${encodeURIComponent(slug)}`);
      artist = result.artist;
      document.title = `${artist.displayName} | Artist Services | Valor Africa`;
      const canonical = document.querySelector('link[rel="canonical"]');
      if (canonical) canonical.href = `${window.location.origin}${window.location.pathname}?slug=${encodeURIComponent(artist.slug)}`;
      const description = document.querySelector('meta[name="description"]');
      if (description) description.content = `${artist.displayName} offers ${artist.genres} services in ${artist.city}. Send an event booking request with Valor Africa.`;
      renderHeader(artist);
      renderServices(artist.services);
      setStatus('');
    } catch (error) {
      setStatus(error.message || 'This artist profile could not be loaded.', true);
    }
  }

  bookingForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = window.valorAccountToken();
    if (!token) {
      const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.href = `account.html?returnTo=${encodeURIComponent(returnTo)}`;
      return;
    }
    if (!selectedService) {
      setBookingFeedback('Choose a service before sending a request.', true);
      return;
    }
    const button = bookingForm.querySelector('[type="submit"]');
    const values = Object.fromEntries(new FormData(bookingForm).entries());
    const eventDate = new Date(values.eventDate);
    if (!Number.isFinite(eventDate.getTime())) {
      setBookingFeedback('Enter a valid event date and time.', true);
      return;
    }
    values.eventDate = eventDate.toISOString();
    values.serviceId = selectedService.id;
    values.clientRequestId = window.crypto.randomUUID();
    button.disabled = true;
    setBookingFeedback('Sending your booking request…');
    try {
      await window.valorEventsApi('/api/artist-bookings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      });
      bookingForm.reset();
      setBookingFeedback('Request sent. The artist must accept before a booking is confirmed. Track the response in your bookings.');
      const link = document.createElement('a');
      link.href = 'artist-bookings.html';
      link.textContent = 'View your booking requests';
      link.className = 'artist-booking-follow-up';
      bookingFeedback.appendChild(document.createElement('br'));
      bookingFeedback.appendChild(link);
    } catch (error) {
      setBookingFeedback(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  loadProfile();
})();
