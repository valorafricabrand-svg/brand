(function () {
  'use strict';

  const root = document.getElementById('organizerEvents');
  const token = window.sessionStorage.getItem('valor-account-token');
  const headers = { Authorization: `Bearer ${token || ''}` };

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
        card.className = `issued-ticket organizer-event-card${event.archived ? ' organizer-event-archived' : ''}`;
        const title = document.createElement('h2');
        title.textContent = event.title;
        const status = document.createElement('p');
        status.textContent = event.archived
          ? 'Status: Removed from public listings'
          : `Status: ${event.status === 'approved' ? 'Live' : event.status === 'rejected' ? 'Unpublished' : 'Awaiting review'}`;
        const details = document.createElement('p');
        details.textContent = `${formatDate(event.startsAt, event.timezone)} · ${event.location}`;
        const metrics = document.createElement('p');
        metrics.textContent = `Tickets sold: ${event.ticketsSold} · Checked in: ${event.checkedIn} · Gross sales: KES ${Number(event.grossKes).toLocaleString('en-KE')}`;
        card.append(title, status, details, metrics);
        if (event.hasActivePromotion) {
          const promotionNote = document.createElement('p');
          promotionNote.textContent = 'This event has an active or pending promotion. Contact Valor Africa support to edit or remove it.';
          card.appendChild(promotionNote);
        }
        if (event.reviewNote) {
          const review = document.createElement('p');
          review.textContent = `Review note: ${event.reviewNote}`;
          card.appendChild(review);
        }
        if (!event.archived && event.status === 'approved') {
          const link = document.createElement('a');
          link.href = `event.html?slug=${encodeURIComponent(event.slug)}`;
          link.textContent = 'View event page';
          card.appendChild(link);
        }
        if (!event.archived) {
          const actions = document.createElement('div');
          actions.className = 'organizer-event-actions';
          if (!event.hasActivePromotion && Date.parse(event.startsAt) > Date.now()) {
            const edit = document.createElement('a');
            edit.href = `host.html?editEvent=${encodeURIComponent(event.id)}`;
            edit.className = 'button button-primary';
            edit.textContent = 'Edit event';
            actions.appendChild(edit);
          }
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'button secondary';
          remove.textContent = 'Delete event';
          remove.addEventListener('click', async () => {
            if (!window.confirm(`Remove “${event.title}” from public listings? This action cannot be undone.`)) return;
            remove.disabled = true;
            try {
              await window.valorEventsApi(`/api/events/mine/${encodeURIComponent(event.id)}`, {
                method: 'DELETE',
                headers
              });
              await loadEvents();
            } catch (error) {
              remove.disabled = false;
              const feedback = document.createElement('p');
              feedback.className = 'page-feedback error';
              feedback.textContent = error.message;
              card.appendChild(feedback);
            }
          });
          actions.appendChild(remove);
          card.appendChild(actions);
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
