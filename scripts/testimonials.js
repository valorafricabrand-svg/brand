(function () {
  'use strict';

  function starText(rating) {
    return '★'.repeat(rating) + '☆'.repeat(5 - rating);
  }

  function createTestimonialCard(item) {
    const card = document.createElement('article');
    card.className = 'testimonial-card';

    const stars = document.createElement('span');
    stars.className = 'testimonial-stars';
    stars.setAttribute('aria-label', `${item.rating} out of 5 stars`);
    stars.textContent = starText(item.rating);

    const quote = document.createElement('p');
    quote.className = 'testimonial-quote';
    quote.textContent = `“${item.review}”`;

    const meta = document.createElement('div');
    meta.className = 'testimonial-meta';
    const name = document.createElement('strong');
    name.textContent = item.displayName;
    const soldOutTag = document.createElement('span');
    soldOutTag.className = 'testimonial-sold-out-tag';
    soldOutTag.textContent = 'SOLD OUT';
    const eventLink = document.createElement('a');
    eventLink.className = 'testimonial-event-link';
    eventLink.href = `event.html?slug=${encodeURIComponent(item.eventSlug)}`;
    eventLink.textContent = item.eventTitle;
    meta.append(name, soldOutTag, eventLink);

    card.append(stars, quote, meta);
    return card;
  }

  const EXAMPLE_CARDS = [
    { rating: 5, quote: 'This is what a genuine attendee review looks like once someone shares one from a sold-out event.' },
    { rating: 4, quote: 'A real review shows the attendee’s own star rating, their comment, and a link to the sold-out event they actually attended.' },
    { rating: 5, quote: 'Only people who held a confirmed ticket and attended can leave one of these — nothing here is written for them.' },
    { rating: 5, quote: 'Each real review links straight back to the exact event it was written about.' },
    { rating: 4, quote: 'This row fills in naturally as more sold-out events wrap up and attendees choose to share feedback.' }
  ];

  function createExampleCard(index) {
    const card = document.createElement('article');
    card.className = 'testimonial-card is-example';

    const badge = document.createElement('span');
    badge.className = 'testimonial-example-badge';
    badge.textContent = 'EXAMPLE — not a real review';

    const stars = document.createElement('span');
    stars.className = 'testimonial-stars is-example';
    stars.setAttribute('aria-label', `${index.rating} out of 5 stars (example)`);
    stars.textContent = starText(index.rating);

    const quote = document.createElement('p');
    quote.className = 'testimonial-quote';
    quote.textContent = `“${index.quote}”`;

    const meta = document.createElement('div');
    meta.className = 'testimonial-meta';
    const name = document.createElement('strong');
    name.textContent = 'Example attendee';
    const tag = document.createElement('span');
    tag.className = 'testimonial-sold-out-tag is-example';
    tag.textContent = 'SAMPLE EVENT';
    meta.append(name, tag);

    card.append(badge, stars, quote, meta);
    return card;
  }

  function createExampleMarquee() {
    const window_ = document.createElement('div');
    window_.className = 'testimonials-marquee-window';
    const track = document.createElement('div');
    track.className = 'testimonials-marquee-track';
    for (let pass = 0; pass < 2; pass += 1) {
      const group = document.createElement('div');
      group.className = 'testimonials-marquee-group';
      if (pass === 1) group.setAttribute('aria-hidden', 'true');
      EXAMPLE_CARDS.forEach((example) => group.appendChild(createExampleCard(example)));
      track.appendChild(group);
    }
    window_.appendChild(track);
    window_.addEventListener('mouseenter', () => track.classList.add('is-paused'));
    window_.addEventListener('mouseleave', () => track.classList.remove('is-paused'));
    return window_;
  }

  async function loadTestimonials() {
    const root = document.getElementById('testimonialsGrid');
    if (!root) return;
    try {
      const data = await window.valorEventsApi('/api/reviews/highlights');
      const highlights = data.highlights || [];
      if (!highlights.length) {
        root.classList.add('is-example-state');
        const empty = document.createElement('p');
        empty.className = 'testimonials-empty';
        empty.textContent = 'Reviews from sold-out events will appear here as attendees share them. Here are examples of what they will look like:';
        root.replaceChildren(empty, createExampleMarquee());
        return;
      }
      root.classList.remove('is-example-state');
      root.replaceChildren(...highlights.map(createTestimonialCard));
    } catch (error) {
      console.error('Could not load testimonials:', error.message);
      const section = root.closest('.testimonials-section');
      if (section) section.hidden = true;
    }
  }

  loadTestimonials();
})();
