(function () {
  'use strict';

  const gallery = document.getElementById('brandingGallery');
  const status = document.getElementById('brandingGalleryStatus');
  if (!gallery || !status) return;

  async function loadBrandingImages() {
    gallery.setAttribute('aria-busy', 'true');
    let failedImages = 0;
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

      const cards = files.map((file, index) => {
        const card = document.createElement('figure');
        card.className = 'branding-gallery-card';
        const image = document.createElement('img');
        image.src = `images/Branding%20images/${encodeURIComponent(file)}`;
        image.alt = `Branding example ${index + 1}`;
        image.loading = 'lazy';
        image.decoding = 'async';
        image.addEventListener('error', () => {
          failedImages += 1;
          status.textContent = `${files.length - failedImages} of ${files.length} branding images loaded.`;
          status.classList.add('error');
        }, { once: true });

        const caption = document.createElement('figcaption');
        const label = document.createElement('span');
        label.textContent = `Branding example ${String(index + 1).padStart(3, '0')}`;
        caption.appendChild(label);
        card.append(image, caption);
        return card;
      });

      gallery.replaceChildren(...cards);
      status.textContent = `Showing all ${files.length} branding images.`;
    } catch (error) {
      console.error('Unable to load the branding image gallery:', error);
      status.textContent = 'Branding images could not be loaded. Please refresh to try again.';
      status.classList.add('error');
    } finally {
      gallery.removeAttribute('aria-busy');
    }
  }

  loadBrandingImages();
})();
