(function () {
  'use strict';

  if (new URLSearchParams(window.location.search).get('program') !== 'artist') return;

  const profileForm = document.getElementById('artistProfileForm');
  const serviceForm = document.getElementById('artistServiceForm');
  const feedback = document.getElementById('artistApplicationFeedback');
  const serviceList = document.getElementById('artistServiceList');
  const bookingList = document.getElementById('artistBookingList');
  const referralCard = document.getElementById('artistReferralCard');
  const referralInput = document.getElementById('artistReferralLink');
  const cancelEditButton = document.getElementById('cancelArtistServiceEdit');
  let token = '';
  let editingServiceId = '';

  function setFeedback(message, isError = false) {
    feedback.textContent = message;
    feedback.classList.toggle('error', isError);
  }

  function headers() {
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  function statusLabel(status) {
    return status.replace(/_/g, ' ');
  }

  function formattedDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Date not available' : date.toLocaleString('en-KE');
  }

  function formValues(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function renderServices(services, hasProfile) {
    serviceList.replaceChildren();
    if (!services.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = hasProfile
        ? 'Add your first service to appear in the public directory.'
        : 'Publish your profile before adding services.';
      serviceList.appendChild(empty);
      return;
    }
    services.forEach((service) => {
      const card = document.createElement('article');
      card.className = 'artist-dashboard-card';
      const heading = document.createElement('h5');
      heading.textContent = service.title;
      const details = document.createElement('p');
      details.textContent = `${service.category} · KES ${Number(service.priceKes).toLocaleString('en-KE')} · ${service.durationMinutes} minutes`;
      const description = document.createElement('p');
      description.textContent = service.description;
      const cancellation = document.createElement('p');
      cancellation.textContent = `Cancellation policy: ${service.cancellationPolicy}`;
      const actions = document.createElement('div');
      actions.className = 'artist-service-actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'button secondary';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => {
        editingServiceId = service.id;
        serviceForm.elements.title.value = service.title;
        serviceForm.elements.category.value = service.category;
        serviceForm.elements.description.value = service.description;
        serviceForm.elements.priceKes.value = service.priceKes;
        serviceForm.elements.durationMinutes.value = service.durationMinutes;
        serviceForm.elements.cancellationPolicy.value = service.cancellationPolicy;
        document.getElementById('artistServiceFormTitle').textContent = 'Edit service';
        serviceForm.querySelector('[type="submit"]').textContent = 'Save service';
        cancelEditButton.hidden = false;
        serviceForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      const deactivate = document.createElement('button');
      deactivate.type = 'button';
      deactivate.className = 'button secondary';
      deactivate.textContent = 'Remove from directory';
      deactivate.addEventListener('click', async () => {
        deactivate.disabled = true;
        try {
          await window.valorEventsApi(`/api/artists/services/${encodeURIComponent(service.id)}`, {
            method: 'PATCH',
            headers: { ...headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ active: false })
          });
          await loadDashboard();
          setFeedback('Service removed from the public directory.');
        } catch (error) {
          setFeedback(error.message, true);
        } finally {
          deactivate.disabled = false;
        }
      });
      actions.append(edit, deactivate);
      card.append(heading, details, description, cancellation, actions);
      serviceList.appendChild(card);
    });
  }

  function renderBookings(bookings) {
    bookingList.replaceChildren();
    if (!bookings.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'Booking requests will appear here.';
      bookingList.appendChild(empty);
      return;
    }
    bookings.forEach((booking) => {
      const card = document.createElement('article');
      card.className = 'artist-dashboard-card';
      const heading = document.createElement('h5');
      heading.textContent = `${booking.eventName} · ${booking.serviceTitle}`;
      const status = document.createElement('p');
      status.className = 'artist-booking-status';
      status.textContent = `Status: ${statusLabel(booking.status)} · ${formattedDate(booking.eventDate)} · ${booking.eventLocation}`;
      const organizer = document.createElement('p');
      organizer.textContent = `Organizer: ${booking.organizerName} (${booking.organizerEmail})`;
      const message = document.createElement('p');
      message.textContent = booking.message;
      const policy = document.createElement('p');
      policy.textContent = `Cancellation policy: ${booking.cancellationPolicy}`;
      const money = document.createElement('p');
      money.textContent = `Service KES ${Number(booking.servicePriceKes).toLocaleString('en-KE')} · Deposit KES ${Number(booking.depositAmountKes).toLocaleString('en-KE')} · Valor fee KES ${Number(booking.valorFeeKes).toLocaleString('en-KE')} · Your deposit payout KES ${Number(booking.artistPayoutKes).toLocaleString('en-KE')} · Remaining KES ${(Number(booking.servicePriceKes) - Number(booking.depositAmountKes)).toLocaleString('en-KE')} paid directly by organizer`;
      card.append(heading, status, organizer, message, policy, money);
      if (booking.status === 'requested') {
        card.append(
          actionButton('Accept request', () => respond(booking.id, 'accept')),
          actionButton('Decline request', () => respond(booking.id, 'decline'))
        );
      } else if (['deposit_paid','service_completed'].includes(booking.status) && !booking.artistCompletedAt) {
        card.append(actionButton('Confirm service completed', () => complete(booking.id)));
      } else if (booking.status === 'completed') {
        const note = document.createElement('p');
        note.textContent = booking.payoutRecorded
          ? 'Valor recorded the manual artist payout.'
          : 'Service completion is confirmed. Valor will record the manual deposit payout after transfer.';
        card.appendChild(note);
      } else if (booking.status === 'cancellation_review') {
        const note = document.createElement('p');
        note.textContent = 'Cancellation submitted. Valor support will review any refund under the policy the organizer accepted.';
        card.appendChild(note);
      } else if (booking.status === 'payment_review') {
        const note = document.createElement('p');
        note.textContent = 'Payment details need Valor support review before this booking can proceed.';
        card.appendChild(note);
      }
      if (['requested','accepted','deposit_paid','service_completed'].includes(booking.status)) {
        card.append(actionButton('Cancel booking', () => cancel(booking.id), 'secondary'));
      }
      bookingList.appendChild(card);
    });
  }

  function actionButton(label, action, style = 'primary') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `button${style === 'secondary' ? ' secondary' : ' button-primary'}`;
    button.textContent = label;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await action();
        await loadDashboard();
      } catch (error) {
        setFeedback(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
    return button;
  }

  async function respond(id, decision) {
    await window.valorEventsApi(`/api/artist-bookings/${encodeURIComponent(id)}/respond`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision })
    });
    setFeedback(decision === 'accept' ? 'Booking request accepted.' : 'Booking request declined.');
  }

  async function complete(id) {
    await window.valorEventsApi(`/api/artist-bookings/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    setFeedback('Your service completion was recorded. The organizer must also confirm completion before payout.');
  }

  async function cancel(id) {
    await window.valorEventsApi(`/api/artist-bookings/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    setFeedback('Booking cancellation submitted.');
  }

  function fillProfile(profile) {
    if (!profile) return;
    const fields = {
      displayName: profile.displayName,
      artistType: profile.artistType,
      city: profile.city,
      genres: profile.genres,
      bio: profile.bio,
      profileImageUrl: profile.profileImageUrl,
      portfolioUrl: profile.portfolioUrl,
      socialPlatform: profile.socialPlatform,
      socialProfileUrl: profile.socialProfileUrl,
      availabilityNote: profile.availabilityNote
    };
    Object.entries(fields).forEach(([name, value]) => {
      if (profileForm.elements[name]) profileForm.elements[name].value = value || '';
    });
    profileForm.querySelector('[type="submit"]').textContent = 'Save profile';
  }

  async function loadDashboard() {
    const result = await window.valorEventsApi('/api/artists/me', { headers: headers() });
    fillProfile(result.profile);
    serviceForm.hidden = !result.profile;
    renderServices(result.profile ? result.profile.services : [], Boolean(result.profile));
    renderBookings(result.bookings || []);
    if (result.referralUrl) {
      referralInput.value = result.referralUrl;
      referralCard.hidden = false;
      const stats = result.referralStats || { clicks: 0, conversions: 0, earnedKes: 0, paidKes: 0, dueKes: 0 };
      document.getElementById('artistReferralStats').textContent =
        `${stats.clicks} visits · ${stats.conversions} paid ticket orders · ` +
        `KES ${Number(stats.earnedKes).toLocaleString('en-KE')} earned · ` +
        `KES ${Number(stats.paidKes).toLocaleString('en-KE')} paid · ` +
        `KES ${Number(stats.dueKes).toLocaleString('en-KE')} due`;
    }
  }

  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = profileForm.querySelector('[type="submit"]');
    button.disabled = true;
    setFeedback('Saving and publishing your profile…');
    try {
      const saved = await window.valorEventsApi('/api/artists/me', {
        method: 'PUT',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(formValues(profileForm))
      });
      await loadDashboard();
      setFeedback(saved.profile.status === 'active'
        ? 'Your public artist profile is live.'
        : 'Profile details saved, but your public profile is paused. Contact Valor Africa to discuss relisting.');
    } catch (error) {
      setFeedback(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  serviceForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = serviceForm.querySelector('[type="submit"]');
    button.disabled = true;
    setFeedback(editingServiceId ? 'Saving service…' : 'Publishing service…');
    try {
      const values = formValues(serviceForm);
      values.priceKes = Number(values.priceKes);
      values.durationMinutes = Number(values.durationMinutes);
      await window.valorEventsApi(editingServiceId
        ? `/api/artists/services/${encodeURIComponent(editingServiceId)}`
        : '/api/artists/services', {
        method: editingServiceId ? 'PATCH' : 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      });
      serviceForm.reset();
      editingServiceId = '';
      document.getElementById('artistServiceFormTitle').textContent = 'Add a service';
      serviceForm.querySelector('[type="submit"]').textContent = 'Add service';
      cancelEditButton.hidden = true;
      await loadDashboard();
      setFeedback('Your service is published in the artist directory.');
    } catch (error) {
      setFeedback(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  cancelEditButton.addEventListener('click', () => {
    editingServiceId = '';
    serviceForm.reset();
    document.getElementById('artistServiceFormTitle').textContent = 'Add a service';
    serviceForm.querySelector('[type="submit"]').textContent = 'Add service';
    cancelEditButton.hidden = true;
  });

  document.getElementById('copyArtistReferral').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(referralInput.value);
      setFeedback('Referral link copied.');
    } catch (error) {
      setFeedback('Copy was blocked by your browser. Select and copy the referral link manually.', true);
    }
  });

  document.addEventListener('valor-artist-dashboard-ready', async () => {
    token = window.valorAccountToken() || '';
    try {
      await loadDashboard();
    } catch (error) {
      setFeedback(error.message, true);
    }
  }, { once: true });
})();
