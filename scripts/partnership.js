(function () {
  'use strict';
  const token = window.sessionStorage.getItem('valor-account-token');
  const signedOut = document.getElementById('partnerSignedOut');
  const applicationForm = document.getElementById('partnerApplicationForm');
  const dashboard = document.getElementById('partnerDashboard');
  const feedback = document.getElementById('partnerFeedback');
  const tokenHeaders = {};
  if (token) tokenHeaders.Authorization = 'Bearer ' + token;

  function setFeedback(message, error = false) {
    feedback.textContent = message;
    feedback.classList.toggle('error', error);
  }

  function money(amount) {
    return `KES ${Number(amount || 0).toLocaleString('en-KE')}`;
  }

  function fillForm(form, partner) {
    form.elements.socialPlatform.value = partner.socialPlatform;
    form.elements.profileUrl.value = partner.profileUrl;
    form.elements.audienceDescription.value = partner.audienceDescription;
  }

  function renderPayouts(payouts) {
    const list = document.getElementById('partnerPayoutHistory');
    if (!payouts.length) {
      list.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'No payouts have been recorded yet.' }));
      return;
    }
    list.replaceChildren(...payouts.map((payout) => {
      const item = document.createElement('p');
      item.textContent = `${money(payout.amountKes)} · ${payout.reference} · ${new Date(payout.createdAt).toLocaleDateString()}`;
      return item;
    }));
  }

  function renderPartner(partner) {
    applicationForm.hidden = true;
    dashboard.hidden = false;
    const heading = document.getElementById('partnerStatusHeading');
    const description = document.getElementById('partnerStatusDescription');
    const note = document.getElementById('partnerAdminNote');
    const approvedDetails = document.getElementById('partnerApprovedDetails');
    const editButton = document.getElementById('editPartnerApplication');
    editButton.hidden = partner.status !== 'rejected';
    document.getElementById('partnerUpdateForm').hidden = true;
    note.hidden = !partner.adminNote;
    note.textContent = partner.adminNote ? `Review note: ${partner.adminNote}` : '';
    approvedDetails.hidden = partner.status !== 'approved';

    if (partner.status === 'approved') {
      heading.textContent = 'Your creator partner account is active';
      description.textContent = 'Share your unique link. Verified ticket purchases made within 30 days of the last referral click are tracked here.';
      document.getElementById('partnerReferralUrl').value = partner.referralUrl;
      document.getElementById('sharePartnerWhatsapp').href =
        `https://wa.me/?text=${encodeURIComponent(`Discover events on Valor Africa: ${partner.referralUrl}`)}`;
      document.getElementById('partnerClicks').textContent = Number(partner.clicks).toLocaleString('en-KE');
      document.getElementById('partnerConversions').textContent = Number(partner.conversions).toLocaleString('en-KE');
      document.getElementById('partnerRate').textContent = `${Number(partner.commissionPercent)}%`;
      document.getElementById('partnerEarned').textContent = money(partner.earnedKes);
      document.getElementById('partnerPaid').textContent = money(partner.paidKes);
      document.getElementById('partnerDue').textContent = money(partner.dueKes);
      renderPayouts(partner.payouts);
    } else {
      heading.textContent = partner.status === 'pending'
        ? 'Your application is awaiting review'
        : partner.status === 'suspended' ? 'Your creator partner account is paused' : 'Your application needs an update';
      description.textContent = partner.status === 'pending'
        ? 'We will review your profile and contact you before activating a referral link or agreeing a commission rate.'
        : partner.status === 'suspended'
          ? 'Your referral link is paused. Contact Valor Africa if you have questions about your account.'
          : 'Review the note below, update your application, and resubmit it for review.';
    }
    if (partner.status === 'rejected') fillForm(document.getElementById('partnerUpdateForm'), partner);
  }

  async function loadPartner() {
    try {
      const result = await window.valorEventsApi('/api/partners/me', { headers: tokenHeaders });
      signedOut.hidden = true;
      if (result.partner) renderPartner(result.partner);
      else {
        dashboard.hidden = true;
        applicationForm.hidden = false;
      }
    } catch (error) {
      if (/sign in to your valor africa account|session has expired/i.test(error.message)) {
        signedOut.hidden = false;
        applicationForm.hidden = true;
        dashboard.hidden = true;
        return;
      }
      setFeedback(error.message, true);
    }
  }

  async function submitApplication(form) {
    const button = form.querySelector('[type="submit"]');
    const values = Object.fromEntries(new FormData(form));
    button.disabled = true;
    try {
      const result = await window.valorEventsApi('/api/partners/apply', {
        method: 'POST',
        headers: tokenHeaders,
        body: JSON.stringify(values)
      });
      setFeedback(result.message);
      await loadPartner();
    } catch (error) {
      setFeedback(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  applicationForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitApplication(applicationForm);
  });
  document.getElementById('partnerUpdateForm').addEventListener('submit', (event) => {
    event.preventDefault();
    submitApplication(event.currentTarget);
  });
  document.getElementById('editPartnerApplication').addEventListener('click', () => {
    document.getElementById('partnerUpdateForm').hidden = false;
  });
  document.getElementById('copyPartnerLink').addEventListener('click', async () => {
    const input = document.getElementById('partnerReferralUrl');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(input.value);
      } else {
        input.select();
        if (!document.execCommand('copy')) throw new Error('Clipboard access is unavailable in this browser.');
      }
      setFeedback('Your referral link has been copied.');
    } catch (error) {
      setFeedback(error.message, true);
    }
  });

  if (token) loadPartner();
  else signedOut.hidden = false;
})();
