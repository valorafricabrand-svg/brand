(function () {
  'use strict';

  const tokenKey = 'valor-wallet-token';
  const phoneKey = 'valor-wallet-phone';
  const signIn = document.getElementById('walletSignIn');
  const dashboard = document.getElementById('walletDashboard');
  const phoneForm = document.getElementById('walletPhoneForm');
  const verifyForm = document.getElementById('walletVerifyForm');
  const signInFeedback = document.getElementById('walletSignInFeedback');
  const depositFeedback = document.getElementById('walletDepositFeedback');

  function setFeedback(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle('error', isError);
  }

  function authHeaders() {
    return { Authorization: `Bearer ${window.sessionStorage.getItem(tokenKey) || ''}` };
  }

  function formatMoney(amount) {
    return `KES ${Number(amount).toLocaleString('en-KE')}`;
  }

  function showSignedOut() {
    dashboard.hidden = true;
    signIn.hidden = false;
    const phone = window.sessionStorage.getItem(phoneKey);
    phoneForm.hidden = Boolean(phone);
    verifyForm.hidden = !phone;
    if (phone) document.getElementById('walletPhoneMessage').textContent = `Enter the code sent to ${phone}.`;
  }

  async function loadWallet() {
    const wallet = await window.valorEventsApi('/api/wallet', { headers: authHeaders() });
    dashboard.hidden = false;
    signIn.hidden = true;
    document.getElementById('walletBalance').textContent = formatMoney(wallet.balanceKes);
    document.getElementById('walletAccount').textContent = `${wallet.wallet.phone} · ${wallet.wallet.accountType}`;
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

  phoneForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = phoneForm.querySelector('[type=submit]');
    button.disabled = true;
    setFeedback(signInFeedback, 'Sending your secure sign-in code…');
    try {
      const result = await window.valorEventsApi('/api/wallet/otp', {
        method: 'POST',
        body: JSON.stringify({ phone: phoneForm.elements.phone.value })
      });
      const normalizedPhone = phoneForm.elements.phone.value;
      window.sessionStorage.setItem(phoneKey, normalizedPhone);
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
    setFeedback(signInFeedback, 'Verifying your code…');
    try {
      const result = await window.valorEventsApi('/api/wallet/verify', {
        method: 'POST',
        body: JSON.stringify({
          phone: window.sessionStorage.getItem(phoneKey),
          code: verifyForm.elements.code.value,
          accountType: verifyForm.elements.accountType.value
        })
      });
      window.sessionStorage.setItem(tokenKey, result.accessToken);
      window.sessionStorage.removeItem(phoneKey);
      verifyForm.reset();
      setFeedback(signInFeedback, '');
      const pending = await loadWallet();
      if (pending) window.setTimeout(refreshWallet, 5000);
    } catch (error) {
      setFeedback(signInFeedback, error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('walletChangePhone').addEventListener('click', () => {
    window.sessionStorage.removeItem(phoneKey);
    showSignedOut();
    setFeedback(signInFeedback, '');
  });

  document.getElementById('walletSignOut').addEventListener('click', async () => {
    try {
      await window.valorEventsApi('/api/wallet/logout', { method: 'POST', headers: authHeaders() });
    } catch (error) {
      setFeedback(depositFeedback, `Could not revoke your wallet session: ${error.message}`, true);
      return;
    }
    window.sessionStorage.removeItem(tokenKey);
    window.sessionStorage.removeItem(phoneKey);
    showSignedOut();
  });

  document.getElementById('walletDepositForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    setFeedback(depositFeedback, 'Sending an M-Pesa deposit prompt…');
    try {
      const result = await window.valorEventsApi('/api/wallet/deposits', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ amountKes: Number(form.elements.amountKes.value) })
      });
      setFeedback(depositFeedback, result.message || 'Approve the M-Pesa prompt to complete your deposit.');
      if (await loadWallet()) window.setTimeout(refreshWallet, 5000);
    } catch (error) {
      setFeedback(depositFeedback, error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  async function refreshWallet() {
    try {
      if (await loadWallet()) window.setTimeout(refreshWallet, 5000);
    } catch (error) {
      window.sessionStorage.removeItem(tokenKey);
      setFeedback(signInFeedback, error.message, true);
      showSignedOut();
    }
  }

  const token = window.sessionStorage.getItem(tokenKey);
  if (token) refreshWallet();
  else showSignedOut();
})();
