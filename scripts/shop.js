(function () {
  'use strict';

  const accountTokenKey = 'valor-account-token';
  const cartKey = 'valor-shop-cart';
  const cart = new Map();
  try {
    const savedCart = JSON.parse(window.localStorage.getItem(cartKey) || '[]');
    if (Array.isArray(savedCart)) savedCart.forEach((item) => {
      if (item && typeof item.productId === 'string' && Number.isInteger(item.quantity) && item.quantity > 0) cart.set(item.productId, item.quantity);
    });
  } catch (error) { window.localStorage.removeItem(cartKey); }
  const products = new Map();
  const productGrid = document.getElementById('shopProducts');
  const productFeedback = document.getElementById('shopProductsFeedback');
  const previewProducts = [
    {
      id: 'valor-tote',
      name: 'Valor Africa Tote Bag',
      description: 'Durable canvas tote with the Valor Africa emblem, hand-printed.',
      priceKes: 4500,
      imageUrl: 'images/one.jpg',
      stock: null
    },
    {
      id: 'community-print-tee',
      name: 'Community Print Tee',
      description: 'Soft cotton tee celebrating African entrepreneurship.',
      priceKes: 2800,
      imageUrl: 'images/IMG_0729.jpg',
      stock: null
    },
    {
      id: 'founders-notebook',
      name: 'Founder’s Notebook',
      description: 'A5 hardcover notebook for brand-building notes and sketches.',
      priceKes: 6200,
      imageUrl: 'images/IMG_1212.jpg',
      stock: null
    }
  ];
  const cartItems = document.getElementById('shopCartItems');
  const cartCount = document.getElementById('shopCartCount');
  const cartTotal = document.getElementById('shopCartTotal');
  const checkoutForm = document.getElementById('shopCheckoutForm');
  const checkoutButton = document.getElementById('shopCheckoutButton');
  const checkoutFeedback = document.getElementById('shopCheckoutFeedback');
  const walletStatus = document.getElementById('shopWalletStatus');
  const signInNote = document.getElementById('shopSignInNote');
  const walletLinkNote = document.getElementById('shopWalletLinkNote');
  const paymentMethod = document.getElementById('shopPaymentMethod');
  let accountToken = '';
  let walletBalance = 0;
  let walletLinked = false;
  let catalogAvailable = false;
  let clientRequestId = '';

  function formatMoney(amount) {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: 'KES',
      maximumFractionDigits: 0
    }).format(amount);
  }

  function setFeedback(element, message, error = false) {
    element.textContent = message;
    element.classList.toggle('error', error);
  }

  function makeButton(label, className, action, disabled = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.cartAction = action;
    button.textContent = label;
    button.disabled = disabled;
    return button;
  }

  function renderProducts() {
    productGrid.replaceChildren();
    if (!products.size) {
      const empty = document.createElement('p');
      empty.className = 'shop-empty';
      empty.textContent = 'No merchandise is available right now. Please check back soon.';
      productGrid.appendChild(empty);
      return;
    }

    products.forEach((product) => {
      const card = document.createElement('article');
      card.className = 'shop-product-card';
      const image = document.createElement('img');
      image.className = 'shop-product-image';
      image.src = product.imageUrl;
      image.alt = product.name;
      image.loading = 'lazy';
      image.addEventListener('error', () => image.remove(), { once: true });
      card.appendChild(image);

      const details = document.createElement('div');
      details.className = 'shop-product-details';
      const brand = document.createElement('span');
      brand.className = 'shop-product-brand';
      brand.textContent = 'VALOR AFRICA';
      const name = document.createElement('h3');
      name.textContent = product.name;
      const description = document.createElement('p');
      description.textContent = product.description;
      const price = document.createElement('strong');
      price.className = 'shop-product-price';
      price.textContent = formatMoney(product.priceKes);
      const stock = document.createElement('span');
      stock.className = 'shop-product-stock';
      stock.textContent = !catalogAvailable
        ? 'Preview only — shop service unavailable'
        : product.stock === null ? 'Available' : product.stock > 0 ? `${product.stock} in stock` : 'Out of stock';
      stock.hidden = !catalogAvailable;
      const add = makeButton(
        !catalogAvailable ? 'Temporarily unavailable' : product.stock === 0 ? 'Out of stock' : 'Add to bag',
        'button button-primary shop-add-button',
        'add',
        !catalogAvailable || product.stock === 0
      );
      add.hidden = !catalogAvailable;
      add.dataset.productId = product.id;
      details.append(brand, name, description, price, stock, add);
      card.appendChild(details);
      productGrid.appendChild(card);
    });
  }

  function renderCart() {
    window.localStorage.setItem(cartKey, JSON.stringify(Array.from(cart, ([productId, quantity]) => ({ productId, quantity }))));
    cartItems.replaceChildren();
    let quantityTotal = 0;
    let total = 0;

    cart.forEach((quantity, productId) => {
      const product = products.get(productId);
      if (!product) return;
      quantityTotal += quantity;
      total += product.priceKes * quantity;

      const row = document.createElement('article');
      row.className = 'shop-cart-item';
      const info = document.createElement('div');
      info.className = 'shop-cart-item-info';
      const name = document.createElement('strong');
      name.textContent = product.name;
      const price = document.createElement('span');
      price.textContent = `${formatMoney(product.priceKes)} each`;
      info.append(name, price);
      const controls = document.createElement('div');
      controls.className = 'shop-quantity-controls';
      const decrease = makeButton('−', 'shop-quantity-button', 'decrease');
      decrease.dataset.productId = productId;
      decrease.setAttribute('aria-label', `Remove one ${product.name}`);
      const quantityLabel = document.createElement('span');
      quantityLabel.textContent = String(quantity);
      const available = product.stock === null ? Infinity : product.stock;
      const increase = makeButton('+', 'shop-quantity-button', 'increase', quantity >= 10 || quantity >= available);
      increase.dataset.productId = productId;
      increase.setAttribute('aria-label', `Add one ${product.name}`);
      const remove = makeButton('Remove', 'shop-remove-button', 'remove');
      remove.dataset.productId = productId;
      controls.append(decrease, quantityLabel, increase, remove);
      row.append(info, controls);
      cartItems.appendChild(row);
    });

    if (!cart.size) {
      const empty = document.createElement('p');
      empty.className = 'shop-cart-empty';
      empty.textContent = 'Your bag is empty. Add something you like.';
      cartItems.appendChild(empty);
    }

    cartCount.textContent = `${quantityTotal} ${quantityTotal === 1 ? 'item' : 'items'}`;
    cartTotal.textContent = formatMoney(total);
    checkoutButton.disabled = !catalogAvailable || !cart.size || !walletLinked || total > walletBalance;
    if (walletLinked && total > walletBalance && cart.size) {
      walletStatus.textContent = `Wallet balance: ${formatMoney(walletBalance)}. Add funds to cover your merchandise subtotal.`;
      walletStatus.classList.add('error');
    } else if (walletLinked) {
      walletStatus.textContent = `Valor Wallet balance: ${formatMoney(walletBalance)}`;
      walletStatus.classList.remove('error');
    }
  }

  async function loadProducts() {
    productGrid.setAttribute('aria-busy', 'true');
    try {
      const result = await window.valorEventsApi('/api/shop/products');
      if (!Array.isArray(result.products)) throw new Error('The shop returned an invalid product list.');
      catalogAvailable = true;
      products.clear();
      result.products.forEach((product) => products.set(product.id, product));
      for (const productId of cart.keys()) {
        if (!products.has(productId)) cart.delete(productId);
      }
      setFeedback(productFeedback, '');
      renderProducts();
      renderCart();
    } catch (error) {
      catalogAvailable = false;
      products.clear();
      previewProducts.forEach((product) => products.set(product.id, product));
      setFeedback(productFeedback, error.message, true);
      renderProducts();
      renderCart();
    } finally {
      productGrid.removeAttribute('aria-busy');
    }
  }

  async function loadWallet() {
    accountToken = window.valorAccountToken();
    if (!accountToken) {
      walletStatus.textContent = 'Sign in and use a linked Valor Wallet to pay.';
      checkoutForm.hidden = true;
      signInNote.hidden = false;
      walletLinkNote.hidden = true;
      walletLinked = false;
      renderCart();
      return;
    }
    signInNote.hidden = true;
    try {
      const headers = { Authorization: `Bearer ${accountToken}` };
      const [account, wallet] = await Promise.all([
        window.valorEventsApi('/api/auth/account', { headers }),
        window.valorEventsApi('/api/wallet', { headers })
      ]);
      if (!checkoutForm.elements.customerName.value) {
        checkoutForm.elements.customerName.value = account.account.displayName || '';
      }
      walletLinked = Boolean(wallet.linked);
      walletBalance = wallet.balanceKes;
      checkoutForm.hidden = !walletLinked;
      walletLinkNote.hidden = walletLinked;
      walletStatus.textContent = walletLinked
        ? `Valor Wallet balance: ${formatMoney(walletBalance)}`
        : 'Link your phone wallet to pay for merchandise.';
      walletStatus.classList.remove('error');
      renderCart();
    } catch (error) {
      walletLinked = false;
      checkoutForm.hidden = true;
      walletStatus.textContent = error.message;
      walletStatus.classList.add('error');
      renderCart();
    }
  }

  productGrid.addEventListener('click', (event) => {
    const button = event.target.closest('[data-cart-action="add"]');
    if (!button) return;
    const product = products.get(button.dataset.productId);
    if (!catalogAvailable || !product || product.stock === 0) return;
    const current = cart.get(product.id) || 0;
    const maximum = product.stock === null ? 10 : Math.min(10, product.stock);
    if (current >= maximum) return;
    cart.set(product.id, current + 1);
    setFeedback(checkoutFeedback, '');
    renderCart();
  });

  cartItems.addEventListener('click', (event) => {
    const button = event.target.closest('[data-cart-action]');
    if (!button) return;
    const productId = button.dataset.productId;
    const quantity = cart.get(productId);
    if (!quantity) return;
    if (button.dataset.cartAction === 'remove' || (button.dataset.cartAction === 'decrease' && quantity === 1)) {
      cart.delete(productId);
    } else if (button.dataset.cartAction === 'decrease') {
      cart.set(productId, quantity - 1);
    } else if (button.dataset.cartAction === 'increase') {
      const product = products.get(productId);
      const maximum = product && product.stock !== null ? Math.min(10, product.stock) : 10;
      if (quantity < maximum) cart.set(productId, quantity + 1);
    }
    renderCart();
  });

  checkoutForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!accountToken || !walletLinked || !cart.size) return;
    const items = Array.from(cart, ([productId, quantity]) => ({ productId, quantity }));
    if (!clientRequestId) clientRequestId = crypto.randomUUID();
    checkoutButton.disabled = true;
    setFeedback(checkoutFeedback, 'Confirming your Valor Wallet payment…');
    try {
      const result = await window.valorEventsApi('/api/orders/merchandise', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accountToken}` },
        body: JSON.stringify({
          items,
          customerName: checkoutForm.elements.customerName.value,
          phone: checkoutForm.elements.phone.value,
          deliveryAddress: checkoutForm.elements.deliveryAddress.value,
          paymentMethod: paymentMethod.value,
          clientRequestId
        })
      });
      cart.clear();
      clientRequestId = '';
      walletBalance = result.balanceKes;
      setFeedback(checkoutFeedback, `Order ${result.orderId} paid successfully. Our team will contact you about delivery.`);
      await Promise.all([loadProducts(), loadWallet()]);
      renderCart();
    } catch (error) {
      setFeedback(checkoutFeedback, error.message, true);
      if (error.message.toLowerCase().includes('wallet balance is too low')) await loadWallet();
      renderCart();
    }
  });

  loadProducts();
  loadWallet();
})();
