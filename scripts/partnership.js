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

  const businessSignedOut = document.getElementById('businessPartnerSignedOut');
  const businessApplications = [
    { type: 'organizer', form: document.getElementById('organizerPartnerApplication') },
    { type: 'sponsor', form: document.getElementById('sponsorPartnerApplication') }
  ];

  function renderBusinessApplication(entry, application) {
    const status = document.getElementById(`${entry.type}ApplicationStatus`);
    const feedbackElement = document.getElementById(`${entry.type}ApplicationFeedback`);
    if (!application) {
      status.hidden = true;
      entry.form.hidden = false;
      return;
    }
    status.hidden = false;
    status.replaceChildren();
    const heading = document.createElement('strong');
    const copy = document.createElement('p');
    const note = document.createElement('p');
    heading.textContent = `Application status: ${application.status}`;
    copy.textContent = application.status === 'pending'
      ? 'Your inquiry is in the review queue. We will follow up using your Valor Africa account email.'
      : application.status === 'contacted'
        ? 'Our team has started follow-up. Check the review note below or your account email.'
        : application.status === 'approved'
          ? 'Your partnership inquiry is approved for follow-up. Confirm any fees, deliverables, budget, and agreement directly with Valor Africa before proceeding.'
          : application.status === 'rejected'
            ? 'Your inquiry needs an update. Review the note and edit your details below before resubmitting.'
            : 'This inquiry is closed. Contact Valor Africa if you would like to start a new conversation.';
    note.textContent = application.adminNote ? `Review note: ${application.adminNote}` : '';
    status.append(heading, copy);
    if (application.adminNote) status.appendChild(note);
    feedbackElement.textContent = '';
    entry.form.hidden = application.status !== 'rejected';
    if (application.status === 'rejected') {
      entry.form.elements.organizationName.value = application.organizationName;
      entry.form.elements.websiteUrl.value = application.websiteUrl;
      entry.form.elements.applicationDetails.value = application.applicationDetails;
      entry.form.elements.requestedSupport.value = application.requestedSupport;
      entry.form.querySelector('[type="submit"]').textContent = 'Update and resubmit inquiry';
    } else {
      entry.form.querySelector('[type="submit"]').textContent =
        entry.type === 'organizer' ? 'Submit organizer inquiry' : 'Submit sponsor inquiry';
    }
  }

  async function loadBusinessApplications() {
    if (!token) {
      businessSignedOut.hidden = false;
      businessApplications.forEach((entry) => {
        entry.form.hidden = true;
        document.getElementById(`${entry.type}ApplicationStatus`).hidden = true;
      });
      return;
    }
    try {
      const result = await window.valorEventsApi('/api/partnership-applications/me', { headers: tokenHeaders });
      businessSignedOut.hidden = true;
      businessApplications.forEach((entry) => {
        const application = result.applications.find((item) => item.type === entry.type) || null;
        renderBusinessApplication(entry, application);
      });
    } catch (error) {
      if (/sign in to your valor africa account|session has expired/i.test(error.message)) {
        businessSignedOut.hidden = false;
        return;
      }
      businessApplications.forEach((entry) => {
        document.getElementById(`${entry.type}ApplicationFeedback`).textContent = error.message;
        document.getElementById(`${entry.type}ApplicationFeedback`).classList.add('error');
      });
    }
  }

  businessApplications.forEach((entry) => {
    entry.form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = entry.form.querySelector('[type="submit"]');
      const feedbackElement = document.getElementById(`${entry.type}ApplicationFeedback`);
      const values = Object.fromEntries(new FormData(entry.form));
      button.disabled = true;
      try {
        const result = await window.valorEventsApi('/api/partnership-applications', {
          method: 'POST',
          headers: tokenHeaders,
          body: JSON.stringify({ ...values, type: entry.type })
        });
        feedbackElement.textContent = result.message;
        feedbackElement.classList.remove('error');
        await loadBusinessApplications();
      } catch (error) {
        feedbackElement.textContent = error.message;
        feedbackElement.classList.add('error');
      } finally {
        button.disabled = false;
      }
    });
  });

  if (token) loadPartner();
  else signedOut.hidden = false;
  loadBusinessApplications();
})();
