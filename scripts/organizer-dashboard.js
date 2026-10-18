(function () {
  'use strict';

  const root = document.getElementById('organizerEvents');
  const token = window.sessionStorage.getItem('valor-account-token');

  function showSignIn(message) {
    const link = document.createElement('a');
    link.href = `account.html?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`;
    link.textContent = 'Sign in to view your events';
    root.replaceChildren(document.createTextNode(`${message} `), link);
  }

  function formatDate(value, timezone) {
    return new Intl.DateTimeFormat('en-KE', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: timezone
    }).format(new Date(value));
  }

  async function loadEvents() {
    if (!token) {
      showSignIn('Sign in to manage events submitted from this account.');
      return;
    }
    try {
      const result = await window.valorEventsApi('/api/events/mine', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!result.events.length) {
        const text = document.createElement('p');
        text.textContent = 'You have not submitted any events from this account yet.';
        const link = document.createElement('a');
        link.href = 'host.html';
        link.className = 'button button-primary';
        link.textContent = 'Submit an event';
        root.replaceChildren(text, link);
        return;
      }

      const list = document.createElement('div');
      list.className = 'organizer-event-list';
      result.events.forEach((event) => {
        const card = document.createElement('article');
        card.className = 'issued-ticket organizer-event-card';
        const title = document.createElement('h2');
        title.textContent = event.title;
        const status = document.createElement('p');
        status.textContent = `Status: ${event.status === 'approved' ? 'Approved' : event.status === 'rejected' ? 'Not approved' : 'Awaiting review'}`;
        const details = document.createElement('p');
        details.textContent = `${formatDate(event.startsAt, event.timezone)} · ${event.location}`;
        const metrics = document.createElement('p');
        metrics.textContent = `Tickets sold: ${event.ticketsSold} · Checked in: ${event.checkedIn} · Gross sales: KES ${Number(event.grossKes).toLocaleString('en-KE')}`;
        card.append(title, status, details, metrics);
        if (event.reviewNote) {
          const review = document.createElement('p');
          review.textContent = `Review note: ${event.reviewNote}`;
          card.appendChild(review);
        }
        if (event.status === 'approved') {
          const link = document.createElement('a');
          link.href = `event.html?slug=${encodeURIComponent(event.slug)}`;
          link.textContent = 'View event page';
          card.appendChild(link);
        }
        list.appendChild(card);
      });
      root.replaceChildren(list);
    } catch (error) {
      if (/sign in|session has expired/i.test(error.message)) {
        window.sessionStorage.removeItem('valor-account-token');
        showSignIn('Your session has expired.');
      } else {
        root.textContent = error.message;
        root.classList.add('error');
      }
    }
  }

  loadEvents();
})();
