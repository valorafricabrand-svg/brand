(function () {
  'use strict';

  const marquee = document.getElementById('communityEventsMarquee');
  const track = document.getElementById('communityEventsTrack');
  const group = document.getElementById('communityEventGroup');
  const toggle = document.getElementById('communityEventsToggle');
  if (!marquee || !track || !group || !toggle) return;

  const duplicate = group.cloneNode(true);
  duplicate.removeAttribute('id');
  duplicate.setAttribute('aria-hidden', 'true');
  duplicate.removeAttribute('aria-label');
  duplicate.querySelectorAll('video').forEach((video) => {
    video.pause();
    video.removeAttribute('data-src');
    video.removeAttribute('aria-label');
  });
  track.appendChild(duplicate);
  track.style.setProperty('--community-events-duration', `${Math.max(36, group.scrollWidth / 38)}s`);

  const videos = [...group.querySelectorAll('video[data-src]')];
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let userPaused = false;
  let pointerPaused = false;
  let focusPaused = false;

  function updateVideos() {
    const shouldPlay = !userPaused && !pointerPaused && !focusPaused
      && !motionPreference.matches && !document.hidden;
    videos.forEach((video) => {
      if (shouldPlay && video.dataset.inView === 'true') {
        if (!video.src) video.src = video.dataset.src;
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    });
  }

  function updateMotionControl() {
    toggle.hidden = motionPreference.matches;
    updateVideos();
  }

  toggle.addEventListener('click', () => {
    userPaused = !userPaused;
    marquee.classList.toggle('is-paused', userPaused);
    toggle.setAttribute('aria-pressed', String(userPaused));
    toggle.textContent = userPaused ? 'Resume movement' : 'Pause movement';
    updateVideos();
  });

  marquee.addEventListener('mouseenter', () => {
    pointerPaused = true;
    updateVideos();
  });
  marquee.addEventListener('mouseleave', () => {
    pointerPaused = false;
    updateVideos();
  });
  marquee.addEventListener('focusin', () => {
    focusPaused = true;
    updateVideos();
  });
  marquee.addEventListener('focusout', (event) => {
    if (!marquee.contains(event.relatedTarget)) {
      focusPaused = false;
      updateVideos();
    }
  });
  document.addEventListener('visibilitychange', updateVideos);
  motionPreference.addEventListener('change', updateMotionControl);

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(({ target, isIntersecting }) => {
        target.dataset.inView = String(isIntersecting);
      });
      updateVideos();
    });
    videos.forEach((video) => observer.observe(video));
  } else {
    videos.forEach((video) => {
      video.dataset.inView = 'true';
    });
  }

  updateMotionControl();
})();
