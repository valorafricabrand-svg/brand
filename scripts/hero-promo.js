(function () {
  'use strict';

  const section = document.getElementById('heroPromo');
  const track = document.getElementById('heroPromoTrack');
  const dotsWrap = document.getElementById('heroPromoDots');
  if (!section || !track || !dotsWrap) return;

  const ACCENTS = ['accent-0', 'accent-1', 'accent-2', 'accent-3', 'accent-4'];
  let slides = [];
  let active = 0;
  let timer = null;

  function resolveAsset(value, apiBase) {
    return value && apiBase && value.startsWith('/uploads/') ? new URL(value, apiBase).href : value;
  }

  function createSlide(slideData, index) {
    const slide = document.createElement('div');
    slide.className = 'hero-promo-slide';
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-roledescription', 'slide');
    slide.setAttribute('aria-label', `${index + 1} of ${slides.length}: ${slideData.title}`);

    const visual = document.createElement('div');
    visual.className = 'hero-promo-visual';
    if (slideData.mediaType === 'video' && slideData.mediaUrl) {
      const video = document.createElement('video');
      video.src = slideData.mediaUrl;
      if (slideData.posterUrl) video.poster = slideData.posterUrl;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = index === 0 ? 'auto' : 'metadata';
      video.setAttribute('aria-label', `Highlight video: ${slideData.title}`);
      visual.appendChild(video);
    } else {
      const img = document.createElement('img');
      img.src = slideData.mediaUrl || slideData.posterUrl || 'images/events/concert-crowd.svg';
      img.alt = '';
      img.loading = index === 0 ? 'eager' : 'lazy';
      visual.appendChild(img);
    }

    const copy = document.createElement('div');
    copy.className = `hero-promo-copy ${ACCENTS[index % ACCENTS.length]}`;
    const badge = document.createElement('span');
    badge.className = 'hero-promo-badge';
    badge.textContent = slideData.category || 'Valor Africa';
    const heading = document.createElement('h2');
    heading.textContent = slideData.title;
    const description = document.createElement('p');
    description.textContent = slideData.description || '';
    const actions = document.createElement('div');
    actions.className = 'hero-promo-actions';
    const primary = document.createElement('a');
    primary.className = 'hero-promo-cta-primary';
    primary.href = slideData.linkUrl || 'events.html';
    primary.textContent = slideData.ctaLabel || 'Explore events';
    const secondary = document.createElement('a');
    secondary.className = 'hero-promo-cta-secondary';
    secondary.href = 'events.html';
    secondary.textContent = 'Browse all events';
    actions.append(primary, secondary);
    copy.append(badge, heading, description, actions);

    slide.append(visual, copy);
    return slide;
  }

  function showSlide(index) {
    if (!slides.length) return;
    active = (index + slides.length) % slides.length;
    [...track.children].forEach((slide, slideIndex) => {
      const isActive = slideIndex === active;
      slide.classList.toggle('is-active', isActive);
      const video = slide.querySelector('video');
      if (video) {
        if (isActive) video.play().catch(() => {});
        else video.pause();
      }
    });
    [...dotsWrap.children].forEach((dot, dotIndex) => dot.classList.toggle('is-active', dotIndex === active));
  }

  function stopRotation() {
    if (timer) window.clearInterval(timer);
    timer = null;
  }

  function startRotation() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    stopRotation();
    timer = window.setInterval(() => showSlide(active + 1), 7000);
  }

  async function init() {
    try {
      const data = await window.valorEventsApi('/api/ads/hero');
      const apiBase = data.apiBase;
      slides = Array.isArray(data.slides) ? data.slides.map((slide) => ({
        ...slide,
        mediaUrl: resolveAsset(slide.mediaUrl, apiBase),
        posterUrl: resolveAsset(slide.posterUrl, apiBase)
      })) : [];
      if (!slides.length) return;

      track.replaceChildren(...slides.map(createSlide));
      dotsWrap.replaceChildren(...slides.map((_, index) => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'hero-promo-dot';
        dot.setAttribute('aria-label', `Go to highlight ${index + 1}`);
        dot.addEventListener('click', () => { showSlide(index); startRotation(); });
        return dot;
      }));
      showSlide(0);
      section.hidden = false;
      startRotation();
      section.addEventListener('mouseenter', stopRotation);
      section.addEventListener('mouseleave', startRotation);
      section.addEventListener('focusin', stopRotation);
      section.addEventListener('focusout', (event) => {
        if (!section.contains(event.relatedTarget)) startRotation();
      });
    } catch (error) {
      console.error('Could not load the homepage hero highlights:', error.message);
    }
  }

  init();
})();
