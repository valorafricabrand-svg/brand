const API_BASE = ''; // same-origin (dashboard is served by this backend)
const TOKEN_KEY = 'valorafrica_admin_token';

const els = {
  loginView: document.getElementById('login-view'),
  dashboardView: document.getElementById('dashboard-view'),
  loginForm: document.getElementById('login-form'),
  loginError: document.getElementById('login-error'),
  logoutBtn: document.getElementById('logout-btn'),
  tabBtns: document.querySelectorAll('.tab-btn'),
  productsTbody: document.getElementById('products-tbody'),
  productsEmpty: document.getElementById('products-empty'),
  offersTbody: document.getElementById('offers-tbody'),
  offersEmpty: document.getElementById('offers-empty'),
  newProductBtn: document.getElementById('new-product-btn'),
  newOfferBtn: document.getElementById('new-offer-btn'),
  productModal: document.getElementById('product-modal'),
  offerModal: document.getElementById('offer-modal'),
  productForm: document.getElementById('product-form'),
  offerForm: document.getElementById('offer-form'),
  productFormError: document.getElementById('product-form-error'),
  offerFormError: document.getElementById('offer-form-error'),
  offerAppliesTo: document.getElementById('offer-applies-to')
};

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

async function api(path, options = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;

  const res = await fetch(API_BASE + '/api' + path, { ...options, headers });
  if (res.status === 401) {
    clearToken();
    showLogin();
    throw new Error('Session expired. Please log in again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function showLogin() {
  els.loginView.classList.remove('hidden');
  els.dashboardView.classList.add('hidden');
}
function showDashboard() {
  els.loginView.classList.add('hidden');
  els.dashboardView.classList.remove('hidden');
  loadProducts();
  loadOffers();
}

// ---- Login ----
els.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.loginError.textContent = '';
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  try {
    const res = await fetch(API_BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed.');
    setToken(data.token);
    showDashboard();
  } catch (err) {
    els.loginError.textContent = err.message;
  }
});

els.logoutBtn.addEventListener('click', () => {
  clearToken();
  showLogin();
});

// ---- Tabs ----
els.tabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    els.tabBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
    document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
  });
});

// ---- Modal helpers ----
document.querySelectorAll('[data-close-modal]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.getElementById(btn.dataset.closeModal).classList.add('hidden');
  });
});

function money(cents, currency) {
  return (currency || 'KES') + ' ' + (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0 });
}

