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

  function createExampleCard() {
    const card = document.createElement('article');
    card.className = 'testimonial-card is-example';

    const badge = document.createElement('span');
    badge.className = 'testimonial-example-badge';
    badge.textContent = 'EXAMPLE — not a real review';

    const stars = document.createElement('span');
    stars.className = 'testimonial-stars is-example';
    stars.setAttribute('aria-label', '5 out of 5 stars (example)');
    stars.textContent = starText(5);

    const quote = document.createElement('p');
    quote.className = 'testimonial-quote';
    quote.textContent = '“This is what a genuine attendee review looks like once someone shares one from a sold-out event.”';

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
        empty.textContent = 'Reviews from sold-out events will appear here as attendees share them. Here is an example of what one will look like:';
        root.replaceChildren(empty, createExampleCard());
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
