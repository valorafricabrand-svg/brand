(function () {
  'use strict';

  const phoneKey = 'valor-wallet-link-phone';
  const dashboard = document.getElementById('walletDashboard');
  const phoneForm = document.getElementById('walletPhoneForm');
  const verifyForm = document.getElementById('walletVerifyForm');
  const signInFeedback = document.getElementById('walletSignInFeedback');
  const depositFeedback = document.getElementById('walletDepositFeedback');
  const accountTokenKey = 'valor-account-token';
  const accountSignedOut = document.getElementById('accountSignedOut');
  const accountSignedIn = document.getElementById('accountSignedIn');
  const emailForm = document.getElementById('accountEmailForm');
  const emailFeedback = document.getElementById('accountEmailFeedback');
  let emailMode = 'options';

  function setFeedback(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle('error', isError);
  }

  function authHeaders() {
    return accountAuthHeaders();
  }

  function formatMoney(amount) {
    return `KES ${Number(amount).toLocaleString('en-KE')}`;
  }

  function accountAuthHeaders() {
    return { Authorization: `Bearer ${window.sessionStorage.getItem(accountTokenKey) || ''}` };
  }

  function setEmailMode(mode) {
    emailMode = mode;
    const options = mode === 'options';
    document.getElementById('emailAuthActions').hidden = !options;
    emailForm.hidden = options;
    document.getElementById('accountEmailHeading').textContent = ({
      login: 'Sign in with email',
      register: 'Create your account',
      verify: 'Verify your email',
      forgot: 'Reset your password',
      reset: 'Choose a new password'
    })[mode] || '';
    const nameField = document.getElementById('accountNameField');
    const passwordField = document.getElementById('accountPasswordField');
    const codeField = document.getElementById('accountCodeField');
    const passwordInput = emailForm.elements.password;
    const codeInput = emailForm.elements.code;
    nameField.hidden = mode !== 'register';
    nameField.querySelector('input').required = mode === 'register';
    passwordField.hidden = !['login','register','reset'].includes(mode);
    passwordInput.required = !passwordField.hidden;
    passwordInput.minLength = mode === 'login' ? 1 : 12;
    passwordInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    passwordField.querySelector('input').previousSibling.textContent = mode === 'reset' ? 'New password' : 'Password';
    codeField.hidden = !['verify','reset'].includes(mode);
    codeInput.required = !codeField.hidden;
    document.getElementById('accountEmailSubmit').textContent = ({
      login: 'Sign in',
      register: 'Send verification code',
      verify: 'Verify email and sign in',
      forgot: 'Send password reset code',
      reset: 'Reset password'
    })[mode] || '';
    document.getElementById('accountForgotPassword').hidden = mode !== 'login';
    document.getElementById('accountResendCode').hidden = mode !== 'verify';
    document.getElementById('accountBackToOptions').hidden = options || mode === 'verify' || mode === 'reset';
    setFeedback(emailFeedback, '');
  }

  async function accountSignInResult(result) {
    window.sessionStorage.setItem(accountTokenKey, result.accessToken);
    emailForm.reset();
    setEmailMode('options');
    await loadAccountSession();
  }

  function showAccountSession(account) {
    accountSignedOut.hidden = true;
    accountSignedIn.hidden = false;
    document.getElementById('accountDisplayName').textContent = account.displayName || 'Welcome to Valor Africa';
    document.getElementById('accountEmailAddress').textContent = account.email;
  }

  async function loadAccountSession() {
    const result = await window.valorEventsApi('/api/auth/account', { headers: accountAuthHeaders() });
    showAccountSession(result.account);
    await loadWallet();
  }

  async function handleGoogleCredential(idToken) {
    setFeedback(document.getElementById('googleFeedback'), 'Verifying your Google account…');
    try {
      const result = await window.valorEventsApi('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ idToken })
      });
      window.sessionStorage.setItem(accountTokenKey, result.accessToken);
      await loadAccountSession();
      setFeedback(document.getElementById('googleFeedback'), '');
    } catch (error) {
      setFeedback(document.getElementById('googleFeedback'), error.message, true);
    }
  }

  async function initializeAccountAuth() {
    const accountToken = window.sessionStorage.getItem(accountTokenKey);
    if (accountToken) {
      try {
        await loadAccountSession();
      } catch (error) {
        window.sessionStorage.removeItem(accountTokenKey);
        accountSignedIn.hidden = true;
        accountSignedOut.hidden = false;
        setFeedback(emailFeedback, error.message, true);
      }
    }
    const googleContainer = document.getElementById('googleSignInButton');
    const loadingMessage = document.createElement('p');
    loadingMessage.className = 'google-unavailable';
    loadingMessage.textContent = 'Loading sign-in options…';
    googleContainer.replaceChildren(loadingMessage);
    let config;
    try {
      config = await window.valorEventsApi('/api/auth/config');
    } catch (error) {
      const unavailable = document.createElement('p');
      unavailable.className = 'google-unavailable';
      unavailable.textContent = 'Connect to the Valor Africa service to load Google sign-in.';
      googleContainer.replaceChildren(unavailable);
      throw error;
    }
    if (!config.emailAuthConfigured) {
      document.getElementById('showEmailLogin').disabled = true;
      document.getElementById('showEmailRegister').disabled = true;
      setFeedback(emailFeedback, 'Email sign-in will be available after Resend is configured.');
    }
    if (!config.googleClientId) {
      const unavailable = document.createElement('p');
      unavailable.className = 'google-unavailable';
      unavailable.textContent = 'Google sign-in will be available after OAuth is configured.';
      document.getElementById('googleSignInButton').replaceChildren(unavailable);
      return;
    }
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Google sign-in could not load. Check your connection and try again.'));
      document.head.appendChild(script);
    });
    window.google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: (response) => handleGoogleCredential(response.credential),
      auto_select: false
    });
    window.google.accounts.id.renderButton(document.getElementById('googleSignInButton'), {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      shape: 'rectangular',
      text: 'continue_with',
      width: Math.min(360, Math.max(200, googleContainer.clientWidth))
    });
  }

  document.getElementById('showEmailLogin').addEventListener('click', () => setEmailMode('login'));
  document.getElementById('showEmailRegister').addEventListener('click', () => setEmailMode('register'));
  document.getElementById('accountBackToOptions').addEventListener('click', () => setEmailMode('options'));
  document.getElementById('accountForgotPassword').addEventListener('click', () => setEmailMode('forgot'));
  document.getElementById('accountResendCode').addEventListener('click', async () => {
    try {
      const result = await window.valorEventsApi('/api/auth/email/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ email: emailForm.elements.email.value })
      });
      setFeedback(emailFeedback, result.message);
    } catch (error) {
      setFeedback(emailFeedback, error.message, true);
    }
  });

  emailForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('accountEmailSubmit');
    const values = Object.fromEntries(new FormData(emailForm));
    const endpoints = {
      login: '/api/auth/email/login',
      register: '/api/auth/email/register',
      verify: '/api/auth/email/verify',
      forgot: '/api/auth/email/forgot-password',
      reset: '/api/auth/email/reset-password'
    };
    const body = { email: values.email };
    if (emailMode === 'login' || emailMode === 'register') body.password = values.password;
    if (emailMode === 'register') body.displayName = values.displayName;
    if (emailMode === 'verify' || emailMode === 'reset') body.code = values.code;
    if (emailMode === 'reset') body.password = values.password;
    button.disabled = true;
    setFeedback(emailFeedback, 'Please wait…');
    try {
      const result = await window.valorEventsApi(endpoints[emailMode], {
        method: 'POST',
        body: JSON.stringify(body)
      });
      if (emailMode === 'login' || emailMode === 'verify') {
        await accountSignInResult(result);
      } else if (emailMode === 'register') {
        setEmailMode('verify');
        emailForm.elements.password.value = '';
        emailForm.elements.email.value = values.email;
        setFeedback(emailFeedback, result.message);
      } else if (emailMode === 'forgot') {
        setEmailMode('reset');
        emailForm.elements.email.value = values.email;
        setFeedback(emailFeedback, result.message);
      } else {
        setEmailMode('login');
        emailForm.elements.email.value = values.email;
        setFeedback(emailFeedback, result.message);
      }
    } catch (error) {
      setFeedback(emailFeedback, error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('accountSignOut').addEventListener('click', async () => {
    try {
      await window.valorEventsApi('/api/auth/account/logout', {
        method: 'POST',
        headers: accountAuthHeaders()
      });
    } catch (error) {
      setFeedback(emailFeedback, `Could not revoke your session: ${error.message}`, true);
      return;
    }
    window.sessionStorage.removeItem(accountTokenKey);
    accountSignedIn.hidden = true;
    accountSignedOut.hidden = false;
    dashboard.hidden = true;
    phoneForm.hidden = true;
    verifyForm.hidden = true;
    document.getElementById('walletLinkedPhone').hidden = true;
    window.sessionStorage.removeItem(phoneKey);
  });

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

  phoneForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = phoneForm.querySelector('[type=submit]');
    button.disabled = true;
    setFeedback(signInFeedback, 'Sending a phone verification code…');
    try {
      const result = await window.valorEventsApi('/api/account/phone/otp', {
        method: 'POST',
        headers: accountAuthHeaders(),
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
    setFeedback(signInFeedback, 'Linking your verified phone wallet…');
    try {
      await window.valorEventsApi('/api/account/phone/verify', {
        method: 'POST',
        headers: accountAuthHeaders(),
        body: JSON.stringify({
          phone: window.sessionStorage.getItem(phoneKey),
          code: verifyForm.elements.code.value,
          accountType: phoneForm.elements.accountType.value
        })
      });
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
    verifyForm.reset();
    phoneForm.hidden = false;
    verifyForm.hidden = true;
    setFeedback(signInFeedback, '');
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
      window.sessionStorage.removeItem(accountTokenKey);
      setFeedback(signInFeedback, error.message, true);
      accountSignedIn.hidden = true;
      accountSignedOut.hidden = false;
      dashboard.hidden = true;
    }
  }

  window.sessionStorage.removeItem('valor-wallet-token');
  initializeAccountAuth().catch((error) => {
    setFeedback(emailFeedback, error.message, true);
  });
})();