// ---- Products ----
async function loadProducts() {
  const data = await api('/products/admin/all');
  const products = data.products || [];
  els.productsTbody.innerHTML = '';
  els.productsEmpty.classList.toggle('hidden', products.length > 0);

  // populate offer "applies to" dropdown
  els.offerAppliesTo.innerHTML = '<option value="all">All products</option>' +
    products.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');

  for (const p of products) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(p.name)}</td>
      <td>${money(p.price_cents, p.currency)}</td>
      <td>${p.stock === null ? 'Unlimited' : p.stock}</td>
      <td><span class="badge ${p.active ? 'on' : 'off'}">${p.active ? 'Visible' : 'Hidden'}</span></td>
      <td>
        <button class="link-btn" onclick="editProduct(${p.id})">Edit</button>
        <button class="link-btn danger" onclick="deleteProduct(${p.id})">Delete</button>
      </td>`;
    els.productsTbody.appendChild(tr);
  }
}

let productsCache = [];
async function editProduct(id) {
  const data = await api('/products/admin/all');
  productsCache = data.products;
  const p = productsCache.find((x) => x.id === id);
  if (!p) return;
  document.getElementById('product-modal-title').textContent = 'Edit product';
  document.getElementById('product-id').value = p.id;
  document.getElementById('product-name').value = p.name;
  document.getElementById('product-description').value = p.description || '';
  document.getElementById('product-price').value = (p.price_cents / 100).toString();
  document.getElementById('product-image').value = p.image_url || '';
  document.getElementById('product-stock').value = p.stock === null ? '' : p.stock;
  document.getElementById('product-active').checked = !!p.active;
  els.productFormError.textContent = '';
  els.productModal.classList.remove('hidden');
}
window.editProduct = editProduct;

window.deleteProduct = async function (id) {
  if (!confirm('Delete this product? This cannot be undone.')) return;
  await api('/products/' + id, { method: 'DELETE' });
  loadProducts();
};

els.newProductBtn.addEventListener('click', () => {
  document.getElementById('product-modal-title').textContent = 'Add product';
  els.productForm.reset();
  document.getElementById('product-id').value = '';
  document.getElementById('product-active').checked = true;
  els.productFormError.textContent = '';
  els.productModal.classList.remove('hidden');
});

els.productForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.productFormError.textContent = '';
  const id = document.getElementById('product-id').value;
  const priceInput = parseFloat(document.getElementById('product-price').value);
  const stockInput = document.getElementById('product-stock').value;

  const payload = {
    name: document.getElementById('product-name').value.trim(),
    description: document.getElementById('product-description').value.trim(),
    price_cents: Math.round(priceInput * 100),
    image_url: document.getElementById('product-image').value.trim(),
    stock: stockInput === '' ? null : parseInt(stockInput, 10),
    active: document.getElementById('product-active').checked
  };

  try {
    if (id) {
      await api('/products/' + id, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api('/products', { method: 'POST', body: JSON.stringify(payload) });
    }
    els.productModal.classList.add('hidden');
    loadProducts();
  } catch (err) {
    els.productFormError.textContent = err.message;
  }
});

// ---- Offers ----
async function loadOffers() {
  const data = await api('/offers');
  const offers = data.offers || [];
  els.offersTbody.innerHTML = '';
  els.offersEmpty.classList.toggle('hidden', offers.length > 0);

  for (const o of offers) {
    const discount = o.type === 'percent' ? `${o.value}% off` : `KES ${(o.value / 100).toLocaleString()} off`;
    const appliesLabel = o.applies_to === 'all' ? 'All products' : `Product #${o.applies_to}`;
    const window = [o.starts_at, o.ends_at].filter(Boolean).join(' → ') || 'No limit';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(o.name)}</td>
      <td>${discount}</td>
      <td>${appliesLabel}</td>
      <td><span class="badge ${o.active ? 'on' : 'off'}">${o.active ? 'Active' : 'Off'}</span></td>
      <td>${escapeHtml(window)}</td>
      <td>
        <button class="link-btn" onclick="editOffer(${o.id})">Edit</button>
        <button class="link-btn danger" onclick="deleteOffer(${o.id})">Delete</button>
      </td>`;
    els.offersTbody.appendChild(tr);
  }
}

els.newOfferBtn.addEventListener('click', () => {
  document.getElementById('offer-modal-title').textContent = 'Create offer';
  els.offerForm.reset();
  document.getElementById('offer-id').value = '';
  document.getElementById('offer-active').checked = true;
  els.offerFormError.textContent = '';
  els.offerModal.classList.remove('hidden');
});

window.editOffer = async function (id) {
  const data = await api('/offers');
  const o = data.offers.find((x) => x.id === id);
  if (!o) return;
  document.getElementById('offer-modal-title').textContent = 'Edit offer';
  document.getElementById('offer-id').value = o.id;
  document.getElementById('offer-name').value = o.name;
  document.getElementById('offer-type').value = o.type;
  document.getElementById('offer-value').value = o.type === 'percent' ? o.value : o.value / 100;
  document.getElementById('offer-applies-to').value = o.applies_to;
  document.getElementById('offer-starts').value = o.starts_at ? o.starts_at.slice(0, 16) : '';
  document.getElementById('offer-ends').value = o.ends_at ? o.ends_at.slice(0, 16) : '';
  document.getElementById('offer-active').checked = !!o.active;
  els.offerFormError.textContent = '';
  els.offerModal.classList.remove('hidden');
};

window.deleteOffer = async function (id) {
  if (!confirm('Delete this offer?')) return;
  await api('/offers/' + id, { method: 'DELETE' });
  loadOffers();
};

els.offerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.offerFormError.textContent = '';
  const id = document.getElementById('offer-id').value;
  const type = document.getElementById('offer-type').value;
  const rawValue = parseFloat(document.getElementById('offer-value').value);

  const payload = {
    name: document.getElementById('offer-name').value.trim(),
    type,
    value: type === 'percent' ? rawValue : Math.round(rawValue * 100), // fixed stored in cents
    applies_to: document.getElementById('offer-applies-to').value,
    starts_at: document.getElementById('offer-starts').value || null,
    ends_at: document.getElementById('offer-ends').value || null,
    active: document.getElementById('offer-active').checked
  };

  try {
    if (id) {
      await api('/offers/' + id, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api('/offers', { method: 'POST', body: JSON.stringify(payload) });
    }
    els.offerModal.classList.add('hidden');
    loadOffers();
  } catch (err) {
    els.offerFormError.textContent = err.message;
  }
});

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- Boot ----
if (getToken()) {
  showDashboard();
} else {
  showLogin();
}
