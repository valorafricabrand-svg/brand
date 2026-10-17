(function () {
  'use strict';

  const phoneKey = 'valor-wallet-link-phone';
  const accountTokenKey = 'valor-account-token';
  const dashboard = document.getElementById('walletDashboard');
  const phoneForm = document.getElementById('walletPhoneForm');
  const verifyForm = document.getElementById('walletVerifyForm');
  const signInFeedback = document.getElementById('walletSignInFeedback');
  const depositFeedback = document.getElementById('walletDepositFeedback');
  let walletAvailable = false;

  function setFeedback(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle('error', isError);
  }

  function authHeaders() {
    return { Authorization: `Bearer ${window.sessionStorage.getItem(accountTokenKey) || ''}` };
  }

  function formatMoney(amount) {
    return `KES ${Number(amount).toLocaleString('en-KE')}`;
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
    const list = document.getElementById('walletTransactions');
    list.replaceChildren();
    if (!wallet.transactions.length) {
      const empty = document.createElement('p');
      empty.className = 'wallet-empty';
      empty.textContent = 'No wallet activity yet. Make your first deposit to get started.';
      list.appendChild(empty);
    }
    wallet.transactions.forEach((transaction) => {
      const item = document.createElement('article');
      item.className = 'wallet-transaction';
      const details = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = transaction.description;
      const date = document.createElement('span');
      date.textContent = new Date(`${transaction.createdAt.replace(' ', 'T')}Z`).toLocaleString('en-KE');
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
      list.appendChild(item);
    });
    return wallet.transactions.some((transaction) => transaction.status === 'pending');
  }

  async function refreshWallet() {
    if (!walletAvailable) return;
    try {
      if (await loadWallet()) window.setTimeout(refreshWallet, 5000);
    } catch (error) {
      setFeedback(signInFeedback, error.message, true);
    }
  }

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
