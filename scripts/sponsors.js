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
          chip.href = sponsor.trackingId && window.valorEventsApiBase
            ? `${window.valorEventsApiBase}/api/sponsorships/${encodeURIComponent(sponsor.trackingId)}/click?placement=home-sponsor-strip`
            : sponsor.websiteUrl;
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
        observeViewableImpression(chip, sponsor);
      });
      mount.replaceChildren(track);
      mount.hidden = false;
    } catch (error) {
      console.error('Could not load active sponsors:', error.message);
      mount.hidden = true;
    }
  }

  function observeViewableImpression(element, sponsor) {
    if (!('IntersectionObserver' in window) || !window.crypto?.randomUUID || !sponsor.trackingId) return;
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
          await window.valorEventsApi(
            `/api/sponsorships/${encodeURIComponent(sponsor.trackingId)}/viewable-impressions`,
            {
              method: 'POST',
              keepalive: true,
              body: JSON.stringify({
                impressionId: window.crypto.randomUUID(),
                placement: 'home-sponsor-strip'
              })
            }
          );
        } catch (error) {
          console.error(`Could not record the viewable impression for ${sponsor.brandName}:`, error.message);
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

  loadSponsorStrip();
})();
