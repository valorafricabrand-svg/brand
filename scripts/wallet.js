(function () {
  'use strict';

  const phoneKey = 'valor-wallet-link-phone';
  const accountTokenKey = 'valor-account-token';
  const dashboard = document.getElementById('walletDashboard');
  const phoneForm = document.getElementById('walletPhoneForm');
  const verifyForm = document.getElementById('walletVerifyForm');
  const signInFeedback = document.getElementById('walletSignInFeedback');
  const depositFeedback = document.getElementById('walletDepositFeedback');
  const filtersForm = document.getElementById('walletFilters');
  const transactionsFeedback = document.getElementById('walletTransactionsFeedback');
  const transactionsList = document.getElementById('walletTransactions');
  const loadMoreButton = document.getElementById('walletLoadMore');
  const exportButton = document.getElementById('walletExportButton');
  const transactionsPerPage = 20;
  let walletAvailable = false;
  let transactionOffset = 0;
  let transactionsTotal = 0;

  const transactionTypeLabels = {
    deposit: 'Deposit',
    ticket_purchase: 'Ticket purchase',
    ad_purchase: 'Ad purchase',
    merchandise_purchase: 'Merchandise purchase',
    gift_card_purchase: 'Gift card purchase',
    gift_card_redemption: 'Gift card redemption',
    gift_card_refund: 'Gift card refund',
    merchant_voucher_purchase: 'Merchant voucher purchase'
  };

  function setFeedback(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle('error', isError);
  }

  function authHeaders() {
    return { Authorization: `Bearer ${window.valorAccountToken()}` };
  }

  function formatMoney(amount) {
    return `KES ${Number(amount).toLocaleString('en-KE')}`;
  }

  function formatDate(createdAt) {
    return new Date(`${createdAt.replace(' ', 'T')}Z`).toLocaleString('en-KE');
  }

  function activeFilterQuery() {
    const params = new URLSearchParams();
    const { type, status, from, to } = filtersForm.elements;
    if (type.value && type.value !== 'all') params.set('type', type.value);
    if (status.value && status.value !== 'all') params.set('status', status.value);
    if (from.value) params.set('from', from.value);
    if (to.value) params.set('to', to.value);
    return params;
  }

  function printReceipt(transaction) {
    const receiptWindow = window.open('', '_blank', 'width=420,height=620');
    if (!receiptWindow) return;
    const rows = [
      ['Description', transaction.description],
      ['Type', transactionTypeLabels[transaction.type] || transaction.type],
      ['Date', formatDate(transaction.createdAt)],
      ['Amount', `${transaction.amountKes > 0 ? '+' : ''}${formatMoney(transaction.amountKes)}`],
      ['Status', transaction.status],
      ...(transaction.receipt ? [['M-Pesa receipt', transaction.receipt]] : [])
    ];
    receiptWindow.document.write(`<!doctype html><html><head><title>Valor Africa receipt</title>
      <style>
        body{font-family:Arial,sans-serif;color:#17221e;padding:28px;}
        h1{font-size:18px;color:#087f5b;margin:0 0 18px;}
        table{width:100%;border-collapse:collapse;font-size:13px;}
        td{padding:8px 0;border-bottom:1px solid #e7ece9;}
        td:first-child{color:#596a60;width:40%;}
      </style></head><body>
      <h1>Valor Africa — Wallet receipt</h1>
      <table>${rows.map(([label, value]) => `<tr><td>${label}</td><td>${String(value).replace(/[<>&]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[character]))}</td></tr>`).join('')}</table>
      </body></html>`);
    receiptWindow.document.close();
    receiptWindow.focus();
    receiptWindow.print();
  }

  function renderTransactions(transactions, { append = false } = {}) {
    if (!append) transactionsList.replaceChildren();
    if (!append && !transactions.length) {
      const empty = document.createElement('p');
      empty.className = 'wallet-empty';
      empty.textContent = 'No wallet activity matches these filters yet.';
      transactionsList.appendChild(empty);
      return;
    }
    transactions.forEach((transaction) => {
      const item = document.createElement('article');
      item.className = 'wallet-transaction';
      const details = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = transaction.description;
      const date = document.createElement('span');
      date.textContent = formatDate(transaction.createdAt);
      details.append(title, date);
      const amount = document.createElement('strong');
      amount.className = transaction.amountKes > 0 ? 'wallet-credit' : 'wallet-debit';
      amount.textContent = `${transaction.amountKes > 0 ? '+' : ''}${formatMoney(transaction.amountKes)}`;
      const status = document.createElement('span');
      status.className = `wallet-status wallet-status-${transaction.status}`;
      status.textContent = transaction.status;
      item.append(details, amount, status);
      if (transaction.receipt) {
        const receipt = document.createElement('small');
        receipt.textContent = `M-Pesa receipt ${transaction.receipt}`;
        item.appendChild(receipt);
      }
      const receiptButton = document.createElement('button');
      receiptButton.type = 'button';
      receiptButton.className = 'text-button wallet-receipt-button';
      receiptButton.textContent = 'View receipt';
      receiptButton.addEventListener('click', () => printReceipt(transaction));
      item.appendChild(receiptButton);
      transactionsList.appendChild(item);
    });
  }

  async function loadTransactions({ reset = true } = {}) {
    if (reset) transactionOffset = 0;
    const params = activeFilterQuery();
    params.set('limit', transactionsPerPage);
    params.set('offset', transactionOffset);
    const result = await window.valorEventsApi(`/api/wallet/transactions?${params.toString()}`, { headers: authHeaders() });
    renderTransactions(result.transactions, { append: !reset });
    transactionsTotal = result.total;
    transactionOffset += result.transactions.length;
    loadMoreButton.hidden = !result.hasMore;
    return result.transactions.some((transaction) => transaction.status === 'pending');
  }

  async function loadWallet() {
    const wallet = await window.valorEventsApi('/api/wallet', { headers: authHeaders() });
    phoneForm.hidden = wallet.linked || Boolean(window.sessionStorage.getItem(phoneKey));
    verifyForm.hidden = wallet.linked || !window.sessionStorage.getItem(phoneKey);
    dashboard.hidden = !wallet.linked;
    document.getElementById('walletLinkedPhone').hidden = !wallet.linked;
    if (!wallet.linked) {
      document.getElementById('walletLinkedPhone').textContent = '';
      if (window.sessionStorage.getItem(phoneKey)) {
        document.getElementById('walletPhoneMessage').textContent =
          `Enter the verification code sent to ${window.sessionStorage.getItem(phoneKey)}.`;
      }
      return false;
    }

    window.sessionStorage.removeItem(phoneKey);
    document.getElementById('walletBalance').textContent = formatMoney(wallet.balanceKes);
    document.getElementById('walletLinkedPhone').textContent = `Phone wallet linked: ${wallet.wallet.phone} · ${wallet.wallet.accountType}`;
    document.getElementById('walletLinkedPhone').hidden = false;
    try {
      return await loadTransactions({ reset: true });
    } catch (error) {
      setFeedback(transactionsFeedback, error.message, true);
      return false;
    }
  }

  async function refreshWallet() {
    if (!walletAvailable) return;
    try {
      if (await loadWallet()) window.setTimeout(refreshWallet, 5000);
    } catch (error) {
      setFeedback(signInFeedback, error.message, true);
    }
  }

  filtersForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFeedback(transactionsFeedback, 'Loading…');
    try {
      await loadTransactions({ reset: true });
      setFeedback(transactionsFeedback, '');
    } catch (error) {
      setFeedback(transactionsFeedback, error.message, true);
    }
  });

  loadMoreButton.addEventListener('click', async () => {
    loadMoreButton.disabled = true;
    try {
      await loadTransactions({ reset: false });
    } catch (error) {
      setFeedback(transactionsFeedback, error.message, true);
    } finally {
      loadMoreButton.disabled = false;
    }
  });

  exportButton.addEventListener('click', async () => {
    exportButton.disabled = true;
    setFeedback(transactionsFeedback, 'Preparing your export…');
    try {
      const params = activeFilterQuery();
      const response = await fetch(`${window.valorEventsApiBase}/api/wallet/transactions/export?${params.toString()}`, {
        headers: authHeaders()
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Could not export your transaction history.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `valor-wallet-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setFeedback(transactionsFeedback, '');
    } catch (error) {
      setFeedback(transactionsFeedback, error.message, true);
    } finally {
      exportButton.disabled = false;
    }
  });

  document.addEventListener('valor:account-session', (event) => {
    walletAvailable = Boolean(event.detail && event.detail.account);
    if (!walletAvailable) {
      dashboard.hidden = true;
      phoneForm.hidden = true;
      verifyForm.hidden = true;
      document.getElementById('walletLinkedPhone').hidden = true;
      window.sessionStorage.removeItem(phoneKey);
      return;
    }
    loadWallet().then((pending) => {
      if (pending) window.setTimeout(refreshWallet, 5000);
    }).catch((error) => setFeedback(signInFeedback, error.message, true));
  });

  phoneForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = phoneForm.querySelector('[type=submit]');
    button.disabled = true;
    setFeedback(signInFeedback, 'Sending a phone verification code…');
    try {
      const result = await window.valorEventsApi('/api/account/phone/otp', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ phone: phoneForm.elements.phone.value })
      });
      window.sessionStorage.setItem(phoneKey, phoneForm.elements.phone.value);
      phoneForm.hidden = true;
      verifyForm.hidden = false;
      document.getElementById('walletPhoneMessage').textContent = result.message;
      setFeedback(signInFeedback, '');
    } catch (error) {
      setFeedback(signInFeedback, error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  verifyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = verifyForm.querySelector('[type=submit]');
    button.disabled = true;
    setFeedback(signInFeedback, 'Linking your verified phone wallet…');
    try {
      await window.valorEventsApi('/api/account/phone/verify', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          phone: window.sessionStorage.getItem(phoneKey),
          code: verifyForm.elements.code.value,
          accountType: phoneForm.elements.accountType.value
        })
      });
      window.sessionStorage.removeItem(phoneKey);
      verifyForm.reset();
      setFeedback(signInFeedback, '');
      if (await loadWallet()) window.setTimeout(refreshWallet, 5000);
    } catch (error) {
      setFeedback(signInFeedback, error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('walletChangePhone').addEventListener('click', () => {
    window.sessionStorage.removeItem(phoneKey);
    verifyForm.reset();
    phoneForm.hidden = false;
    verifyForm.hidden = true;
    setFeedback(signInFeedback, '');
  });

  document.getElementById('walletDepositForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.elements.paymentMethod.value !== 'mpesa') {
      setFeedback(depositFeedback, 'That payment method is not available yet.', true);
      return;
    }
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    setFeedback(depositFeedback, 'Sending an M-Pesa deposit prompt…');
    try {
      const result = await window.valorEventsApi('/api/wallet/deposits', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          amountKes: Number(form.elements.amountKes.value),
          paymentMethod: form.elements.paymentMethod.value
        })
      });
      setFeedback(depositFeedback, result.message || 'Approve the M-Pesa prompt to complete your deposit.');
      if (await loadWallet()) window.setTimeout(refreshWallet, 5000);
    } catch (error) {
      setFeedback(depositFeedback, error.message, true);
    } finally {
      button.disabled = false;
    }
  });
})();
