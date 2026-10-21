(() => {
  'use strict';
  const tokenKey = 'valor-events-admin-token';
  const loginPanel = document.getElementById('loginPanel');
  const dashboard = document.getElementById('dashboard');
  const feedback = document.getElementById('dashboardFeedback');
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
    await loadProducts();
    await loadPackages();
    await loadOrders();
    await loadPartners();
    await loadPartnershipApplications();
  }

  function addText(parent, tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    parent.appendChild(element);
    return element;
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

  async function loadPackages() {
    const list = document.getElementById('packagesList');
    list.replaceChildren();
    const { packages } = await api('/api/ads/admin/packages');
    if (!packages.length) return addText(list, 'p', 'empty', 'Add a package and set its KES price before organizers can book ads.');
    packages.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'record package-row';
      card.dataset.packageId = item.id;
      const fields = [
        ['Name','name',item.name,'text'],
        ['Description','description',item.description,'text'],
        ['Duration (days)','durationDays',item.durationDays,'number'],
        ['Price (KES)','priceKes',item.priceKes,'number']
      ];
      fields.forEach(([labelText, name, value, type]) => {
        const label = document.createElement('label');
        label.textContent = labelText;
        const input = document.createElement('input');
        input.name = name;
        input.type = type;
        input.value = value;
        if (name === 'durationDays') { input.min = '1'; input.max = '90'; }
        if (name === 'priceKes') input.min = '1';
        label.appendChild(input);
        card.appendChild(label);
      });
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
    if (!applications.length) return addText(list, 'p', 'empty', 'No organizer or sponsor inquiries have been received.');
    applications.forEach((application) => {
      const card = document.createElement('article');
      card.className = 'record';
      card.dataset.partnershipApplicationId = application.id;
      addText(card, 'h3', '', `${application.type === 'organizer' ? 'Organizer partner' : 'Event sponsor'} · ${application.organizationName}`);
      addText(card, 'p', 'record-meta', `${application.status.toUpperCase()} · ${application.displayName || 'Account'} · ${application.email} · Submitted ${new Date(application.createdAt).toLocaleString()}`);
      if (application.websiteUrl) addText(card, 'p', 'record-contact', application.websiteUrl);
      addText(card, 'p', 'record-description', application.applicationDetails);
      if (application.requestedSupport) addText(card, 'p', 'record-contact',
        `${application.type === 'organizer' ? 'Interested support' : 'Events or activations'}: ${application.requestedSupport}`);
      const label = document.createElement('label');
      label.textContent = 'Follow-up status';
      const status = document.createElement('select');
      status.dataset.applicationStatus = '';
      ['pending','contacted','approved','rejected','closed'].forEach((value) => {
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
  document.getElementById('submissionStatus').addEventListener('change', () => {
    loadSubmissions().catch((error) => setFeedback(feedback, error.message, true));
  });

  document.querySelector('.tabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-admin-tab]');
    if (!button) return;
    document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('is-active', tab === button));
    document.getElementById('submissionsSection').hidden = button.dataset.adminTab !== 'submissions';
    document.getElementById('merchandiseSection').hidden = button.dataset.adminTab !== 'merchandise';
    document.getElementById('packagesSection').hidden = button.dataset.adminTab !== 'packages';
    document.getElementById('ordersSection').hidden = button.dataset.adminTab !== 'orders';
    document.getElementById('partnersSection').hidden = button.dataset.adminTab !== 'partners';
    document.getElementById('partnershipApplicationsSection').hidden = button.dataset.adminTab !== 'partnership-applications';
    if (button.dataset.adminTab === 'partners') {
      loadPartners().catch((error) => setFeedback(feedback, error.message, true));
    }
    if (button.dataset.adminTab === 'partnership-applications') {
      loadPartnershipApplications().catch((error) => setFeedback(feedback, error.message, true));
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
      await api('/api/ads/admin/packages', {
        method: 'POST',
        body: JSON.stringify({
          name: data.get('name'),
          description: data.get('description'),
          durationDays: Number(data.get('durationDays')),
          priceKes: Number(data.get('priceKes'))
        })
      });
      packageForm.reset();
      setFeedback(feedback, 'Paid advertising package added.');
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
        durationDays: Number(card.querySelector('[name=durationDays]').value),
        priceKes: Number(card.querySelector('[name=priceKes]').value)
      }
      : { active: toggle.dataset.active !== 'true' };
    button.disabled = true;
    try {
      await api(`/api/ads/admin/packages/${encodeURIComponent(button.dataset.savePackage || button.dataset.togglePackage)}`, {
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
