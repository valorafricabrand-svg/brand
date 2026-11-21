(function () {
  'use strict';

  const list = document.getElementById('organizerArtistBookings');
  const status = document.getElementById('artistBookingsStatus');
  const notice = document.getElementById('artistPaymentNotice');
  let token = '';
  let paymentsEnabled = false;

  function authHeaders() {
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  function showStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle('error', isError);
  }

  function dateLabel(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Date not available' : date.toLocaleString('en-KE');
  }

  function actionButton(label, callback, secondary = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = secondary ? 'button secondary' : 'button button-primary';
    button.textContent = label;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await callback();
        await loadBookings();
      } catch (error) {
        showStatus(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
    return button;
  }

  async function complete(id) {
    await window.valorEventsApi(`/api/artist-bookings/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    showStatus('Your completion confirmation was recorded.');
  }

  async function cancel(id) {
    const result = await window.valorEventsApi(`/api/artist-bookings/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    showStatus(result.message || 'Cancellation submitted.');
  }

  function renderBooking(booking) {
    const card = document.createElement('article');
    card.className = 'artist-dashboard-card';
    const heading = document.createElement('h2');
    heading.textContent = `${booking.eventName} · ${booking.serviceTitle}`;
    const artist = document.createElement('p');
    const artistLink = document.createElement('a');
    artistLink.href = `artist.html?slug=${encodeURIComponent(booking.artistSlug)}`;
    artistLink.textContent = booking.artistName;
    artist.append('Artist: ', artistLink);
    const details = document.createElement('p');
    details.textContent = `${dateLabel(booking.eventDate)} · ${booking.eventLocation}`;
    const state = document.createElement('p');
    state.className = 'artist-booking-status';
    state.textContent = `Status: ${booking.status.replace(/_/g, ' ')}`;
    const price = document.createElement('p');
    price.textContent = `Service KES ${Number(booking.servicePriceKes).toLocaleString('en-KE')} · Deposit KES ${Number(booking.depositAmountKes).toLocaleString('en-KE')} · Valor fee KES ${Number(booking.valorFeeKes).toLocaleString('en-KE')} · Remaining KES ${(Number(booking.servicePriceKes) - Number(booking.depositAmountKes)).toLocaleString('en-KE')} paid directly to the artist`;
    const message = document.createElement('p');
    message.textContent = booking.message;
    const policy = document.createElement('p');
    policy.className = 'artist-cancellation-policy';
    policy.textContent = `Cancellation and refund policy: ${booking.cancellationPolicy}`;
    card.append(heading, artist, details, state, price, message, policy);

    if (booking.status === 'accepted' && !paymentsEnabled) {
      const pending = document.createElement('p');
      pending.textContent = 'The artist accepted your request, but M-Pesa deposit checkout is temporarily unavailable. Contact Valor Africa for assistance.';
      card.appendChild(pending);
    } else if (booking.status === 'accepted' && paymentsEnabled) {
      const form = document.createElement('form');
      form.className = 'artist-deposit-form';
      const phoneLabel = document.createElement('label');
      phoneLabel.textContent = 'M-Pesa phone number';
      const phone = document.createElement('input');
      phone.type = 'tel';
      phone.name = 'phone';
      phone.autocomplete = 'tel';
      phone.placeholder = '07… or 2547…';
      phone.required = true;
      const consentLabel = document.createElement('label');
      consentLabel.className = 'artist-policy-acceptance';
      const consent = document.createElement('input');
      consent.type = 'checkbox';
      consent.required = true;
      consentLabel.append(consent, document.createTextNode('I have read and accept the cancellation and refund policy above.'));
      const terms = document.createElement('p');
      terms.textContent = `Pay the 40% deposit (KES ${Number(booking.depositAmountKes).toLocaleString('en-KE')}) by M-Pesa. Valor's 8% fee applies to the deposit. Pay the remaining balance (KES ${(Number(booking.servicePriceKes) - Number(booking.depositAmountKes)).toLocaleString('en-KE')}) directly to the artist.`;
      const feedback = document.createElement('p');
      feedback.className = 'artist-page-status';
      const pay = document.createElement('button');
      pay.type = 'submit';
      pay.className = 'button button-primary';
      pay.textContent = 'Pay deposit with M-Pesa';
      form.append(phoneLabel, phone, consentLabel, terms, pay, feedback);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        pay.disabled = true;
        try {
          const result = await window.valorEventsApi(`/api/artist-bookings/${encodeURIComponent(booking.id)}/deposit`, {
            method: 'POST',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: phone.value, acceptedCancellationPolicy: consent.checked })
          });
          feedback.textContent = result.customerMessage || 'Check your phone for the M-Pesa prompt.';
          await loadBookings();
        } catch (error) {
          feedback.textContent = error.message;
          feedback.classList.add('error');
        } finally {
          pay.disabled = false;
        }
      });
      card.appendChild(form);
    } else if (booking.status === 'deposit_pending') {
      const pending = document.createElement('p');
      pending.textContent = 'M-Pesa payment is pending. Complete the prompt on your phone, then refresh your bookings.';
      card.appendChild(pending);
    } else if (booking.status === 'deposit_paid') {
      card.append(actionButton('Confirm service completed', () => complete(booking.id)));
    } else if (booking.status === 'service_completed') {
      const confirmation = document.createElement('p');
      confirmation.textContent = 'The artist marked the service complete. Confirm completion so Valor can process the manual artist payout.';
      card.append(confirmation, actionButton('Confirm completion', () => complete(booking.id)));
    } else if (booking.status === 'completed') {
      const completeNote = document.createElement('p');
      completeNote.textContent = 'Both sides confirmed completion. Valor will manually pay the artist deposit, less the stated Valor fee.';
      card.appendChild(completeNote);
    } else if (booking.status === 'cancellation_review') {
      const review = document.createElement('p');
      review.textContent = 'Cancellation submitted. Valor support will review any refund under the policy you accepted.';
      card.appendChild(review);
    } else if (booking.status === 'payment_review') {
      const review = document.createElement('p');
      review.textContent = 'Payment details need Valor support review. Do not retry payment for this booking; contact support and include the booking details above.';
      card.appendChild(review);
    } else if (booking.status === 'refunded') {
      const refunded = document.createElement('p');
      refunded.textContent = 'Valor has recorded a manual refund for this booking.';
      card.appendChild(refunded);
    }

    if (['requested','accepted','deposit_paid','service_completed'].includes(booking.status)) {
      card.append(actionButton('Cancel booking', () => cancel(booking.id), true));
    }
    return card;
  }

  async function loadBookings() {
    const result = await window.valorEventsApi('/api/artist-bookings/me', { headers: authHeaders() });
    list.replaceChildren();
    if (!result.bookings.length) {
      showStatus('No booking requests yet. Browse the artist directory to find services.');
      const link = document.createElement('a');
      link.href = 'artists.html';
      link.textContent = 'Find artists and DJs';
      link.className = 'button button-primary';
      list.appendChild(link);
      return;
    }
    showStatus(`${result.bookings.length} booking request${result.bookings.length === 1 ? '' : 's'}.`);
    result.bookings.forEach((booking) => list.appendChild(renderBooking(booking)));
  }

  async function initialize() {
    token = window.valorAccountToken() || '';
    if (!token) {
      showStatus('Sign in to view your artist booking requests.');
      const link = document.createElement('a');
      link.href = `account.html?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`)}`;
      link.className = 'button button-primary';
      link.textContent = 'Sign in';
      list.appendChild(link);
      return;
    }
    try {
      const paymentStatus = await window.valorEventsApi('/api/artist-bookings/payment-status');
      paymentsEnabled = paymentStatus.enabled;
      const noticeText = document.createElement('p');
      noticeText.textContent = paymentStatus.notice;
      notice.replaceChildren(noticeText);
      await loadBookings();
    } catch (error) {
      showStatus(error.message || 'Bookings could not be loaded.', true);
    }
  }

  initialize();
})();
