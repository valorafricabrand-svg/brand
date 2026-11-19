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
    const attendeeTag = document.createElement('span');
    attendeeTag.className = 'testimonial-attendee-tag';
    attendeeTag.textContent = 'VERIFIED TICKET HOLDER';
    const eventLink = document.createElement('a');
    eventLink.className = 'testimonial-event-link';
    eventLink.href = `event.html?slug=${encodeURIComponent(item.eventSlug)}`;
    eventLink.textContent = item.eventTitle;
    meta.append(name, attendeeTag, eventLink);

    card.append(stars, quote, meta);
    return card;
  }

  function createStatusMessage(text) {
    const message = document.createElement('p');
    message.className = 'testimonials-empty';
    message.textContent = text;
    return message;
  }

  function isValidHighlight(item) {
    return item
      && typeof item.displayName === 'string'
      && item.displayName.trim().length > 0
      && Number.isInteger(item.rating)
      && item.rating >= 1
      && item.rating <= 5
      && typeof item.review === 'string'
      && item.review.trim().length > 0
      && typeof item.eventTitle === 'string'
      && item.eventTitle.trim().length > 0
      && typeof item.eventSlug === 'string'
      && item.eventSlug.trim().length > 0;
  }

  async function loadTestimonials() {
    const root = document.getElementById('testimonialsGrid');
    if (!root) return;
    try {
      const data = await window.valorEventsApi('/api/reviews/highlights');
      if (!data || !Array.isArray(data.highlights) || !data.highlights.every(isValidHighlight)) {
        throw new Error('Review highlights response is invalid.');
      }
      const highlights = data.highlights;
      if (!highlights.length) {
        root.replaceChildren(createStatusMessage('No attendee reviews have been shared yet. Ticket holders can rate and comment after an event, and their reviews will appear here.'));
        return;
      }
      root.replaceChildren(...highlights.map(createTestimonialCard));
    } catch (error) {
      console.error('Could not load testimonials:', error.message);
      root.replaceChildren(createStatusMessage('Attendee reviews are temporarily unavailable. Please try again later.'));
    }
  }

  loadTestimonials();
})();
