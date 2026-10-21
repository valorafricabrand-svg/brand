(function () {
  'use strict';

  const accountTokenKey = 'valor-account-token';
  const accountReturnToKey = 'valor-account-return-to';
  const accountPagePath = new URL('account.html', window.location.href).pathname;
  const pendingPhoneKey = 'valor-wallet-link-phone';
  const accountSignedOut = document.getElementById('accountSignedOut');
  const accountSignedIn = document.getElementById('accountSignedIn');
  const emailForm = document.getElementById('accountEmailForm');
  const emailFeedback = document.getElementById('accountEmailFeedback');
  const signOutFeedback = document.getElementById('accountEmailFeedbackSignedIn');
  const emailLoginButton = document.getElementById('showEmailLogin');
  const emailRegisterButton = document.getElementById('showEmailRegister');
  let emailMode = 'options';
  let accountConfigLoaded = false;
  let emailAuthAvailable = false;

  function setFeedback(element, message, isError = false) {
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('error', isError);
  }

  function accountAuthHeaders() {
    return { Authorization: `Bearer ${window.sessionStorage.getItem(accountTokenKey) || ''}` };
  }

  function notifySession(account) {
    if (!account) {
      window.sessionStorage.removeItem(pendingPhoneKey);
      window.sessionStorage.removeItem('valor-wallet-token');
    }
    document.dispatchEvent(new CustomEvent('valor:account-session', { detail: { account } }));
  }

  function redirectAfterSignIn() {
    const returnTo = new URLSearchParams(window.location.search).get('returnTo');
    const rememberedPath = window.sessionStorage.getItem(accountReturnToKey);
    const destination = [returnTo, rememberedPath].find((value) => {
      if (!value || !value.startsWith('/') || value.startsWith('//')) return false;
      try {
        const target = new URL(value, window.location.origin);
        return target.origin === window.location.origin && target.pathname !== accountPagePath;
      } catch (error) {
        return false;
      }
    });
    if (destination) window.location.assign(new URL(destination, window.location.origin).href);
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
    passwordInput.minLength = mode === 'login' ? 1 : 8;
    passwordInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    passwordField.firstChild.textContent = mode === 'reset' ? 'New password' : 'Password';
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

  async function loadAccountSession() {
    const result = await window.valorEventsApi('/api/auth/account', { headers: accountAuthHeaders() });
    accountSignedOut.hidden = true;
    accountSignedIn.hidden = false;
    document.getElementById('accountDisplayName').textContent = result.account.displayName || 'Welcome to Valor Africa';
    document.getElementById('accountEmailAddress').textContent = result.account.email;
    setFeedback(signOutFeedback, '');
    notifySession(result.account);
  }

  async function accountSignInResult(result) {
    window.sessionStorage.setItem(accountTokenKey, result.accessToken);
    emailForm.reset();
    setEmailMode('options');
    await loadAccountSession();
    redirectAfterSignIn();
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
      redirectAfterSignIn();
    } catch (error) {
      setFeedback(document.getElementById('googleFeedback'), error.message, true);
    }
  }

  async function initializeGoogleSignIn() {
    const googleContainer = document.getElementById('googleSignInButton');
    const loadingMessage = document.createElement('p');
    loadingMessage.className = 'google-unavailable';
    loadingMessage.textContent = 'Loading sign-in options…';
    googleContainer.replaceChildren(loadingMessage);
    const config = await window.valorEventsApi('/api/auth/config');
    accountConfigLoaded = true;
    emailAuthAvailable = Boolean(config.emailAuthConfigured);
    emailLoginButton.disabled = !emailAuthAvailable;
    emailRegisterButton.disabled = !emailAuthAvailable;
    if (!emailAuthAvailable) {
      setFeedback(emailFeedback, 'Email sign-in will be available after Resend is configured.');
    } else {
      setFeedback(emailFeedback, '');
    }
    if (!config.googleClientId) {
      const unavailable = document.createElement('p');
      unavailable.className = 'google-unavailable';
      unavailable.textContent = 'Google sign-in will be available after OAuth is configured.';
      googleContainer.replaceChildren(unavailable);
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
    window.google.accounts.id.renderButton(googleContainer, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      shape: 'rectangular',
      text: 'continue_with',
      width: Math.min(360, Math.max(200, googleContainer.clientWidth))
    });
  }

  function showAccountServiceUnavailable(error) {
    if (!accountConfigLoaded) {
      emailLoginButton.disabled = true;
      emailRegisterButton.disabled = true;
    }
    const message = error.message === 'The Valor Africa event service is not configured for this website yet.'
      ? 'The account service is not connected to this website yet. Sign-in, wallet deposits, and purchases will work after the backend is deployed and connected.'
      : `Could not load sign-in options. ${error.message}`;
    const unavailable = document.createElement('p');
    unavailable.className = 'google-unavailable';
    unavailable.textContent = message;
    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.className = 'button secondary';
    retryButton.textContent = 'Retry connection';
    retryButton.addEventListener('click', () => {
      retryButton.disabled = true;
      initializeGoogleSignIn().catch(showAccountServiceUnavailable);
    });
    document.getElementById('googleSignInButton').replaceChildren(unavailable, retryButton);
    setFeedback(emailFeedback, message, true);
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
    let revokeError = null;
    try {
      await window.valorEventsApi('/api/auth/account/logout', {
        method: 'POST',
        headers: accountAuthHeaders()
      });
    } catch (error) {
      revokeError = error;
    }
    window.sessionStorage.removeItem(accountTokenKey);
    accountSignedIn.hidden = true;
    accountSignedOut.hidden = false;
    setFeedback(emailFeedback, '');
    notifySession(null);
    setFeedback(
      signOutFeedback || emailFeedback,
      revokeError
        ? `Signed out on this device; server session could not be revoked: ${revokeError.message}`
        : 'You are signed out.',
      Boolean(revokeError)
    );
  });

  document.addEventListener('valor:account-session', (event) => {
    if (event.detail && event.detail.account) return;
    if (accountSignedIn) accountSignedIn.hidden = true;
    if (accountSignedOut) accountSignedOut.hidden = false;
  });

  async function initializeAccount() {
    const accountToken = window.sessionStorage.getItem(accountTokenKey);
    if (accountToken) {
      try {
        await loadAccountSession();
      } catch (error) {
        window.sessionStorage.removeItem(accountTokenKey);
        accountSignedIn.hidden = true;
        accountSignedOut.hidden = false;
        setFeedback(emailFeedback, error.message, true);
        notifySession(null);
      }
    } else {
      notifySession(null);
    }
    try {
      await initializeGoogleSignIn();
    } catch (error) {
      showAccountServiceUnavailable(error);
    }
  }

  initializeAccount();
})();
