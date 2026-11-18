(function () {
  'use strict';

  async function loadSponsorStrip() {
    const mount = document.getElementById('sponsorStrip');
    if (!mount) return;
    try {
      const result = await window.valorEventsApi('/api/sponsorships/active');
      const sponsors = Array.isArray(result.sponsors) ? result.sponsors : [];
      if (!sponsors.length) {
        mount.hidden = true;
        return;
      }
      const track = document.createElement('div');
      track.className = 'sponsor-strip-track';
      sponsors.forEach((sponsor) => {
        const chip = document.createElement(sponsor.websiteUrl ? 'a' : 'span');
        chip.className = `sponsor-strip-chip sponsor-strip-chip-${sponsor.tier}`;
        if (sponsor.websiteUrl) {
          chip.href = sponsor.websiteUrl;
          chip.target = '_blank';
          chip.rel = 'noopener noreferrer sponsored';
        }
        if (sponsor.logoUrl) {
          const logo = document.createElement('img');
          logo.src = sponsor.logoUrl;
          logo.alt = '';
          logo.loading = 'lazy';
          chip.appendChild(logo);
        }
        const name = document.createElement('span');
        name.textContent = sponsor.brandName;
        chip.appendChild(name);
        track.appendChild(chip);
      });
      mount.replaceChildren(track);
      mount.hidden = false;
    } catch (error) {
      console.error('Could not load active sponsors:', error.message);
      mount.hidden = true;
    }
  }

  loadSponsorStrip();
})();
