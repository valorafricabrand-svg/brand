(() => {
  'use strict';
  const tokenKey = 'valor-events-admin-token';
  const loginPanel = document.getElementById('loginPanel');
  const dashboard = document.getElementById('dashboard');
  const feedback = document.getElementById('dashboardFeedback');
  const heroVideoChoices = [
    ['videos/valor-sponsored-video.mp4', 'Valor Events and Tickets'],
    ['videos/valor-ticket-buyer.mp4', 'Ticket buyers'],
    ['videos/valor-ads-organizer-intro.mp4', 'Event organizers'],
    ['videos/valor-featured-clip-002.mp4', 'Discover Valor Africa 2'],
    ['videos/valor-featured-clip-001.mp4', 'Discover Valor Africa 1']
  ];
  const tokenStore = {
    get: () => window.sessionStorage.getItem(tokenKey),
    set: (token) => window.sessionStorage.setItem(tokenKey, token),
    clear: () => window.sessionStorage.removeItem(tokenKey)
  };

  async function api(url, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = tokenStore.get();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    const response = await fetch(url, { ...options, headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) showLoggedOut();
      throw new Error(body.error || `Request failed (${response.status}).`);
    }
    return body;
  }

  function setFeedback(element, message, error = false) {
    element.textContent = message;
    element.classList.toggle('error', error);
  }

  function showLoggedOut() {
    tokenStore.clear();
    dashboard.hidden = true;
    loginPanel.hidden = false;
    document.getElementById('logoutButton').hidden = true;
  }

  async function showDashboard() {
    loginPanel.hidden = true;
    dashboard.hidden = false;
    document.getElementById('logoutButton').hidden = false;
    await loadSubmissions();
    await loadHeroSlides();
    await loadProducts();
    await loadPackages();
    await loadOrders();
    await loadPartners();
    await loadPartnershipApplications();
    await loadArtistMarketplace();
    await loadGiftMarketplace();
  }

  function addText(parent, tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    parent.appendChild(element);
    return element;
  }

  function populateHeroVideoLibrary(select, selectedUrl = '') {
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a video…';
    select.appendChild(placeholder);
    heroVideoChoices.forEach(([url, label]) => {
      const option = document.createElement('option');
      option.value = url;
      option.textContent = label;
      select.appendChild(option);
    });
    select.value = heroVideoChoices.some(([url]) => url === selectedUrl) ? selectedUrl : '';
    return select;
  }

  function createHeroVideoLibrary(selectedUrl) {
    return populateHeroVideoLibrary(document.createElement('select'), selectedUrl);
  }

  async function loadSubmissions() {
    const list = document.getElementById('submissionsList');
    list.replaceChildren();
    const status = document.getElementById('submissionStatus').value;
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    const { events } = await api(`/api/events/admin/submissions${query}`);
    if (!events.length) return addText(list, 'p', 'empty', 'No event submissions in this view.');
    events.forEach((event) => {
      const card = document.createElement('article');
      card.className = 'record';
      addText(card, 'h3', '', event.title);
      addText(card, 'p', 'record-meta', `${event.status.toUpperCase()} · ${event.category} · ${event.city} · ${new Date(event.startsAt).toLocaleString()}`);
      addText(card, 'p', 'record-contact', `${event.organizer.name} · ${event.organizer.email} · ${event.organizer.phone}`);
      addText(card, 'p', 'record-description', event.description);
      const prices = event.tickets.map((ticket) => `${ticket.name} KES ${Number(ticket.price).toLocaleString('en-KE')}`).join(' · ');
      addText(card, 'p', 'record-meta', `Format: ${event.format} · ${prices} · Capacity: ${event.capacity || 'Not specified'} · URL: /event.html?slug=${event.slug}`);
      if (event.poster) {
        const poster = document.createElement('img');
        poster.className = 'record-poster';
        poster.src = event.poster;
        poster.alt = `Poster for ${event.title}`;
        poster.loading = 'lazy';
        card.appendChild(poster);
      }
      if (event.reviewNote) addText(card, 'p', 'record-contact', `Review note: ${event.reviewNote}`);
      if (event.status === 'pending' || event.status === 'approved') {
        const actions = document.createElement('div');
        actions.className = 'record-actions';
        if (event.status === 'pending') {
          const approve = document.createElement('button');
          approve.type = 'button';
          approve.className = 'button primary';
          approve.dataset.reviewEvent = event.id;
          approve.dataset.reviewStatus = 'approved';
          approve.textContent = 'Approve & publish';
          actions.appendChild(approve);
        }
        const reject = document.createElement('button');
        reject.type = 'button';
        reject.className = 'button reject';
        reject.dataset.reviewEvent = event.id;
        reject.dataset.reviewStatus = 'rejected';
        reject.dataset.currentStatus = event.status;
        reject.textContent = event.status === 'approved' ? 'Unpublish' : 'Reject';
        actions.appendChild(reject);
        card.appendChild(actions);
      }
      list.appendChild(card);
    });
  }

  const adPlacementOptions = [
    ['listing', 'Listing — badge in the events grid'],
    ['category', 'Category — top of category filters'],
    ['homepage', 'Homepage — hero carousel'],
    ['premium', 'Premium — guaranteed first slide']
  ];

  async function loadPackages() {
    const list = document.getElementById('packagesList');
    list.replaceChildren();
    const { packages } = await api('/api/admin/packages');
    if (!packages.length) return addText(list, 'p', 'empty', 'Add a tier and set its per-day KES price before organizers can book ads.');
    packages.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'record package-row';
      card.dataset.packageId = item.id;
      const fields = [
        ['Name','name',item.name,'text'],
        ['Description','description',item.description,'text'],
        ['Price per day (KES)','pricePerDayKes',item.pricePerDayKes,'number'],
        ['Minimum days','minDays',item.minDays,'number'],
        ['Maximum days','maxDays',item.maxDays,'number']
      ];
      fields.forEach(([labelText, name, value, type]) => {
        const label = document.createElement('label');
        label.textContent = labelText;
        const input = document.createElement('input');
        input.name = name;
        input.type = type;
        input.value = value;
        if (name === 'pricePerDayKes') input.min = '1';
        if (name === 'minDays') input.min = '1';
        if (name === 'maxDays') { input.min = '1'; input.max = '365'; }
        label.appendChild(input);
        card.appendChild(label);
      });
      const placementLabel = document.createElement('label');
      placementLabel.textContent = 'Placement';
      const placementSelect = document.createElement('select');
      placementSelect.name = 'placement';
      adPlacementOptions.forEach(([value, text]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        option.selected = value === item.placement;
        placementSelect.appendChild(option);
      });
      placementLabel.appendChild(placementSelect);
      card.appendChild(placementLabel);
      const actions = document.createElement('div');
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'button primary';
      save.dataset.savePackage = item.id;
      save.textContent = 'Save';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'button secondary';
      toggle.dataset.togglePackage = item.id;
      toggle.textContent = item.active ? 'Deactivate' : 'Activate';
      toggle.dataset.active = String(Boolean(item.active));
      actions.className = 'record-actions';
      actions.append(save, toggle);
      card.appendChild(actions);
      list.appendChild(card);
    });
  }

  async function loadHeroSlides() {
    const list = document.getElementById('heroSlidesList');
    list.replaceChildren();
    const { slides } = await api('/api/admin/hero-slides');
    if (!slides.length) return addText(list, 'p', 'empty', 'No homepage slides yet. Add a video or image above.');
    slides.forEach((slide, index) => {
      const card = document.createElement('article');
      card.className = 'record hero-slide-row';
      card.dataset.heroSlideId = slide.id;
      card.dataset.active = String(slide.active);
      addText(card, 'p', 'record-meta', `${slide.active ? 'LIVE' : 'REMOVED FROM ROTATION'} · POSITION ${index + 1} · ${slide.mediaType.toUpperCase()}`);

      const fields = [
        ['Title','title',slide.title,'text',120],
        ['Eyebrow / category','category',slide.category,'text',80],
        ['Description','description',slide.description,'textarea',500],
        ['Slide type','mediaType',slide.mediaType,'select',0],
        [slide.mediaType === 'video' ? 'Video URL or site path' : 'Image URL or site path','mediaUrl',slide.mediaUrl,'text',2048],
        ['Poster image URL','posterUrl',slide.posterUrl,'text',2048],
        ['Button label','ctaLabel',slide.ctaLabel,'text',60],
        ['Button destination','linkUrl',slide.linkUrl,'text',2048]
      ];
      let mediaTypeSelect = null;
      fields.forEach(([labelText,name,value,type,maxLength]) => {
        const label = document.createElement('label');
        label.textContent = labelText;
        let input;
        if (type === 'textarea') {
          input = document.createElement('textarea');
          input.rows = 2;
        } else if (type === 'select') {
          input = document.createElement('select');
          [['video','Video'],['image','Image']].forEach(([optionValue,optionLabel]) => {
            const option = document.createElement('option');
            option.value = optionValue;
            option.textContent = optionLabel;
            input.appendChild(option);
          });
        } else {
          input = document.createElement('input');
          input.type = type;
        }
        input.name = name;
        input.value = value || '';
        if (maxLength) input.maxLength = maxLength;
        if (name === 'mediaType') mediaTypeSelect = input;
        label.appendChild(input);
        card.appendChild(label);
      });

      const videoUploadLabel = document.createElement('label');
      videoUploadLabel.textContent = 'Replace video (optional)';
      const videoFile = document.createElement('input');
      videoFile.type = 'file';
      videoFile.name = 'videoFile';
      videoFile.accept = 'video/mp4,video/webm';
      videoUploadLabel.appendChild(videoFile);
      card.appendChild(videoUploadLabel);

      const videoLibraryLabel = document.createElement('label');
      videoLibraryLabel.textContent = 'Choose a saved video';
      const videoLibrary = createHeroVideoLibrary(slide.mediaUrl);
      videoLibrary.addEventListener('change', () => {
        if (videoLibrary.value) card.querySelector('[name="mediaUrl"]').value = videoLibrary.value;
      });
      card.querySelector('[name="mediaUrl"]').addEventListener('input', () => {
        if (card.querySelector('[name="mediaUrl"]').value !== videoLibrary.value) videoLibrary.value = '';
      });
      videoLibraryLabel.appendChild(videoLibrary);
      card.appendChild(videoLibraryLabel);

      const imageUploadLabel = document.createElement('label');
      imageUploadLabel.textContent = 'Replace image (optional)';
      const imageFile = document.createElement('input');
      imageFile.type = 'file';
      imageFile.name = 'imageFile';
      imageFile.accept = 'image/jpeg,image/png,image/gif,image/webp';
      imageUploadLabel.appendChild(imageFile);
      card.appendChild(imageUploadLabel);

      const updateHeroCardUploadVisibility = () => {
        const isVideo = mediaTypeSelect.value === 'video';
        videoUploadLabel.hidden = !isVideo;
        videoLibraryLabel.hidden = !isVideo;
        imageUploadLabel.hidden = isVideo;
      };
      mediaTypeSelect.addEventListener('change', () => {
        videoFile.value = '';
        imageFile.value = '';
        updateHeroCardUploadVisibility();
      });
      updateHeroCardUploadVisibility();

      const actions = document.createElement('div');
      actions.className = 'record-actions';
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'button primary';
      save.dataset.saveHeroSlide = slide.id;
      save.textContent = 'Save changes';
      const moveUp = document.createElement('button');
      moveUp.type = 'button';
      moveUp.className = 'button secondary';
      moveUp.dataset.moveHeroSlide = 'up';
      moveUp.textContent = 'Move up';
      moveUp.disabled = index === 0;
      const moveDown = document.createElement('button');
      moveDown.type = 'button';
      moveDown.className = 'button secondary';
      moveDown.dataset.moveHeroSlide = 'down';
      moveDown.textContent = 'Move down';
      moveDown.disabled = index === slides.length - 1;
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'button secondary';
      toggle.dataset.toggleHeroSlide = slide.id;
      toggle.dataset.active = String(slide.active);
      toggle.textContent = slide.active ? 'Remove from hero' : 'Restore to hero';
      actions.append(save, moveUp, moveDown, toggle);
      card.appendChild(actions);
      list.appendChild(card);
    });
  }

  async function loadGiftMarketplace() {
    await Promise.all([loadGiftMerchants(), loadGiftVouchers(), loadGiftPayouts(), loadGiftRefunds()]);
  }

  async function loadArtistMarketplace() {
    await Promise.all([loadArtistProfiles(), loadArtistBookings()]);
  }

  async function loadArtistProfiles() {
    const list = document.getElementById('artistProfilesList');
    list.replaceChildren();
    const { profiles } = await api('/api/artists/admin');
    if (!profiles.length) return addText(list, 'p', 'empty', 'No artist profiles have been published.');
    profiles.forEach((profile) => {
      const card = document.createElement('article');
      card.className = 'record';
      card.dataset.artistProfileId = profile.id;
      addText(card, 'h3', '', `${profile.displayName} · ${profile.status.toUpperCase()}`);
      addText(card, 'p', 'record-meta', `${profile.email} · ${profile.artistType} · ${profile.city} · ${profile.activeServices} active services`);
      addText(card, 'p', 'record-contact', `${profile.socialPlatform}: ${profile.socialProfileUrl}`);
      const profileLink = document.createElement('a');
      profileLink.href = `/artist.html?slug=${encodeURIComponent(profile.slug)}`;
      profileLink.textContent = 'View public profile';
      card.appendChild(profileLink);
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = profile.status === 'active' ? 'button reject' : 'button secondary';
      toggle.dataset.artistProfileStatus = profile.status === 'active' ? 'suspended' : 'active';
      toggle.textContent = profile.status === 'active' ? 'Unlist profile' : 'Restore profile';
      card.appendChild(toggle);
      list.appendChild(card);
    });
  }

  async function loadArtistBookings() {
    const list = document.getElementById('artistBookingsList');
    list.replaceChildren();
    const { bookings } = await api('/api/artist-bookings/admin');
    if (!bookings.length) return addText(list, 'p', 'empty', 'No artist service bookings yet.');
    bookings.forEach((booking) => {
      const card = document.createElement('article');
      card.className = 'record';
      card.dataset.artistBookingId = booking.id;
      addText(card, 'h3', '', `${booking.eventName} · ${booking.artistName} · ${booking.status.replace(/_/g, ' ').toUpperCase()}`);
      addText(card, 'p', 'record-meta', `${booking.organizerEmail} · ${booking.serviceTitle} · ${new Date(booking.eventDate).toLocaleString()} · ${booking.eventLocation}`);
      addText(card, 'p', 'record-meta', `Service KES ${Number(booking.servicePriceKes).toLocaleString('en-KE')} · Deposit KES ${Number(booking.depositAmountKes).toLocaleString('en-KE')} · Valor fee KES ${Number(booking.valorFeeKes).toLocaleString('en-KE')} · Artist payout KES ${Number(booking.artistPayoutKes).toLocaleString('en-KE')}`);
      if (booking.mpesaReceipt) addText(card, 'p', 'record-contact', `M-Pesa receipt: ${booking.mpesaReceipt}`);
      if (booking.receivedAmountKes && booking.receivedAmountKes !== booking.depositAmountKes) {
        addText(card, 'p', 'record-contact', `Payment review: M-Pesa reported KES ${Number(booking.receivedAmountKes).toLocaleString('en-KE')}.`);
      }
      if (booking.payoutReference) {
        addText(card, 'p', 'record-contact', `Payout recorded: KES ${Number(booking.paidOutKes).toLocaleString('en-KE')} · ${booking.payoutReference}`);
      } else if (booking.status === 'completed') {
        const fields = document.createElement('div');
        fields.className = 'record-actions';
        const reference = document.createElement('input');
        reference.maxLength = 120;
        reference.placeholder = 'Transfer reference (already sent)';
        reference.dataset.artistPayoutReference = '';
        const note = document.createElement('input');
        note.maxLength = 500;
        note.placeholder = 'Payout note';
        note.dataset.artistPayoutNote = '';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button secondary';
        button.dataset.recordArtistPayout = '';
        button.textContent = 'Record manual artist payout';
        fields.append(reference, note, button);
        card.appendChild(fields);
      }
      if (booking.refundReference) {
        addText(card, 'p', 'record-contact', `Refund recorded: KES ${Number(booking.refundedKes).toLocaleString('en-KE')} · ${booking.refundReference}`);
      } else if (['cancellation_review','payment_review'].includes(booking.status)) {
        addText(card, 'p', 'record-description', `Accepted cancellation policy: ${booking.cancellationPolicy}`);
        const fields = document.createElement('div');
        fields.className = 'record-actions';
        const amount = document.createElement('input');
        amount.type = 'number';
        amount.min = '1';
        amount.max = String(booking.receivedAmountKes || booking.depositAmountKes);
        amount.step = '1';
        amount.placeholder = `Refund up to KES ${booking.receivedAmountKes || booking.depositAmountKes}`;
        amount.dataset.artistRefundAmount = '';
        const reference = document.createElement('input');
        reference.maxLength = 120;
        reference.placeholder = 'Completed refund transfer reference';
        reference.dataset.artistRefundReference = '';
        const note = document.createElement('input');
        note.maxLength = 500;
        note.placeholder = 'Refund decision and policy note';
        note.dataset.artistRefundNote = '';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button secondary';
        button.dataset.recordArtistRefund = '';
        button.textContent = 'Record manual refund';
        fields.append(amount, reference, note, button);
        card.appendChild(fields);
      }
      list.appendChild(card);
    });
  }

  async function loadGiftMerchants() {
    const list = document.getElementById('giftMerchantsList');
    list.replaceChildren();
    const { merchants } = await api('/api/gift-merchants/admin');
    if (!merchants.length) return addText(list, 'p', 'empty', 'No merchant applications yet.');
    merchants.forEach((merchant) => {
      const card = document.createElement('article');
      card.className = 'record';
      card.dataset.giftMerchantId = merchant.id;
      addText(card, 'h3', '', `${merchant.businessName} · ${merchant.status.toUpperCase()}`);
      addText(card, 'p', 'record-meta', `${merchant.email} · ${merchant.contactName} · ${merchant.contactPhone} · Applied ${new Date(merchant.createdAt).toLocaleString()}`);
      if (merchant.websiteUrl) addText(card, 'p', 'record-contact', merchant.websiteUrl);
      addText(card, 'p', 'record-description', merchant.applicationDetails);
      addText(card, 'p', 'record-meta', `${merchant.voucherCount} listings · KES ${Number(merchant.salesKes).toLocaleString('en-KE')} sales · KES ${Number(merchant.paidOutKes).toLocaleString('en-KE')} paid · KES ${Number(merchant.dueKes).toLocaleString('en-KE')} due`);
      if (merchant.adminNote) addText(card, 'p', 'record-contact', `Admin note: ${merchant.adminNote}`);
      const actions = document.createElement('div');
      actions.className = 'record-actions';
      const status = document.createElement('select');
      status.dataset.giftMerchantStatus = '';
      status.setAttribute('aria-label', `Review status for ${merchant.businessName}`);
      ['approved','rejected','suspended'].filter((value) => value !== merchant.status).forEach((value) => {
        const item = document.createElement('option');
        item.value = value;
        item.textContent = value === 'approved' ? 'Approve merchant' : value === 'suspended' ? 'Suspend merchant' : 'Reject application';
        status.appendChild(item);
      });
      const note = document.createElement('input');
      note.type = 'text';
      note.maxLength = 1000;
      note.placeholder = 'Optional note to merchant';
      note.value = merchant.adminNote || '';
      note.dataset.giftMerchantNote = '';
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'button primary';
      save.dataset.saveGiftMerchant = '';
      save.textContent = 'Save review';
      actions.append(status, note, save);
      card.appendChild(actions);
      list.appendChild(card);
    });
  }

  async function loadGiftVouchers() {
    const list = document.getElementById('giftVouchersList');
    list.replaceChildren();
    const { vouchers } = await api('/api/gift-vouchers/admin');
    if (!vouchers.length) return addText(list, 'p', 'empty', 'No voucher listings have been submitted.');
    vouchers.forEach((voucher) => {
      const card = document.createElement('article');
      card.className = 'record';
      addText(card, 'h3', '', `${voucher.title} · ${voucher.active ? 'ACTIVE' : 'PAUSED'}`);
      addText(card, 'p', 'record-meta', `${voucher.merchantName} · merchant ${voucher.merchantStatus} · KES ${Number(voucher.salePriceKes).toLocaleString('en-KE')} sale / KES ${Number(voucher.faceValueKes).toLocaleString('en-KE')} value · ${voucher.stock} available · ${voucher.sold} sold`);
      addText(card, 'p', 'record-description', voucher.description);
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'button secondary';
      toggle.dataset.toggleGiftVoucher = voucher.id;
      toggle.dataset.active = String(Boolean(voucher.active));
      toggle.textContent = voucher.active ? 'Pause listing' : 'Activate listing';
      toggle.disabled = voucher.merchantStatus !== 'approved' || (!voucher.active && voucher.stock < 1);
      card.appendChild(toggle);
      list.appendChild(card);
    });
  }

  async function loadGiftPayouts() {
    const list = document.getElementById('giftPayoutsList');
    list.replaceChildren();
    const { merchants } = await api('/api/gift-payouts/admin');
    if (!merchants.length) return addText(list, 'p', 'empty', 'No merchant payout balances yet.');
    merchants.forEach((merchant) => {
      const card = document.createElement('article');
      card.className = 'record';
      card.dataset.giftPayoutMerchantId = merchant.merchantId;
      addText(card, 'h3', '', `${merchant.businessName} · ${merchant.status.toUpperCase()}`);
      addText(card, 'p', 'record-meta', `KES ${Number(merchant.salesKes).toLocaleString('en-KE')} sales · KES ${Number(merchant.paidOutKes).toLocaleString('en-KE')} paid · KES ${Number(merchant.dueKes).toLocaleString('en-KE')} due`);
      if (merchant.payouts.length) {
        const prior = merchant.payouts.map((payout) =>
          `KES ${Number(payout.amountKes).toLocaleString('en-KE')} · ${payout.reference} · ${new Date(payout.createdAt).toLocaleDateString()}`
        ).join('\n');
        addText(card, 'p', 'record-contact', prior);
      }
      if (merchant.dueKes > 0 && merchant.status === 'approved') {
        const actions = document.createElement('div');
        actions.className = 'record-actions gift-payout-fields';
        const amount = document.createElement('input');
        amount.type = 'number';
        amount.min = '1';
        amount.max = String(merchant.dueKes);
        amount.step = '1';
        amount.placeholder = 'Amount in KES';
        amount.dataset.giftPayoutAmount = '';
        const reference = document.createElement('input');
        reference.maxLength = 120;
        reference.placeholder = 'Transfer receipt/reference';
        reference.dataset.giftPayoutReference = '';
        const note = document.createElement('input');
        note.maxLength = 500;
        note.placeholder = 'Optional payout note';
        note.dataset.giftPayoutNote = '';
        const submit = document.createElement('button');
        submit.type = 'button';
        submit.className = 'button secondary';
        submit.dataset.recordGiftPayout = '';
        submit.textContent = 'Record manual payout';
        actions.append(amount, reference, note, submit);
        card.appendChild(actions);
      }
      list.appendChild(card);
    });
  }

  async function loadGiftRefunds() {
    const list = document.getElementById('giftRefundsList');
    list.replaceChildren();
    const { requests } = await api('/api/gift-refunds/admin');
    if (!requests.length) return addText(list, 'p', 'empty', 'No refund requests yet.');
    requests.forEach((refund) => {
      const card = document.createElement('article');
      card.className = 'record';
      card.dataset.giftRefundId = refund.id;
      addText(card, 'h3', '', `${refund.title} · ${refund.status.toUpperCase()}`);
      addText(card, 'p', 'record-meta', `${refund.email} · ${refund.instrumentType.replace('_',' ')} · KES ${Number(refund.amountKes).toLocaleString('en-KE')} · ${refund.paymentMethod} · ${new Date(refund.createdAt).toLocaleString()}`);
      if (refund.merchantName) addText(card, 'p', 'record-contact', `Merchant: ${refund.merchantName} · unused confirmed: ${refund.instrumentStatus === 1 ? 'yes' : 'no'}`);
      addText(card, 'p', 'record-description', refund.reason);
      if (refund.adminNote) addText(card, 'p', 'record-contact', `Admin note: ${refund.adminNote}`);
      if (refund.status === 'pending') {
        const actions = document.createElement('div');
        actions.className = 'record-actions';
        const reference = document.createElement('input');
        reference.maxLength = 120;
        reference.placeholder = refund.paymentMethod === 'mpesa' ? 'Required M-Pesa refund reference' : 'Optional transfer reference';
        reference.dataset.giftRefundReference = '';
        const note = document.createElement('input');
        note.maxLength = 1000;
        note.placeholder = 'Optional review note';
        note.dataset.giftRefundNote = '';
        const approve = document.createElement('button');
        approve.type = 'button';
        approve.className = 'button primary';
        approve.dataset.reviewGiftRefund = 'approved';
        approve.textContent = 'Approve refund';
        approve.disabled = refund.instrumentType === 'merchant_voucher' && refund.instrumentStatus !== 1;
        if (approve.disabled) approve.title = 'Merchant must confirm the voucher code is unused first.';
        const reject = document.createElement('button');
        reject.type = 'button';
        reject.className = 'button reject';
        reject.dataset.reviewGiftRefund = 'rejected';
        reject.textContent = 'Reject request';
        actions.append(reference, note, approve, reject);
        card.appendChild(actions);
      }
      list.appendChild(card);
    });
  }

  async function loadProducts() {
    const list = document.getElementById('productsList');
    list.replaceChildren();
    const { products } = await api('/api/shop/admin/products');
    if (!products.length) return addText(list, 'p', 'empty', 'No merchandise added yet. Add your first product above.');
    products.forEach((product) => {
      const card = document.createElement('article');
      card.className = 'record product-row';
      card.dataset.productId = product.id;
      const fields = [
        ['Name','name',product.name,'text'],
        ['Description','description',product.description,'text'],
        ['Price (KES)','priceKes',product.priceKes,'number'],
        ['Image path or HTTPS URL','imageUrl',product.imageUrl,'text'],
        ['Stock (blank means unlimited)','stock',product.stock ?? '','number']
      ];
      fields.forEach(([labelText, name, value, type]) => {
        const label = document.createElement('label');
        label.textContent = labelText;
        const input = document.createElement('input');
        input.name = name;
        input.type = type;
        input.value = value;
        if (name === 'priceKes') { input.min = '1'; input.max = '100000000'; }
        if (name === 'stock') input.min = '0';
        if (name === 'imageUrl') input.maxLength = 2048;
        if (name === 'description') input.maxLength = 2000;
        label.appendChild(input);
        card.appendChild(label);
      });
      const actions = document.createElement('div');
      actions.className = 'record-actions';
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'button primary';
      save.dataset.saveProduct = product.id;
      save.textContent = 'Save';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'button secondary';
      toggle.dataset.toggleProduct = product.id;
      toggle.textContent = product.active ? 'Deactivate' : 'Activate';
      toggle.dataset.active = String(product.active);
      actions.append(save, toggle);
      card.appendChild(actions);
      list.appendChild(card);
    });
  }

  async function loadOrders() {
    const list = document.getElementById('ordersList');
    list.replaceChildren();
    const { orders } = await api('/api/orders/admin');
    if (!orders.length) return addText(list, 'p', 'empty', 'No customer orders have been created.');
    orders.forEach((order) => {
      const card = document.createElement('article');
      card.className = 'record';
      const orderTitle = order.orderType === 'merchandise'
        ? order.items.map((item) => `${item.quantity} × ${item.name}`).join(', ')
        : order.orderType === 'ad'
          ? `${order.eventTitle || 'Event'} · ${order.adPackage || 'Event promotion'}`
          : `${order.eventTitle || 'Event'} · ${order.quantity} × ${order.ticketType}`;
      addText(card, 'h3', '', orderTitle);
      addText(card, 'p', 'record-meta', `${order.status.toUpperCase()} · ${order.orderType.toUpperCase()} · KES ${Number(order.amountKes).toLocaleString('en-KE')} · ${new Date(order.createdAt).toLocaleString()}`);
      addText(card, 'p', 'record-contact', `${order.buyerName} · ${order.phone}${order.receipt ? ` · M-Pesa receipt ${order.receipt}` : ''}`);
      if (order.deliveryAddress) addText(card, 'p', 'record-contact', `Delivery details: ${order.deliveryAddress}`);
      if (order.resultDescription) addText(card, 'p', 'record-meta', order.resultDescription);
      list.appendChild(card);
    });
  }

  async function loadPartners() {
    const list = document.getElementById('partnersList');
    list.replaceChildren();
    const { partners } = await api('/api/partners/admin');
    if (!partners.length) return addText(list, 'p', 'empty', 'No creator partner applications have been received.');
    partners.forEach((partner) => {
      const card = document.createElement('article');
      card.className = 'record';
      card.dataset.partnerId = partner.id;
      card.dataset.adminNote = partner.adminNote || '';
      addText(card, 'h3', '', `${partner.displayName || 'Creator'} · ${partner.status.toUpperCase()}`);
      addText(card, 'p', 'record-meta', `${partner.email} · ${partner.socialPlatform} · Applied ${new Date(partner.createdAt).toLocaleString()}`);
      addText(card, 'p', 'record-contact', partner.profileUrl);
      addText(card, 'p', 'record-description', partner.audienceDescription);
      if (partner.adminNote) addText(card, 'p', 'record-contact', `Admin note: ${partner.adminNote}`);
      if (partner.referralUrl) addText(card, 'p', 'record-meta', `Referral link: ${partner.referralUrl}`);
      addText(card, 'p', 'record-meta',
        `${Number(partner.clicks).toLocaleString('en-KE')} link visits · ${Number(partner.conversions).toLocaleString('en-KE')} paid ticket orders · KES ${Number(partner.earnedKes).toLocaleString('en-KE')} earned · KES ${Number(partner.paidKes).toLocaleString('en-KE')} paid · KES ${Number(partner.dueKes).toLocaleString('en-KE')} due`);

      const actions = document.createElement('div');
      actions.className = 'record-actions';
      if (partner.status === 'pending' || partner.status === 'rejected') {
        const rateLabel = document.createElement('label');
        rateLabel.textContent = 'Agreed commission (%)';
        const rateInput = document.createElement('input');
        rateInput.type = 'number';
        rateInput.min = '0.01';
        rateInput.max = '100';
        rateInput.step = '0.01';
        rateInput.value = partner.commissionPercent || '';
        rateInput.dataset.commissionPercent = '';
        rateLabel.appendChild(rateInput);
        const approve = document.createElement('button');
        approve.type = 'button';
        approve.className = 'button primary';
        approve.dataset.partnerStatus = 'approved';
        approve.textContent = 'Approve & activate';
        actions.append(rateLabel, approve);
      }
      if (partner.status === 'approved') {
        const rateLabel = document.createElement('label');
        rateLabel.textContent = 'Agreed commission (%)';
        const rateInput = document.createElement('input');
        rateInput.type = 'number';
        rateInput.min = '0.01';
        rateInput.max = '100';
        rateInput.step = '0.01';
        rateInput.value = partner.commissionPercent || '';
        rateInput.dataset.commissionPercent = '';
        rateLabel.appendChild(rateInput);
        const saveRate = document.createElement('button');
        saveRate.type = 'button';
        saveRate.className = 'button secondary';
        saveRate.dataset.partnerStatus = 'approved';
        saveRate.textContent = 'Save agreed rate';
        actions.append(rateLabel, saveRate);
      }
      if (partner.status === 'pending' || partner.status === 'approved') {
        const reject = document.createElement('button');
        reject.type = 'button';
        reject.className = 'button reject';
        reject.dataset.partnerStatus = partner.status === 'approved' ? 'suspended' : 'rejected';
        reject.textContent = partner.status === 'approved' ? 'Pause referrals' : 'Reject application';
        actions.appendChild(reject);
      } else if (partner.status === 'suspended') {
        const reactivate = document.createElement('button');
        reactivate.type = 'button';
        reactivate.className = 'button primary';
        reactivate.dataset.partnerStatus = 'approved';
        reactivate.textContent = 'Reactivate partner';
        actions.appendChild(reactivate);
        const rateLabel = document.createElement('label');
        rateLabel.textContent = 'Agreed commission (%)';
        const rateInput = document.createElement('input');
        rateInput.type = 'number';
        rateInput.min = '0.01';
        rateInput.max = '100';
        rateInput.step = '0.01';
        rateInput.value = partner.commissionPercent || '';
        rateInput.dataset.commissionPercent = '';
        rateLabel.appendChild(rateInput);
        actions.appendChild(rateLabel);
      }
      if (partner.dueKes > 0) {
        const payoutAmount = document.createElement('input');
        payoutAmount.type = 'number';
        payoutAmount.min = '1';
        payoutAmount.max = String(partner.dueKes);
        payoutAmount.step = '1';
        payoutAmount.placeholder = `Payout amount, max KES ${partner.dueKes}`;
        payoutAmount.dataset.payoutAmount = '';
        const payoutReference = document.createElement('input');
        payoutReference.type = 'text';
        payoutReference.maxLength = 120;
        payoutReference.placeholder = 'Manual transfer receipt/reference';
        payoutReference.dataset.payoutReference = '';
        const payoutNote = document.createElement('input');
        payoutNote.type = 'text';
        payoutNote.maxLength = 500;
        payoutNote.placeholder = 'Optional payout note';
        payoutNote.dataset.payoutNote = '';
        const recordPayout = document.createElement('button');
        recordPayout.type = 'button';
        recordPayout.className = 'button secondary';
        recordPayout.dataset.recordPartnerPayout = '';
        recordPayout.textContent = 'Record manual payout';
        actions.append(payoutAmount, payoutReference, payoutNote, recordPayout);
      }
      if (actions.children.length) card.appendChild(actions);
      list.appendChild(card);
    });
  }

  async function loadPartnershipApplications() {
    const list = document.getElementById('partnershipApplicationsList');
    list.replaceChildren();
    const { applications } = await api('/api/partnership-applications/admin');
    if (!applications.length) return addText(list, 'p', 'empty', 'No partner program inquiries have been received.');
    applications.forEach((application) => {
      const card = document.createElement('article');
      card.className = 'record';
      card.dataset.partnershipApplicationId = application.id;
      const sponsorshipTierLabels = {
        community: 'Community Sponsor · KES 25,000',
        city: 'City Sponsor · KES 75,000',
        premium: 'Premium Partner · KES 200,000'
      };
      const applicationTypes = {
        organizer: 'Organizer partner',
        sponsor: 'Event sponsor',
        artist: 'Artist / DJ profile',
        branding: 'Event branding',
        investment: 'Non-binding investment inquiry'
      };
      addText(card, 'h3', '', `${applicationTypes[application.type] || 'Partner inquiry'} · ${application.organizationName}`);
      addText(card, 'p', 'record-meta', `${application.status.toUpperCase()} · ${application.displayName || 'Account'} · ${application.email} · Submitted ${new Date(application.createdAt).toLocaleString()}`);
      if (application.sponsorshipTier) addText(card, 'p', 'record-contact',
        `Package: ${sponsorshipTierLabels[application.sponsorshipTier] || application.sponsorshipTier}`);
      if (application.websiteUrl) addText(card, 'p', 'record-contact', application.websiteUrl);
      addText(card, 'p', 'record-description', application.applicationDetails);
      if (application.requestedSupport) addText(card, 'p', 'record-contact',
        `${application.type === 'organizer' ? 'Interested support' : 'Additional details'}: ${application.requestedSupport}`);
      const label = document.createElement('label');
      label.textContent = 'Follow-up status';
      const status = document.createElement('select');
      status.dataset.applicationStatus = '';
      ['received','pending','contacted','approved','rejected','closed'].forEach((value) => {
        const option = new Option(value[0].toUpperCase() + value.slice(1), value);
        option.selected = value === application.status;
        status.appendChild(option);
      });
      label.appendChild(status);
      const noteLabel = document.createElement('label');
      noteLabel.textContent = 'Applicant-facing follow-up note (1,000 characters maximum)';
      const note = document.createElement('textarea');
      note.rows = 3;
      note.maxLength = 1000;
      note.value = application.adminNote || '';
      note.dataset.applicationNote = '';
      noteLabel.appendChild(note);
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'button primary';
      save.dataset.savePartnershipApplication = '';
      save.textContent = 'Save follow-up update';
      const actions = document.createElement('div');
      actions.className = 'record-actions';
      actions.append(label, noteLabel, save);
      card.appendChild(actions);
      list.appendChild(card);
    });
  }

  const sponsorshipTierLabelsAdmin = {
    community: 'Community Sponsor', city: 'City Sponsor', premium: 'Premium Partner'
  };

  async function loadSponsorships() {
    const list = document.getElementById('sponsorshipsList');
    list.replaceChildren();
    const { purchases } = await api('/api/sponsorships/admin');
    if (!purchases.length) return addText(list, 'p', 'empty', 'No one has paid for a sponsorship package yet.');
    purchases.forEach((purchase) => {
      const card = document.createElement('article');
      card.className = 'record';
      card.dataset.sponsorshipId = purchase.id;
      addText(card, 'h3', '', purchase.isTrial
        ? `Free 7-day Premium trial · ${purchase.brandName}`
        : `${sponsorshipTierLabelsAdmin[purchase.tier] || purchase.tier} · ${purchase.brandName}`);
      addText(card, 'p', 'record-meta',
        `${purchase.status.toUpperCase()} · KES ${Number(purchase.amountKes).toLocaleString('en-KE')} · ${purchase.paymentMethod} · ${purchase.buyerName} · Submitted ${new Date(purchase.createdAt).toLocaleString()}`);
      if (purchase.websiteUrl) addText(card, 'p', 'record-contact', purchase.websiteUrl);
      if (purchase.startsAt && purchase.endsAt) addText(card, 'p', 'record-contact',
        `Active ${new Date(purchase.startsAt).toLocaleString()} → ${new Date(purchase.endsAt).toLocaleString()}`);
      if (purchase.resultDescription) addText(card, 'p', 'record-description', purchase.resultDescription);
      if (purchase.videoUrl) {
        const videoLine = document.createElement('p');
        videoLine.className = 'record-contact';
        const videoLink = document.createElement('a');
        videoLink.href = purchase.videoUrl;
        videoLink.target = '_blank';
        videoLink.rel = 'noopener noreferrer';
        videoLink.textContent = '▶ Billboard video ad';
        videoLine.appendChild(videoLink);
        if (purchase.tagline) videoLine.append(` · "${purchase.tagline}"`);
        card.appendChild(videoLine);
      }
      if (['active','pending','review'].includes(purchase.status)) {
        const actions = document.createElement('div');
        actions.className = 'record-actions';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'button secondary';
        cancel.dataset.cancelSponsorship = purchase.id;
        cancel.textContent = 'Cancel sponsorship';
        actions.appendChild(cancel);
        card.appendChild(actions);
      }
      list.appendChild(card);
    });
  }

  async function loadSponsorDeliveries() {
    const list = document.getElementById('sponsorDeliveriesList');
    list.replaceChildren();
    const { deliveries } = await api('/api/sponsorship-deliveries/admin');
    if (!deliveries.length) return addText(list, 'p', 'empty', 'No organizer sponsor-delivery reports are waiting for review.');
    deliveries.forEach((delivery) => {
      const card = document.createElement('article');
      card.className = 'record';
      card.dataset.sponsorDeliveryId = delivery.id;
      addText(card, 'h3', '', `${delivery.brandName} · ${delivery.eventTitle}`);
      addText(card, 'p', 'record-meta',
        `${delivery.tier} sponsorship · Organizer ${delivery.organizerEmail} · Event ${new Date(delivery.eventStartsAt).toLocaleDateString()} · Submitted ${new Date(delivery.submittedAt).toLocaleString()}`);
      addText(card, 'p', 'record-description',
        `Organizer-reported: ${Number(delivery.attendanceCount).toLocaleString('en-KE')} attendees · ${Number(delivery.checkInCount).toLocaleString('en-KE')} check-ins · ${Number(delivery.samplesRedeemed).toLocaleString('en-KE')} samples redeemed`);
      if (delivery.otherDeliverables) addText(card, 'p', 'record-contact', `Other deliverables: ${delivery.otherDeliverables}`);
      const actions = document.createElement('div');
      actions.className = 'record-actions';
      const note = document.createElement('input');
      note.type = 'text';
      note.maxLength = 1000;
      note.placeholder = 'Verification note (required to reject)';
      note.dataset.sponsorDeliveryNote = '';
      const verify = document.createElement('button');
      verify.type = 'button';
      verify.className = 'button primary';
      verify.dataset.reviewSponsorDelivery = 'verified';
      verify.textContent = 'Verify report';
      const reject = document.createElement('button');
      reject.type = 'button';
      reject.className = 'button reject';
      reject.dataset.reviewSponsorDelivery = 'rejected';
      reject.textContent = 'Reject report';
      actions.append(note, verify, reject);
      card.appendChild(actions);
      list.appendChild(card);
    });
  }

  document.getElementById('sponsorshipsList').addEventListener('click', async (event) => {
    const cancel = event.target.closest('[data-cancel-sponsorship]');
    if (!cancel) return;
    if (!window.confirm('Cancel this sponsorship and remove the brand from the site?')) return;
    cancel.disabled = true;
    try {
      await api(`/api/sponsorships/admin/${encodeURIComponent(cancel.dataset.cancelSponsorship)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' })
      });
      await loadSponsorships();
    } catch (error) {
      cancel.disabled = false;
      setFeedback(feedback, error.message, true);
    }
  });

  document.getElementById('sponsorDeliveriesList').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-review-sponsor-delivery]');
    if (!button) return;
    const card = button.closest('[data-sponsor-delivery-id]');
    button.disabled = true;
    try {
      await api(`/api/sponsorship-deliveries/admin/${encodeURIComponent(card.dataset.sponsorDeliveryId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: button.dataset.reviewSponsorDelivery,
          verificationNote: card.querySelector('[data-sponsor-delivery-note]').value
        })
      });
      setFeedback(feedback, button.dataset.reviewSponsorDelivery === 'verified'
        ? 'Sponsor delivery report verified and reviewer recorded.'
        : 'Sponsor delivery report rejected with your note.');
      await loadSponsorDeliveries();
    } catch (error) {
      button.disabled = false;
      setFeedback(feedback, error.message, true);
    }
  });

  document.getElementById('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const loginForm = event.currentTarget;
    const form = new FormData(loginForm);
    const loginFeedback = document.getElementById('loginFeedback');
    try {
      const result = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: form.get('username'), password: form.get('password') })
      });
      tokenStore.set(result.token);
      loginForm.reset();
      await showDashboard();
    } catch (error) {
      setFeedback(loginFeedback, error.message, true);
    }
  });

  document.getElementById('logoutButton').addEventListener('click', showLoggedOut);
  document.getElementById('sendRemindersButton').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const remindersFeedback = document.getElementById('remindersFeedback');
    button.disabled = true;
    setFeedback(remindersFeedback, 'Sending…');
    try {
      const result = await api('/api/reminders/admin/send', { method: 'POST' });
      if (!result.configured) {
        setFeedback(remindersFeedback, 'Resend is not configured yet, so no reminder emails were sent.', true);
      } else {
        setFeedback(remindersFeedback,
          `Sent ${result.ticketRemindersSent} ticket countdown and ${result.viewRemindersSent} re-engagement emails. ` +
          `${result.ticketRemindersFailed + result.viewRemindersFailed} failed.`,
          Boolean(result.ticketRemindersFailed || result.viewRemindersFailed));
      }
    } catch (error) {
      setFeedback(remindersFeedback, error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById('submissionStatus').addEventListener('change', () => {
    loadSubmissions().catch((error) => setFeedback(feedback, error.message, true));
  });

  document.querySelector('.tabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-admin-tab]');
    if (!button) return;
    document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('is-active', tab === button));
    document.getElementById('submissionsSection').hidden = button.dataset.adminTab !== 'submissions';
    document.getElementById('heroSlidesSection').hidden = button.dataset.adminTab !== 'hero-slides';
    document.getElementById('merchandiseSection').hidden = button.dataset.adminTab !== 'merchandise';
    document.getElementById('packagesSection').hidden = button.dataset.adminTab !== 'packages';
    document.getElementById('ordersSection').hidden = button.dataset.adminTab !== 'orders';
    document.getElementById('partnersSection').hidden = button.dataset.adminTab !== 'partners';
    document.getElementById('partnershipApplicationsSection').hidden = button.dataset.adminTab !== 'partnership-applications';
    document.getElementById('sponsorshipsSection').hidden = button.dataset.adminTab !== 'sponsorships';
    document.getElementById('sponsorDeliveriesSection').hidden = button.dataset.adminTab !== 'sponsor-deliveries';
    document.getElementById('artistsSection').hidden = button.dataset.adminTab !== 'artists';
    document.getElementById('giftsSection').hidden = button.dataset.adminTab !== 'gifts';
    document.getElementById('remindersSection').hidden = button.dataset.adminTab !== 'reminders';
    if (button.dataset.adminTab === 'partners') {
      loadPartners().catch((error) => setFeedback(feedback, error.message, true));
    }
    if (button.dataset.adminTab === 'partnership-applications') {
      loadPartnershipApplications().catch((error) => setFeedback(feedback, error.message, true));
    }
    if (button.dataset.adminTab === 'sponsorships') {
      loadSponsorships().catch((error) => setFeedback(feedback, error.message, true));
    }
    if (button.dataset.adminTab === 'sponsor-deliveries') {
      loadSponsorDeliveries().catch((error) => setFeedback(feedback, error.message, true));
    }
    if (button.dataset.adminTab === 'artists') {
      loadArtistMarketplace().catch((error) => setFeedback(feedback, error.message, true));
    }
    if (button.dataset.adminTab === 'gifts') {
      loadGiftMarketplace().catch((error) => setFeedback(feedback, error.message, true));
    }
    if (button.dataset.adminTab === 'hero-slides') {
      loadHeroSlides().catch((error) => setFeedback(feedback, error.message, true));
    }
  });

  const heroSlideForm = document.getElementById('heroSlideForm');
  const heroMediaType = heroSlideForm.elements.mediaType;
  const heroMediaUrl = heroSlideForm.elements.mediaUrl;
  const heroVideoFile = heroSlideForm.elements.videoFile;
  const heroImageFile = heroSlideForm.elements.imageFile;
  const heroVideoUploadLabel = heroSlideForm.querySelector('.hero-slide-upload');
  const heroImageUploadLabel = heroSlideForm.querySelector('.hero-slide-image-upload');
  const heroVideoLibrary = populateHeroVideoLibrary(document.getElementById('heroVideoLibrary'));
  heroVideoLibrary.addEventListener('change', () => {
    if (heroVideoLibrary.value) heroMediaUrl.value = heroVideoLibrary.value;
  });
  heroMediaUrl.addEventListener('input', () => {
    if (heroMediaUrl.value !== heroVideoLibrary.value) heroVideoLibrary.value = '';
  });
  function updateHeroMediaFields() {
    const isVideo = heroMediaType.value === 'video';
    heroVideoUploadLabel.hidden = !isVideo;
    heroVideoFile.disabled = !isVideo;
    heroImageUploadLabel.hidden = isVideo;
    heroImageFile.disabled = isVideo;
    heroSlideForm.querySelector('.hero-slide-video-library').hidden = !isVideo;
    const hasUpload = isVideo ? heroVideoFile.files.length : heroImageFile.files.length;
    heroMediaUrl.required = !hasUpload;
    heroMediaUrl.placeholder = isVideo ? 'videos/my-promo.mp4 or https://…' : 'images/my-promo.jpg or https://…';
  }
  heroMediaType.addEventListener('change', updateHeroMediaFields);
  heroVideoFile.addEventListener('change', updateHeroMediaFields);
  heroImageFile.addEventListener('change', updateHeroMediaFields);
  updateHeroMediaFields();

  heroSlideForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (!heroVideoFile.files.length) data.delete('videoFile');
    if (!heroImageFile.files.length) data.delete('imageFile');
    data.set('active', String(form.elements.active.checked));
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      await api('/api/admin/hero-slides', { method: 'POST', body: data });
      form.reset();
      updateHeroMediaFields();
      setFeedback(feedback, 'Homepage hero slide added.');
      await loadHeroSlides();
    } catch (error) {
      setFeedback(feedback, error.message, true);
    } finally {
      submit.disabled = false;
    }
  });

  document.getElementById('heroSlidesList').addEventListener('click', async (event) => {
    const save = event.target.closest('[data-save-hero-slide]');
    const toggle = event.target.closest('[data-toggle-hero-slide]');
    const move = event.target.closest('[data-move-hero-slide]');
    const button = save || toggle || move;
    if (!button) return;
    const card = button.closest('[data-hero-slide-id]');
    button.disabled = true;
    try {
      if (save) {
        const data = new FormData();
        card.querySelectorAll('[name]').forEach((field) => {
          if (field.type === 'file') {
            if (field.files.length) data.append(field.name, field.files[0]);
          } else {
            data.set(field.name, field.value);
          }
        });
        data.set('active', card.dataset.active);
        await api(`/api/admin/hero-slides/${encodeURIComponent(save.dataset.saveHeroSlide)}`, {
          method: 'PATCH',
          body: data
        });
        setFeedback(feedback, 'Homepage hero slide saved.');
      } else if (toggle) {
        await api(`/api/admin/hero-slides/${encodeURIComponent(toggle.dataset.toggleHeroSlide)}`, {
          method: 'PATCH',
          body: JSON.stringify({ active: toggle.dataset.active !== 'true' })
        });
        setFeedback(feedback, toggle.dataset.active === 'true'
          ? 'Slide removed from the homepage rotation.'
          : 'Slide restored to the homepage rotation.');
      } else {
        const cards = [...document.querySelectorAll('#heroSlidesList [data-hero-slide-id]')];
        const ids = cards.map((item) => item.dataset.heroSlideId);
        const index = ids.indexOf(card.dataset.heroSlideId);
        const target = button.dataset.moveHeroSlide === 'up' ? index - 1 : index + 1;
        if (target < 0 || target >= ids.length) return;
        [ids[index], ids[target]] = [ids[target], ids[index]];
        await api('/api/admin/hero-slides/reorder', {
          method: 'POST',
          body: JSON.stringify({ ids })
        });
        setFeedback(feedback, 'Homepage hero order updated.');
      }
      await loadHeroSlides();
    } catch (error) {
      setFeedback(feedback, error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('giftsSection').addEventListener('click', async (event) => {
    const merchantButton = event.target.closest('[data-save-gift-merchant]');
    const voucherButton = event.target.closest('[data-toggle-gift-voucher]');
    const payoutButton = event.target.closest('[data-record-gift-payout]');
    const refundButton = event.target.closest('[data-review-gift-refund]');
    const button = merchantButton || voucherButton || payoutButton || refundButton;
    if (!button) return;
    button.disabled = true;
    try {
      if (merchantButton) {
        const card = merchantButton.closest('[data-gift-merchant-id]');
        await api(`/api/gift-merchants/admin/${encodeURIComponent(card.dataset.giftMerchantId)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: card.querySelector('[data-gift-merchant-status]').value,
            adminNote: card.querySelector('[data-gift-merchant-note]').value
          })
        });
        setFeedback(feedback, 'Merchant review saved.');
      } else if (voucherButton) {
        await api(`/api/gift-vouchers/admin/${encodeURIComponent(voucherButton.dataset.toggleGiftVoucher)}`, {
          method: 'PATCH',
          body: JSON.stringify({ active: voucherButton.dataset.active !== 'true' })
        });
        setFeedback(feedback, 'Voucher listing updated.');
      } else if (payoutButton) {
        const card = payoutButton.closest('[data-gift-payout-merchant-id]');
        await api(`/api/gift-payouts/admin/${encodeURIComponent(card.dataset.giftPayoutMerchantId)}`, {
          method: 'POST',
          body: JSON.stringify({
            amountKes: Number(card.querySelector('[data-gift-payout-amount]').value),
            reference: card.querySelector('[data-gift-payout-reference]').value,
            note: card.querySelector('[data-gift-payout-note]').value
          })
        });
        setFeedback(feedback, 'Manual merchant payout recorded. This records a completed transfer; it does not send money.');
      } else {
        const card = refundButton.closest('[data-gift-refund-id]');
        const status = refundButton.dataset.reviewGiftRefund;
        const adminNote = card.querySelector('[data-gift-refund-note]').value;
        const refundReference = card.querySelector('[data-gift-refund-reference]').value;
        if (status === 'approved' && !window.confirm('Confirm that the refund has been completed manually and the reference is accurate?')) {
          button.disabled = false;
          return;
        }
        await api(`/api/gift-refunds/admin/${encodeURIComponent(card.dataset.giftRefundId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ status, adminNote, refundReference })
        });
        setFeedback(feedback, status === 'approved' ? 'Refund approved and recorded.' : 'Refund request rejected.');
      }
      await loadGiftMarketplace();
    } catch (error) {
      button.disabled = false;
      setFeedback(feedback, error.message, true);
    }
  });

  document.getElementById('artistProfilesList').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-artist-profile-status]');
    if (!button) return;
    const card = button.closest('[data-artist-profile-id]');
    const status = button.dataset.artistProfileStatus;
    if (status === 'suspended' && !window.confirm('Unlist this artist profile from public search? Existing bookings will remain available.')) return;
    button.disabled = true;
    try {
      await api(`/api/artists/admin/${encodeURIComponent(card.dataset.artistProfileId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      setFeedback(feedback, status === 'active' ? 'Artist profile restored.' : 'Artist profile unlisted.');
      await loadArtistProfiles();
    } catch (error) {
      button.disabled = false;
      setFeedback(feedback, error.message, true);
    }
  });

  document.getElementById('artistBookingsList').addEventListener('click', async (event) => {
    const payoutButton = event.target.closest('[data-record-artist-payout]');
    const refundButton = event.target.closest('[data-record-artist-refund]');
    const button = payoutButton || refundButton;
    if (!button) return;
    const card = button.closest('[data-artist-booking-id]');
    button.disabled = true;
    try {
      if (payoutButton) {
        if (!window.confirm('Confirm the artist payout has already been transferred. This only records the completed transfer.')) {
          button.disabled = false;
          return;
        }
        await api(`/api/artist-bookings/admin/${encodeURIComponent(card.dataset.artistBookingId)}/payout`, {
          method: 'POST',
          body: JSON.stringify({
            reference: card.querySelector('[data-artist-payout-reference]').value,
            note: card.querySelector('[data-artist-payout-note]').value
          })
        });
        setFeedback(feedback, 'Manual artist deposit payout recorded.');
      } else {
        if (!window.confirm('Confirm the refund has already been transferred and follows the accepted cancellation policy. This only records the completed refund.')) {
          button.disabled = false;
          return;
        }
        await api(`/api/artist-bookings/admin/${encodeURIComponent(card.dataset.artistBookingId)}/refund`, {
          method: 'POST',
          body: JSON.stringify({
            amountKes: Number(card.querySelector('[data-artist-refund-amount]').value),
            reference: card.querySelector('[data-artist-refund-reference]').value,
            note: card.querySelector('[data-artist-refund-note]').value
          })
        });
        setFeedback(feedback, 'Manual artist booking refund recorded.');
      }
      await loadArtistBookings();
    } catch (error) {
      button.disabled = false;
      setFeedback(feedback, error.message, true);
    }
  });

  document.getElementById('partnersList').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-partner-status], [data-record-partner-payout]');
    if (!button) return;
    const card = button.closest('[data-partner-id]');
    button.disabled = true;
    try {
      if (button.hasAttribute('data-partner-status')) {
        const status = button.dataset.partnerStatus;
        const rateInput = card.querySelector('[data-commission-percent]');
        const adminNote = window.prompt(status === 'approved'
          ? 'Optional note for the partner about the agreed commission terms:'
          : 'Optional note for the partner:', card.dataset.adminNote || '');
        if (adminNote === null) {
          button.disabled = false;
          return;
        }
        const body = {
          status,
          adminNote
        };
        if (status === 'approved') {
          const rate = Number(rateInput && rateInput.value);
          if (!Number.isFinite(rate) || rate <= 0 || rate > 100) {
            throw new Error('Enter the commission rate agreed with this creator before activating the link.');
          }
          body.commissionPercent = rate;
        }
        await api(`/api/partners/admin/${encodeURIComponent(card.dataset.partnerId)}`, {
          method: 'PATCH',
          body: JSON.stringify(body)
        });
        setFeedback(feedback, status === 'approved' ? 'Creator partner activated.' : `Creator partner ${status}.`);
      } else {
        const amountKes = Number(card.querySelector('[data-payout-amount]').value);
        const reference = card.querySelector('[data-payout-reference]').value;
        const note = card.querySelector('[data-payout-note]').value;
        await api(`/api/partners/admin/${encodeURIComponent(card.dataset.partnerId)}/payout`, {
          method: 'POST',
          body: JSON.stringify({ amountKes, reference, note })
        });
        setFeedback(feedback, 'Manual payout recorded. This action records a transfer already made; it does not send money.');
      }
      await loadPartners();
    } catch (error) {
      button.disabled = false;
      setFeedback(feedback, error.message, true);
    }
  });

  document.getElementById('partnershipApplicationsList').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-save-partnership-application]');
    if (!button) return;
    const card = button.closest('[data-partnership-application-id]');
    button.disabled = true;
    try {
      const result = await api(`/api/partnership-applications/admin/${encodeURIComponent(card.dataset.partnershipApplicationId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: card.querySelector('[data-application-status]').value,
          adminNote: card.querySelector('[data-application-note]').value
        })
      });
      setFeedback(feedback, result.message);
      await loadPartnershipApplications();
    } catch (error) {
      button.disabled = false;
      setFeedback(feedback, error.message, true);
    }
  });

  document.getElementById('submissionsList').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-review-event]');
    if (!button) return;
    let reviewNote = '';
    if (button.dataset.reviewStatus === 'rejected') {
      const isLive = button.dataset.currentStatus === 'approved';
      reviewNote = window.prompt(isLive
        ? 'Optional: tell the organizer why this live event is being unpublished.'
        : 'Optional: tell the organizer why this event was rejected.') || '';
      if (!window.confirm(isLive ? 'Unpublish this live event?' : 'Reject this event submission?')) return;
    } else if (!window.confirm('Approve and publish this event on Valor Africa?')) {
      return;
    }
    button.disabled = true;
    try {
      await api(`/api/events/admin/${encodeURIComponent(button.dataset.reviewEvent)}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ status: button.dataset.reviewStatus, reviewNote })
      });
      setFeedback(feedback, button.dataset.reviewStatus === 'approved'
        ? 'Event approved and published.'
        : 'Event unpublished from Valor Africa.');
      await loadSubmissions();
    } catch (error) {
      button.disabled = false;
      setFeedback(feedback, error.message, true);
    }
  });

  document.getElementById('packageForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const packageForm = event.currentTarget;
    const data = new FormData(packageForm);
    try {
      await api('/api/admin/packages', {
        method: 'POST',
        body: JSON.stringify({
          name: data.get('name'),
          description: data.get('description'),
          placement: data.get('placement'),
          pricePerDayKes: Number(data.get('pricePerDayKes')),
          minDays: Number(data.get('minDays')),
          maxDays: Number(data.get('maxDays'))
        })
      });
      packageForm.reset();
      setFeedback(feedback, 'Advertising tier added.');
      await loadPackages();
    } catch (error) {
      setFeedback(feedback, error.message, true);
    }
  });

  document.getElementById('productForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const productForm = event.currentTarget;
    const data = new FormData(productForm);
    const stock = data.get('stock');
    try {
      await api('/api/shop/admin/products', {
        method: 'POST',
        body: JSON.stringify({
          name: data.get('name'),
          description: data.get('description'),
          priceKes: Number(data.get('priceKes')),
          imageUrl: data.get('imageUrl'),
          stock: stock === '' ? null : Number(stock)
        })
      });
      productForm.reset();
      setFeedback(feedback, 'Merchandise product added.');
      await loadProducts();
    } catch (error) {
      setFeedback(feedback, error.message, true);
    }
  });

  document.getElementById('productsList').addEventListener('click', async (event) => {
    const save = event.target.closest('[data-save-product]');
    const toggle = event.target.closest('[data-toggle-product]');
    if (!save && !toggle) return;
    const button = save || toggle;
    const card = button.closest('[data-product-id]');
    const stockValue = card.querySelector('[name=stock]').value;
    const body = save
      ? {
        name: card.querySelector('[name=name]').value,
        description: card.querySelector('[name=description]').value,
        priceKes: Number(card.querySelector('[name=priceKes]').value),
        imageUrl: card.querySelector('[name=imageUrl]').value,
        stock: stockValue === '' ? null : Number(stockValue)
      }
      : { active: toggle.dataset.active !== 'true' };
    button.disabled = true;
    try {
      await api(`/api/shop/admin/products/${encodeURIComponent(button.dataset.saveProduct || button.dataset.toggleProduct)}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
      setFeedback(feedback, 'Merchandise product updated.');
      await loadProducts();
    } catch (error) {
      button.disabled = false;
      setFeedback(feedback, error.message, true);
    }
  });

  document.getElementById('packagesList').addEventListener('click', async (event) => {
    const save = event.target.closest('[data-save-package]');
    const toggle = event.target.closest('[data-toggle-package]');
    if (!save && !toggle) return;
    const button = save || toggle;
    const card = button.closest('[data-package-id]');
    const body = save
      ? {
        name: card.querySelector('[name=name]').value,
        description: card.querySelector('[name=description]').value,
        placement: card.querySelector('[name=placement]').value,
        pricePerDayKes: Number(card.querySelector('[name=pricePerDayKes]').value),
        minDays: Number(card.querySelector('[name=minDays]').value),
        maxDays: Number(card.querySelector('[name=maxDays]').value)
      }
      : { active: toggle.dataset.active !== 'true' };
    button.disabled = true;
    try {
      await api(`/api/admin/packages/${encodeURIComponent(button.dataset.savePackage || button.dataset.togglePackage)}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
      setFeedback(feedback, 'Advertising package updated.');
      await loadPackages();
    } catch (error) {
      button.disabled = false;
      setFeedback(feedback, error.message, true);
    }
  });

  if (tokenStore.get()) {
    showDashboard().catch((error) => setFeedback(feedback, error.message, true));
  }
})();
