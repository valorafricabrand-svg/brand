(function () {
  'use strict';

  const nav = document.createElement('div');
  nav.className = 'site-history-nav';
  nav.setAttribute('role', 'navigation');
  nav.setAttribute('aria-label', 'Page history');

  function createButton(label, pathData, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'site-history-button';
    button.setAttribute('aria-label', label);
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${pathData}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    button.addEventListener('click', action);
    return button;
  }

  const back = createButton('Go back', 'M15 5l-7 7 7 7', () => window.history.back());
  const forward = createButton('Go forward', 'M9 5l7 7-7 7', () => window.history.forward());
  back.classList.add('site-history-back');
  forward.classList.add('site-history-forward');

  nav.append(back, forward);

  function mount() {
    document.body.appendChild(nav);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
