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
      if (event.status === 'pending') {
        const actions = document.createElement('div');
        actions.className = 'record-actions';
        const approve = document.createElement('button');
        approve.type = 'button';
        approve.className = 'button primary';
        approve.dataset.reviewEvent = event.id;
        approve.dataset.reviewStatus = 'approved';
        approve.textContent = 'Approve & publish';
        const reject = document.createElement('button');
        reject.type = 'button';
        reject.className = 'button reject';
        reject.dataset.reviewEvent = event.id;
        reject.dataset.reviewStatus = 'rejected';
        reject.textContent = 'Reject';
        actions.append(approve, reject);
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
  });

  document.getElementById('submissionsList').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-review-event]');
    if (!button) return;
    let reviewNote = '';
    if (button.dataset.reviewStatus === 'rejected') {
      reviewNote = window.prompt('Optional: tell the organizer why this event was rejected.') || '';
      if (!window.confirm('Reject this event submission?')) return;
    } else if (!window.confirm('Approve and publish this event on Valor Africa?')) {
      return;
    }
    button.disabled = true;
    try {
      await api(`/api/events/admin/${encodeURIComponent(button.dataset.reviewEvent)}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ status: button.dataset.reviewStatus, reviewNote })
      });
      setFeedback(feedback, button.dataset.reviewStatus === 'approved' ? 'Event approved and published.' : 'Event submission rejected.');
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
