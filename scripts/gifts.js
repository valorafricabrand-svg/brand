(function () {
  'use strict';

  const accountToken = window.valorAccountToken();
  const headers = () => {
    const token = window.valorAccountToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
  const money = (value) => `KES ${Number(value || 0).toLocaleString('en-KE')}`;
  const feedback = (element, message, error = false) => {
    element.textContent = message;
    element.classList.toggle('is-error', error);
  };
  const addText = (parent, tag, className, value) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value || '';
    parent.appendChild(element);
    return element;
  };
  const option = (select, value, label) => {
    const item = document.createElement('option');
    item.value = value;
    item.textContent = label;
    select.appendChild(item);
  };

  const accountTools = document.getElementById('giftAccountTools');
  const accountPrompt = document.getElementById('giftSignInPrompt');
  const giftsSection = document.getElementById('your-gifts');
  const amountOptions = document.getElementById('giftAmountOptions');
  const customAmount = document.getElementById('giftCustomAmount');
  const purchaseForm = document.getElementById('giftPurchaseForm');
  const voucherDialog = document.getElementById('voucherCheckoutDialog');
  const voucherForm = document.getElementById('voucherCheckoutForm');
  let voucherCheckout = null;
  let walletLinked = false;
  let giftPurchases = [];
  let voucherOrders = [];
  let merchantData = null;
  const giftRequestStorageKey = `valor-gift-request:${window.valorAccountToken()}`;
  const voucherRequestStorageKey = `valor-voucher-request:${window.valorAccountToken()}`;

  function getRequestId(storageKey, values) {
    const fingerprint = JSON.stringify(values);
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(storageKey) || 'null');
      if (saved && saved.fingerprint === fingerprint && typeof saved.id === 'string') return saved.id;
      const id = crypto.randomUUID();
      window.sessionStorage.setItem(storageKey, JSON.stringify({ id, fingerprint }));
      return id;
    } catch (error) {
      return crypto.randomUUID();
    }
  }

  function clearRequestId(storageKey) {
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch (error) {
      // Session storage is optional; a new request ID will be used if it is unavailable.
    }
  }

  function updatePhoneFields() {
    document.querySelectorAll('[data-payment-selector]').forEach((select) => {
      const field = select.closest('form').querySelector('[data-phone-field]');
      const show = select.value === 'mpesa';
      field.hidden = !show;
      field.querySelector('input').required = show;
    });
  }

  function setWalletOptions() {
    document.querySelectorAll('[data-payment-selector] option[value="wallet"]').forEach((item) => {
      item.disabled = !walletLinked;
    });
    document.querySelectorAll('[data-payment-selector]').forEach((select) => {
      if (select.value === 'wallet' && !walletLinked) select.value = 'mpesa';
    });
    updatePhoneFields();
  }

  async function loadWalletStatus() {
    const status = document.getElementById('giftWalletStatus');
    if (!accountToken) {
      status.textContent = 'Sign in and link a Valor Wallet to pay with wallet balance.';
      return;
    }
    try {
      const wallet = await window.valorEventsApi('/api/wallet', { headers: headers() });
      walletLinked = Boolean(wallet.linked);
      status.textContent = walletLinked
        ? `Valor Wallet linked · available balance ${money(wallet.balanceKes)}`
        : 'Link a verified phone wallet to pay with Valor Wallet. M-Pesa is also available.';
    } catch (error) {
      status.textContent = `Wallet status could not be checked: ${error.message}`;
    } finally {
      setWalletOptions();
    }
  }

  function renderAmountOptions(catalog) {
    amountOptions.replaceChildren();
    catalog.amountsKes.forEach((amount, index) => {
      const label = document.createElement('label');
      label.className = 'gift-amount-option';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'amountKes';
      input.value = String(amount);
      input.checked = index === 1;
      const text = document.createElement('span');
      text.textContent = money(amount);
      label.append(input, text);
      amountOptions.appendChild(label);
    });
    const customLabel = document.createElement('label');
    customLabel.className = 'gift-amount-option';
    const customRadio = document.createElement('input');
    customRadio.type = 'radio';
    customRadio.name = 'amountKes';
    customRadio.value = 'custom';
    const customText = document.createElement('span');
    customText.textContent = 'Custom';
    customLabel.append(customRadio, customText);
    amountOptions.appendChild(customLabel);
  }

  async function loadVoucherCatalog() {
    const list = document.getElementById('merchantVoucherCatalog');
    const status = document.getElementById('voucherCatalogFeedback');
    list.replaceChildren();
    try {
      const { vouchers } = await window.valorEventsApi('/api/gift-vouchers');
      if (!vouchers.length) {
        addText(list, 'p', 'gift-empty-state', 'New offers from verified local businesses are coming soon.');
        return;
      }
      vouchers.forEach((voucher) => {
        const card = document.createElement('article');
        card.className = 'merchant-voucher-card';
        const top = document.createElement('div');
        top.className = 'merchant-voucher-top';
        addText(top, 'span', 'merchant-voucher-mark', voucher.merchantName.slice(0, 1).toUpperCase());
        const identity = document.createElement('div');
        addText(identity, 'span', 'merchant-voucher-issuer', 'VERIFIED MERCHANT');
        addText(identity, 'strong', '', voucher.merchantName);
        top.appendChild(identity);
        card.appendChild(top);
        addText(card, 'h3', '', voucher.title);
        addText(card, 'p', 'merchant-voucher-description', voucher.description);
        const value = document.createElement('div');
        value.className = 'merchant-voucher-value';
        addText(value, 'span', '', 'Voucher value');
        addText(value, 'strong', '', money(voucher.faceValueKes));
        if (voucher.salePriceKes < voucher.faceValueKes) {
          addText(value, 'span', 'merchant-voucher-saving', `Save ${money(voucher.faceValueKes - voucher.salePriceKes)}`);
        }
        card.appendChild(value);
        addText(card, 'p', 'merchant-voucher-instructions', voucher.redemptionInstructions);
        if (voucher.terms) addText(card, 'p', 'merchant-voucher-terms', `Terms: ${voucher.terms}`);
        const action = document.createElement('div');
        action.className = 'merchant-voucher-action';
        addText(action, 'strong', '', money(voucher.salePriceKes));
        const button = document.createElement('button');
        button.className = 'button button-primary';
        button.type = 'button';
        button.textContent = 'Choose this voucher';
        button.addEventListener('click', () => openVoucherCheckout(voucher));
        action.appendChild(button);
        card.appendChild(action);
        list.appendChild(card);
      });
      feedback(status, '');
    } catch (error) {
      feedback(status, error.message, true);
    }
  }

  function openVoucherCheckout(voucher) {
    if (!window.valorAccountToken()) {
      window.location.href = `account.html?returnTo=${encodeURIComponent('/gifts.html#merchant-vouchers')}`;
      return;
    }
    voucherCheckout = voucher;
    document.getElementById('voucherCheckoutTitle').textContent = voucher.title;
    document.getElementById('voucherCheckoutSummary').textContent =
      `${voucher.merchantName} · ${money(voucher.salePriceKes)} for ${money(voucher.faceValueKes)} value`;
    document.getElementById('voucherCheckoutTerms').textContent =
      `${voucher.redemptionInstructions}${voucher.terms ? ` Terms: ${voucher.terms}` : ''}`;
    feedback(document.getElementById('voucherCheckoutFeedback'), '');
    voucherDialog.showModal();
  }

  function addOwnedItem(list, title, meta, status, code, instructions, terms, merchantWebsite, refundStatus) {
    const card = document.createElement('article');
    card.className = 'owned-gift-card';
    addText(card, 'h4', '', title);
    addText(card, 'p', 'owned-gift-meta', meta);
    const badge = addText(card, 'span', `gift-status gift-status-${status}`, status.replaceAll('_', ' '));
    badge.setAttribute('aria-label', `Status: ${status.replaceAll('_', ' ')}`);
    if (refundStatus) {
      addText(card, 'p', 'owned-gift-meta', `Refund review: ${refundStatus.replaceAll('_', ' ')}`);
    }
    if (code) {
      const codeBlock = document.createElement('div');
      codeBlock.className = 'gift-code-block';
      const codeText = addText(codeBlock, 'code', '', code);
      const copyCode = document.createElement('button');
      copyCode.type = 'button';
      copyCode.className = 'button button-secondary';
      copyCode.textContent = 'Copy code';
      copyCode.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(code);
          copyCode.textContent = 'Copied';
        } catch (error) {
          codeText.focus();
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(codeText);
          selection.removeAllRanges();
          selection.addRange(range);
          copyCode.textContent = 'Select and copy';
        }
      });
      const share = document.createElement('button');
      share.type = 'button';
      share.className = 'button button-secondary';
      share.textContent = 'Copy gift link';
      share.addEventListener('click', async () => {
        const url = new URL('gifts.html', window.location.href);
        url.searchParams.set('redeem', code);
        try {
          await navigator.clipboard.writeText(url.href);
          share.textContent = 'Link copied';
        } catch (error) {
          window.prompt('Copy this gift link:', url.href);
        }
      });
      codeBlock.append(codeText, copyCode, share);
      card.appendChild(codeBlock);
    }
    if (instructions) addText(card, 'p', 'owned-gift-instructions', instructions);
    if (terms) addText(card, 'p', 'owned-gift-terms', `Terms: ${terms}`);
    if (merchantWebsite) {
      try {
        const url = new URL(merchantWebsite);
        if (url.protocol === 'https:') {
          const link = addText(card, 'a', 'owned-gift-merchant-link', 'Visit merchant website');
          link.href = url.href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
        }
      } catch (error) {
        // An invalid merchant URL should not make a purchased voucher inaccessible.
      }
    }
    list.appendChild(card);
  }

  function populateRefundOptions() {
    const select = document.getElementById('giftRefundInstrument');
    select.replaceChildren();
    option(select, '', 'Choose an eligible purchase');
    giftPurchases.filter((item) => item.status === 'paid' && item.cardStatus === 'issued' && !item.refundStatus).forEach((item) => {
      option(select, `gift_card:${item.purchaseId}`, `Valor gift card · ${money(item.amountKes)} · ${item.purchaseId.slice(0, 8)}`);
    });
    voucherOrders.filter((item) => item.status === 'paid' && !item.refundStatus).forEach((item) => {
      option(select, `merchant_voucher:${item.orderId}`, `${item.title} · ${money(item.amountKes)} · ${item.orderId.slice(0, 8)}`);
    });
  }

  async function loadMyGifts() {
    if (!window.valorAccountToken()) return;
    const cardList = document.getElementById('myGiftCards');
    const voucherList = document.getElementById('myVoucherOrders');
    cardList.replaceChildren();
    voucherList.replaceChildren();
    const [cards, vouchers] = await Promise.all([
      window.valorEventsApi('/api/gift-cards/mine', { headers: headers() }),
      window.valorEventsApi('/api/merchant-voucher-orders/mine', { headers: headers() })
    ]);
    giftPurchases = cards.purchases;
    voucherOrders = vouchers.orders;
    if (!giftPurchases.length) addText(cardList, 'p', 'gift-empty-state', 'Your Valor gift cards will appear here.');
    giftPurchases.forEach((item) => addOwnedItem(
      cardList,
      `${money(item.amountKes)} Valor gift credit`,
      `Purchased ${new Date(item.createdAt).toLocaleDateString('en-KE')} · ${item.recipientName ? `For ${item.recipientName}` : 'Gift card'}`,
      item.status === 'paid' ? item.cardStatus : item.status,
      item.code,
      item.message,
      '',
      '',
      item.refundStatus
    ));
    if (!voucherOrders.length) addText(voucherList, 'p', 'gift-empty-state', 'Your merchant vouchers will appear here.');
    voucherOrders.forEach((item) => addOwnedItem(
      voucherList,
      item.title,
      `${item.merchantName} · ${money(item.amountKes)} paid for ${money(item.faceValueKes)} value`,
      item.status,
      item.code,
      item.redemptionInstructions,
      item.terms,
      item.merchantWebsite,
      item.refundStatus
    ));
    populateRefundOptions();
  }

  function renderMerchant(data) {
    merchantData = data;
    const applicationPanel = document.getElementById('merchantApplicationPanel');
    const applicationForm = document.getElementById('merchantApplicationForm');
    const applicationStatus = document.getElementById('merchantApplicationStatus');
    const dashboard = document.getElementById('merchantDashboard');
    const approvedTools = document.getElementById('merchantApprovedTools');
    if (!data.merchant) {
      dashboard.hidden = true;
      applicationStatus.hidden = true;
      applicationForm.hidden = false;
      return;
    }
    applicationForm.hidden = true;
    applicationStatus.hidden = false;
    dashboard.hidden = false;
    document.getElementById('merchantSignInPrompt').hidden = true;
    const merchant = data.merchant;
    document.getElementById('merchantStudioTitle').textContent = `${merchant.businessName} · ${merchant.status}`;
    document.getElementById('merchantReviewNote').textContent = merchant.adminNote || (
      merchant.status === 'pending' ? 'Your application is being reviewed. We will update your account when verification is complete.' :
        merchant.status === 'rejected' ? 'Your application was not approved. Contact Valor support if you have questions.' :
          merchant.status === 'suspended' ? 'Selling tools are paused while we review your merchant account.' :
            'Your account is approved. Create a listing, load codes, and track your orders below.'
    );
    applicationStatus.replaceChildren();
    addText(applicationStatus, 'p', 'merchant-application-badge', `Application status: ${merchant.status.toUpperCase()}`);
    if (merchant.adminNote) addText(applicationStatus, 'p', 'gift-feedback', `Valor review note: ${merchant.adminNote}`);
    document.getElementById('merchantBalanceDue').textContent = money(data.dueKes);
    approvedTools.hidden = merchant.status !== 'approved';
    if (merchant.status !== 'approved') return;

    const voucherSelect = document.getElementById('merchantVoucherSelect');
    const priorVoucher = voucherSelect.value;
    voucherSelect.replaceChildren();
    option(voucherSelect, '', 'Choose a listing');
    const listingList = document.getElementById('merchantListingList');
    listingList.replaceChildren();
    if (!data.vouchers.length) addText(listingList, 'p', 'gift-empty-state', 'Create your first voucher listing above.');
    data.vouchers.forEach((voucher) => {
      option(voucherSelect, voucher.id, `${voucher.title} · ${voucher.stock} available`);
      const card = document.createElement('article');
      card.className = 'merchant-listing-card';
      addText(card, 'h4', '', voucher.title);
      addText(card, 'p', 'owned-gift-meta', `${money(voucher.salePriceKes)} sale · ${money(voucher.faceValueKes)} face value · ${voucher.stock} available · ${voucher.sold} sold`);
      addText(card, 'p', '', voucher.description);
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'button button-secondary';
      toggle.textContent = voucher.active ? 'Pause listing' : 'Activate listing';
      toggle.disabled = voucher.stock < 1 && !voucher.active;
      toggle.addEventListener('click', async () => {
        toggle.disabled = true;
        try {
          await window.valorEventsApi(`/api/gift-merchants/vouchers/${encodeURIComponent(voucher.id)}`, {
            method: 'PATCH',
            headers: headers(),
            body: JSON.stringify({ active: !voucher.active })
          });
          await loadMerchantDashboard();
        } catch (error) {
          feedback(document.getElementById('merchantListingFeedback'), error.message, true);
          toggle.disabled = false;
        }
      });
      card.appendChild(toggle);
      listingList.appendChild(card);
    });
    if (priorVoucher && data.vouchers.some((voucher) => voucher.id === priorVoucher)) voucherSelect.value = priorVoucher;

    const orderList = document.getElementById('merchantOrderList');
    orderList.replaceChildren();
    if (!data.orders.length) addText(orderList, 'p', 'gift-empty-state', 'Confirmed orders will appear here.');
    data.orders.forEach((order) => {
      const card = document.createElement('article');
      card.className = 'merchant-order-card';
      addText(card, 'strong', '', order.title);
      addText(card, 'span', '', `${money(order.amountKes)} · ${order.status} · ${new Date(order.createdAt).toLocaleDateString('en-KE')}`);
      if (order.receipt) addText(card, 'small', '', `M-Pesa receipt ${order.receipt}`);
      orderList.appendChild(card);
    });

    const refundList = document.getElementById('merchantRefundList');
    refundList.replaceChildren();
    if (!data.refundRequests.length) addText(refundList, 'p', 'gift-empty-state', 'No pending merchant voucher refund requests.');
    data.refundRequests.forEach((request) => {
      const card = document.createElement('article');
      card.className = 'merchant-order-card';
      addText(card, 'strong', '', `${request.title} · ${money(request.amountKes)}`);
      addText(card, 'p', '', `Customer reason: ${request.reason}`);
      addText(card, 'small', '', `Order ${request.orderId} · requested ${new Date(request.createdAt).toLocaleDateString('en-KE')}`);
      if (request.unusedConfirmed) {
        addText(card, 'p', 'gift-feedback', 'You confirmed this code is unused. Valor support will review the request.');
      } else {
        const confirmButton = document.createElement('button');
        confirmButton.type = 'button';
        confirmButton.className = 'button button-secondary';
        confirmButton.textContent = 'Confirm code is unused';
        confirmButton.addEventListener('click', async () => {
          if (!window.confirm('Confirm that you checked this voucher code and it has not been redeemed?')) return;
          confirmButton.disabled = true;
          try {
            const result = await window.valorEventsApi(
              `/api/gift-merchants/refunds/${encodeURIComponent(request.requestId)}/confirm-unused`,
              { method: 'POST', headers: headers() }
            );
            feedback(document.getElementById('merchantListingFeedback'), result.message);
            await loadMerchantDashboard();
          } catch (error) {
            feedback(document.getElementById('merchantListingFeedback'), error.message, true);
            confirmButton.disabled = false;
          }
        });
        card.appendChild(confirmButton);
      }
      refundList.appendChild(card);
    });
  }

  async function loadMerchantDashboard() {
    const data = await window.valorEventsApi('/api/gift-merchants/mine', { headers: headers() });
    renderMerchant(data);
  }

  if (!accountToken) {
    accountTools.hidden = true;
    accountPrompt.hidden = false;
    document.getElementById('merchantSignInPrompt').hidden = false;
    document.getElementById('merchantApplicationForm').hidden = true;
  } else {
    accountTools.hidden = false;
    accountPrompt.hidden = true;
    giftsSection.hidden = false;
    document.getElementById('merchantSignInPrompt').hidden = true;
    loadWalletStatus();
    Promise.all([loadMyGifts(), loadMerchantDashboard()]).catch((error) => {
      feedback(document.getElementById('giftPurchaseFeedback'), error.message, true);
      feedback(document.getElementById('merchantApplicationFeedback'), error.message, true);
    });
  }

  window.valorEventsApi('/api/gift-cards/catalog').then(renderAmountOptions).catch((error) => {
    feedback(document.getElementById('giftPurchaseFeedback'), error.message, true);
  });
  loadVoucherCatalog();

  document.querySelectorAll('[data-payment-selector]').forEach((select) => select.addEventListener('change', updatePhoneFields));
  customAmount.addEventListener('focus', () => {
    amountOptions.querySelector('input[value="custom"]').checked = true;
  });
  customAmount.addEventListener('input', () => {
    amountOptions.querySelector('input[value="custom"]').checked = true;
  });

  purchaseForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const amountValue = data.get('amountKes');
    const amountKes = amountValue === 'custom' ? Number(customAmount.value) : Number(amountValue);
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    feedback(document.getElementById('giftPurchaseFeedback'), 'Preparing your gift…');
    try {
      const purchase = {
        amountKes,
        recipientName: data.get('recipientName'),
        recipientContact: data.get('recipientContact'),
        message: data.get('message'),
        paymentMethod: data.get('paymentMethod'),
        phone: data.get('phone')
      };
      const result = await window.valorEventsApi('/api/gift-cards/purchase', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          ...purchase,
          clientRequestId: getRequestId(giftRequestStorageKey, purchase)
        })
      });
      if (result.status !== 'pending') clearRequestId(giftRequestStorageKey);
      feedback(document.getElementById('giftPurchaseFeedback'), result.message || 'Purchase request received.');
      if (data.get('paymentMethod') === 'wallet') form.reset();
      await Promise.all([loadMyGifts(), loadWalletStatus()]);
    } catch (error) {
      if (!/could not connect|timed out|network/i.test(error.message)) clearRequestId(giftRequestStorageKey);
      feedback(document.getElementById('giftPurchaseFeedback'), error.message, true);
    } finally {
      submit.disabled = false;
      setWalletOptions();
    }
  });

  document.getElementById('giftRedeemForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = document.getElementById('redeemGiftButton');
    button.disabled = true;
    try {
      const result = await window.valorEventsApi('/api/gift-cards/redeem', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ code: new FormData(form).get('code') })
      });
      feedback(document.getElementById('giftRedeemFeedback'), `${result.message} New wallet balance: ${money(result.balanceKes)}.`);
      form.reset();
      await Promise.all([loadMyGifts(), loadWalletStatus()]);
    } catch (error) {
      feedback(document.getElementById('giftRedeemFeedback'), error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  voucherForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!voucherCheckout) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const purchase = {
        buyerName: data.get('buyerName'),
        paymentMethod: data.get('paymentMethod'),
        phone: data.get('phone'),
        voucherId: voucherCheckout.id
      };
      const result = await window.valorEventsApi('/api/merchant-voucher-orders', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          ...purchase,
          clientRequestId: getRequestId(voucherRequestStorageKey, purchase)
        })
      });
      if (result.status !== 'pending') clearRequestId(voucherRequestStorageKey);
      feedback(document.getElementById('voucherCheckoutFeedback'), result.message || 'Purchase request received.');
      if (result.status === 'paid') {
        form.reset();
        await loadMyGifts();
      }
    } catch (error) {
      if (!/could not connect|timed out|network/i.test(error.message)) clearRequestId(voucherRequestStorageKey);
      feedback(document.getElementById('voucherCheckoutFeedback'), error.message, true);
    } finally {
      button.disabled = false;
      setWalletOptions();
    }
  });

  document.getElementById('closeVoucherDialog').addEventListener('click', () => voucherDialog.close());
  document.getElementById('refreshGiftsButton').addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try {
      await Promise.all([loadMyGifts(), loadMerchantDashboard()]);
    } catch (error) {
      feedback(document.getElementById('giftRefundFeedback'), error.message, true);
    } finally {
      event.currentTarget.disabled = false;
    }
  });

  document.getElementById('giftRefundForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const [instrumentType, instrumentId] = String(data.get('instrument') || '').split(':');
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await window.valorEventsApi('/api/gift-refunds', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ instrumentType, instrumentId, reason: data.get('reason') })
      });
      feedback(document.getElementById('giftRefundFeedback'), result.message);
      event.currentTarget.reset();
      await loadMyGifts();
    } catch (error) {
      feedback(document.getElementById('giftRefundFeedback'), error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('merchantApplicationForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const data = new FormData(form);
      const result = await window.valorEventsApi('/api/gift-merchants/applications', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          businessName: data.get('businessName'),
          websiteUrl: data.get('websiteUrl'),
          contactName: data.get('contactName'),
          contactPhone: data.get('contactPhone'),
          details: data.get('details')
        })
      });
      feedback(document.getElementById('merchantApplicationFeedback'), result.message);
      await loadMerchantDashboard();
    } catch (error) {
      feedback(document.getElementById('merchantApplicationFeedback'), error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('merchantVoucherForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const data = new FormData(form);
      const result = await window.valorEventsApi('/api/gift-merchants/vouchers', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          title: data.get('title'),
          description: data.get('description'),
          faceValueKes: Number(data.get('faceValueKes')),
          salePriceKes: Number(data.get('salePriceKes')),
          redemptionInstructions: data.get('redemptionInstructions'),
          terms: data.get('terms')
        })
      });
      form.reset();
      feedback(document.getElementById('merchantListingFeedback'), 'Listing created. Add encrypted voucher codes to publish it to buyers.');
      await loadMerchantDashboard();
      document.getElementById('merchantVoucherSelect').value = result.voucherId;
    } catch (error) {
      feedback(document.getElementById('merchantListingFeedback'), error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('merchantInventoryForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await window.valorEventsApi(`/api/gift-merchants/vouchers/${encodeURIComponent(data.get('voucherId'))}/inventory`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ codes: data.get('codes') })
      });
      form.reset();
      feedback(document.getElementById('merchantInventoryFeedback'), result.message);
      await loadMerchantDashboard();
    } catch (error) {
      feedback(document.getElementById('merchantInventoryFeedback'), error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  const redeemCode = new URL(window.location.href).searchParams.get('redeem');
  if (redeemCode) {
    document.querySelector('#giftRedeemForm [name="code"]').value = redeemCode;
    const url = new URL(window.location.href);
    url.searchParams.delete('redeem');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    document.getElementById('gift-options').scrollIntoView({ behavior: 'smooth' });
  }
})();
