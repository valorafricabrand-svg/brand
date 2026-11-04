(function () {
  'use strict';

  const showcase = document.querySelector('.branding-marquee');
  if (!showcase) return;

  const track = document.getElementById('brandingMarqueeTrack');
  const status = document.getElementById('brandingMarqueeStatus');
  const toggle = document.getElementById('brandingMarqueeToggle');
  if (!track || !status || !toggle) return;
  let totalImages = 0;
  let failedImages = 0;

  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const updateMotionControl = () => {
    toggle.hidden = motionPreference.matches;
  };
  updateMotionControl();
  motionPreference.addEventListener('change', updateMotionControl);

  toggle.addEventListener('click', () => {
    const paused = showcase.classList.toggle('is-paused');
    toggle.setAttribute('aria-pressed', String(paused));
    toggle.textContent = paused ? 'Resume movement' : 'Pause movement';
  });

  function createImageCard(file, index) {
    const card = document.createElement('figure');
    const exampleNumber = String(index + 1).padStart(3, '0');
    card.className = 'branding-marquee-card';

    const image = document.createElement('img');
    image.src = `images/Branding%20images/${encodeURIComponent(file)}`;
    image.alt = `Event branding example ${exampleNumber}`;
    image.width = 180;
    image.height = 120;
    image.loading = index < 4 ? 'eager' : 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => {
      failedImages += 1;
      status.classList.add('error');
      status.textContent = `Unable to load ${failedImages} of ${totalImages} branding examples.`;
    }, { once: true });

    const number = document.createElement('span');
    number.className = 'branding-marquee-number';
    number.setAttribute('aria-hidden', 'true');
    number.textContent = exampleNumber;
    card.append(image, number);
    return card;
  }

  async function loadShowcase() {
    showcase.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch('scripts/branding-images.json');
      if (!response.ok) throw new Error(`The branding image list returned ${response.status}.`);
      const files = await response.json();
      if (!Array.isArray(files) || !files.length || files.some((file) => (
        typeof file !== 'string'
        || !/^[^/\\]+\.(?:jpe?g|png|gif|webp)$/i.test(file)
      ))) {
        throw new Error('The branding image list is invalid.');
      }
      totalImages = files.length;

      const group = document.createElement('div');
      group.className = 'branding-marquee-group';
      group.setAttribute('role', 'list');
      group.setAttribute('aria-label', 'All event branding examples');
      files.forEach((file, index) => {
        const card = createImageCard(file, index);
        card.setAttribute('role', 'listitem');
        group.appendChild(card);
      });

      const duplicate = group.cloneNode(true);
      duplicate.setAttribute('aria-hidden', 'true');
      track.replaceChildren(group, duplicate);
      track.style.setProperty('--branding-marquee-duration', `${group.scrollWidth / 42}s`);
      status.textContent = `Showing all ${files.length} branding examples.`;
      toggle.disabled = false;
    } catch (error) {
      console.error('Unable to load the branding showcase:', error);
      status.classList.add('error');
      status.textContent = 'Branding examples could not be loaded. Please refresh to try again.';
    } finally {
      showcase.removeAttribute('aria-busy');
    }
  }

  loadShowcase();
})();
