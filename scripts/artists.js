(function () {
  'use strict';

  const form = document.getElementById('artistSearchForm');
  const grid = document.getElementById('artistDirectoryGrid');
  const status = document.getElementById('artistDirectoryStatus');

  function showStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle('error', isError);
  }

  function artistCard(artist) {
    const card = document.createElement('article');
    card.className = 'artist-directory-card';
    const image = document.createElement('img');
    image.className = 'artist-directory-image';
    image.src = artist.profileImageUrl || 'images/events/concert-crowd.svg';
    image.alt = artist.profileImageUrl ? `${artist.displayName} profile` : '';
    image.loading = 'lazy';
    const content = document.createElement('div');
    content.className = 'artist-directory-card-content';
    const type = document.createElement('p');
    type.className = 'artist-directory-type';
    type.textContent = `${artist.artistType === 'both' ? 'Artist & DJ' : artist.artistType.toUpperCase()} · ${artist.city}`;
    const name = document.createElement('h2');
    name.textContent = artist.displayName;
    const genres = document.createElement('p');
    genres.textContent = artist.genres;
    const bio = document.createElement('p');
    bio.textContent = artist.bio;
    const offerings = document.createElement('p');
    offerings.className = 'artist-directory-offerings';
    offerings.textContent = artist.services.map((service) =>
      `${service.title} · KES ${Number(service.priceKes).toLocaleString('en-KE')}`).join(' | ');
    const link = document.createElement('a');
    link.className = 'button button-primary';
    link.href = `artist.html?slug=${encodeURIComponent(artist.slug)}`;
    link.textContent = 'View profile and services';
    content.append(type, name, genres, bio, offerings, link);
    card.append(image, content);
    return card;
  }

  async function loadArtists() {
    const values = new FormData(form);
    const params = new URLSearchParams();
    ['search','city'].forEach((key) => {
      const value = String(values.get(key) || '').trim();
      if (value) params.set(key, value);
    });
    grid.replaceChildren();
    showStatus('Loading artist services…');
    try {
      const query = params.toString();
      const result = await window.valorEventsApi(`/api/artists${query ? `?${query}` : ''}`);
      if (!result.artists.length) {
        showStatus('No artist profiles match those filters yet.');
        return;
      }
      result.artists.forEach((artist) => grid.appendChild(artistCard(artist)));
      showStatus(`${result.artists.length} artist profile${result.artists.length === 1 ? '' : 's'} found.`);
    } catch (error) {
      showStatus(error.message || 'Artist profiles could not be loaded. Please try again.', true);
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    loadArtists();
  });
  loadArtists();
})();
