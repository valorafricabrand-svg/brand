(() => {
  const profiles = [
    {
      name: 'TikTok',
      url: 'https://tiktok.com/valor_africa_tickethub',
      icon: '<path d="M16.4 5.1a5.1 5.1 0 0 1-3-3V2h-3v11.3a2.5 2.5 0 1 1-2.1-2.5V7.7a5.6 5.6 0 1 0 5.1 5.6V8.1a8 8 0 0 0 3 .6V5.7a5.1 5.1 0 0 1-.1-.6Z"/>'
    },
    {
      name: 'YouTube',
      url: 'https://www.youtube.com/valorafrica',
      icon: '<path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8ZM9.6 15.9V8.1l6.3 3.9-6.3 3.9Z"/>'
    },
    {
      name: 'Facebook',
      url: 'https://www.facebook.com/people/VALOR-Africa/100091425131734/',
      icon: '<path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.4h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12Z"/>'
    },
    {
      name: 'Instagram',
      url: 'https://www.instagram.com/valor_africa_tickethub/',
      icon: '<path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7Zm11 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/>'
    },
    {
      name: 'LinkedIn',
      url: 'https://ke.linkedin.com/company/valor-africa',
      icon: '<path d="M5.3 7.9H1.5V22h3.8V7.9ZM3.4 2A2.2 2.2 0 1 0 3.4 6.4 2.2 2.2 0 0 0 3.4 2ZM22.5 13.7c0-4.2-2.2-6.2-5.2-6.2a4.5 4.5 0 0 0-4.1 2.3V7.9H9.4V22h3.8v-7c0-1.8.3-3.6 2.6-3.6 2.2 0 2.3 2.1 2.3 3.7V22h3.8l.6-8.3Z"/>'
    },
    {
      name: 'Pinterest',
      url: 'https://www.pinterest.com/ValorAfrica/',
      icon: '<path d="M12 2a10 10 0 0 0-3.6 19.3c-.1-1.7 0-3.5.4-5l1.4-5.9s-.4-.8-.4-2c0-1.9 1.1-3.3 2.5-3.3 1.2 0 1.8.9 1.8 2 0 1.2-.8 3-1.2 4.6-.3 1.4.7 2.5 2 2.5 2.4 0 4.2-2.5 4.2-6.1 0-3.2-2.3-5.4-5.6-5.4-3.8 0-6 2.8-6 5.7 0 1.1.4 2.3 1 3 .1.1.1.2.1.4l-.4 1.5c-.1.5-.5.6-.9.4-1.5-.7-2.4-2.9-2.4-4.7 0-3.8 2.8-7.4 8-7.4 4.2 0 7.5 3 7.5 7 0 4.2-2.6 7.5-6.2 7.5-1.2 0-2.3-.6-2.7-1.3l-.7 2.8c-.3 1.1-.9 2.4-1.4 3.2A10 10 0 1 0 12 2Z"/>'
    }
  ];

  document.querySelectorAll('.footer-brand-block').forEach((block) => {
    if (block.querySelector('.footer-social')) return;

    const social = document.createElement('div');
    social.className = 'footer-social';

    const title = document.createElement('span');
    title.className = 'footer-social-title';
    title.textContent = 'Follow Valor Africa';
    social.appendChild(title);

    const links = document.createElement('nav');
    links.className = 'footer-social-links';
    links.setAttribute('aria-label', 'Follow Valor Africa');

    profiles.forEach((profile) => {
      const link = document.createElement('a');
      link.className = 'footer-social-link';
      link.href = profile.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.setAttribute('aria-label', `Follow Valor Africa on ${profile.name}`);
      link.title = profile.name;
      link.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${profile.icon}</svg>`;
      links.appendChild(link);
    });

    social.appendChild(links);
    block.appendChild(social);
  });
})();
