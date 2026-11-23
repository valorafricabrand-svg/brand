const crypto = require('crypto');
const { normalizeKenyanPhone } = require('./kenyan-phone');
const artistBookingEmail = require('./artist-booking-email');
const { emailBrandHeader } = require('./email-brand');

const CREATOR_COMMISSION_PERCENT = 5;
const DEPOSIT_PERCENT = 40;
const VALOR_DEPOSIT_FEE_PERCENT = 8;
const SERVICE_CATEGORIES = new Set(['DJ performance','Live music','MC / host','Dance / performance','Other']);
const SOCIAL_PLATFORMS = new Set(['Instagram','TikTok','YouTube','Facebook','Other']);

function text(value, maximum) {
  return typeof value === 'string' && value.trim().length <= maximum ? value.trim() : null;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function secureUrl(value, field, optional = false) {
  if (typeof value !== 'string' || !value.trim()) return optional ? '' : null;
  const candidate = value.trim();
  if (candidate.length > 2048) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch (error) {
    return null;
  }
}

function slugify(value) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'artist';
}

function referralCode(db) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = crypto.randomBytes(5).toString('hex').toUpperCase();
    if (!db.prepare('SELECT 1 FROM affiliate_partners WHERE referral_code=?').get(code)) return code;
  }
  return null;
}

function profileWithServices(db, profile) {
  if (!profile) return null;
  const services = db.prepare(`
    SELECT id,title,description,category,price_kes AS priceKes,duration_minutes AS durationMinutes,
      cancellation_policy AS cancellationPolicy,active,created_at AS createdAt
    FROM artist_services WHERE profile_id=? AND active=1 ORDER BY created_at DESC
  `).all(profile.id);
  return { ...profile, services };
}

function registerArtistMarketplaceRoutes(app, {
  db,
  requireAccount,
  requireAdmin,
  requirePartnerTermsAcknowledgement,
  paymentGateway,
  bookingEmailGateway = artistBookingEmail,
  publicSiteUrl,
  createSubmissionLimiter,
  paymentsEnabled
}) {
  const profileLimiter = createSubmissionLimiter(20, 'artist profile updates');
  const bookingLimiter = createSubmissionLimiter(8, 'artist booking requests');
  const checkoutLimiter = createSubmissionLimiter(5, 'artist booking payments');

  app.get('/api/artist-bookings/payment-status', (req, res) => {
    res.json({
      enabled: paymentsEnabled,
      notice: paymentsEnabled
        ? 'Organizers pay a 40% M-Pesa deposit. Valor retains 8% of the deposit; the remaining service balance is paid directly to the artist.'
        : 'M-Pesa deposit checkout is temporarily unavailable. Contact Valor Africa for assistance.'
    });
  });

  function getProfile(accountId) {
    return db.prepare(`
      SELECT id,account_id AS accountId,slug,display_name AS displayName,artist_type AS artistType,
        bio,city,genres,profile_image_url AS profileImageUrl,portfolio_url AS portfolioUrl,
        social_platform AS socialPlatform,social_profile_url AS socialProfileUrl,
        availability_note AS availabilityNote,status,created_at AS createdAt,updated_at AS updatedAt
      FROM artist_profiles WHERE account_id=?
    `).get(accountId);
  }

  function bookingById(id) {
    return db.prepare(`
      SELECT b.*,p.account_id AS artist_account_id,p.display_name AS artist_name,
        p.status AS artist_profile_status,s.duration_minutes,s.title AS service_title
      FROM artist_bookings b
      JOIN artist_profiles p ON p.id=b.profile_id
      JOIN artist_services s ON s.id=b.service_id
      WHERE b.id=?
    `).get(id);
  }

  function bookingNotificationContent(notification, booking) {
    const organizerName = booking.organizer_name || 'The organizer';
    const artistName = booking.artist_name || 'The artist';
    const eventName = booking.event_name;
    const messages = {
      request: {
        subject: `New booking request: ${eventName}`,
        heading: 'New booking request',
        message: `${organizerName} requested ${booking.service_title} for this event. Sign in to review and respond.`
      },
      accepted: {
        subject: `Booking accepted: ${eventName}`,
        heading: 'Your booking request was accepted',
        message: `${artistName} accepted your request. Review the booking and any available deposit steps in your bookings.`
      },
      declined: {
        subject: `Booking update: ${eventName}`,
        heading: 'Your booking request was declined',
        message: `${artistName} declined your request. Check your bookings for the latest status.`
      },
      deposit_paid: {
        subject: `Deposit confirmed: ${eventName}`,
        heading: 'Artist booking deposit confirmed',
        message: `The M-Pesa deposit for ${booking.service_title} has been confirmed. Review the booking details and next steps in your dashboard.`
      },
      deposit_failed: {
        subject: `M-Pesa payment not completed: ${eventName}`,
        heading: 'M-Pesa payment was not completed',
        message: 'The booking remains accepted. You can try the deposit again from your bookings; do not retry if your M-Pesa account shows a completed charge.'
      },
      payment_review: {
        subject: `Payment needs review: ${eventName}`,
        heading: 'Payment needs Valor support review',
        message: 'The payment details could not be automatically confirmed. Do not retry payment for this booking; contact Valor Africa support.'
      },
      cancelled: {
        subject: `Booking cancelled: ${eventName}`,
        heading: 'Artist booking cancelled',
        message: 'The other participant cancelled this booking. Review the booking status and cancellation policy in your dashboard.'
      },
      cancellation_review: {
        subject: `Cancellation submitted: ${eventName}`,
        heading: 'Cancellation submitted for review',
        message: 'The other participant submitted a cancellation request. Valor support will review any refund under the accepted cancellation policy.'
      },
      completion_requested: {
        subject: `Confirm service completion: ${eventName}`,
        heading: 'Service completion needs your confirmation',
        message: 'The other participant marked the service complete. Sign in to confirm completion or contact Valor support if you disagree.'
      },
      completed: {
        subject: `Service completed: ${eventName}`,
        heading: 'Both sides confirmed service completion',
        message: 'Both participants confirmed completion. Valor will record the manual artist payout after the transfer.'
      },
      refunded: {
        subject: `Booking refund recorded: ${eventName}`,
        heading: 'Artist booking refund recorded',
        message: 'Valor recorded the manual refund for this booking. Check your dashboard for the refund amount and reference.'
      },
      payout_recorded: {
        subject: `Artist payout recorded: ${eventName}`,
        heading: 'Artist payout recorded',
        message: 'Valor recorded the manual transfer of your artist deposit payout. Check your dashboard for the amount and reference.'
      }
    };
    const content = messages[notification.notification_type];
    if (!content) throw new Error(`Unknown artist booking email notification: ${notification.notification_type}`);
    const recipientName = notification.recipient_name || '';
    const date = new Intl.DateTimeFormat('en-KE', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: 'Africa/Nairobi'
    }).format(new Date(booking.event_date));
    const dashboardUrl = `${publicSiteUrl}/${notification.recipient_account_id === booking.artist_account_id
      ? 'partner-dashboard.html?program=artist'
      : 'artist-bookings.html'}`;
    const greeting = recipientName ? `Hi ${recipientName},` : 'Hi there,';
    const details = [
      `Event: ${eventName}`,
      `Service: ${booking.service_title}`,
      `When: ${date}`,
      `Where: ${booking.event_location}`
    ];
    const detailRows = details.map((item) => {
      const [label, ...value] = item.split(': ');
      return `<tr><td style="padding:8px;color:#596a60">${escapeHtml(label)}</td><td><strong>${escapeHtml(value.join(': '))}</strong></td></tr>`;
    }).join('');
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17221e">
        ${emailBrandHeader()}
        <h1 style="color:#087f5b;font-size:24px">${escapeHtml(content.heading)}</h1>
        <p>${escapeHtml(greeting)} ${escapeHtml(content.message)}</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          ${detailRows}
        </table>
        <p style="margin:24px 0">
          <a href="${escapeHtml(dashboardUrl)}" style="background:#087f5b;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">View booking</a>
        </p>
        <p style="font-size:12px;color:#88938d">This is a service update from Valor Africa. Booking ${escapeHtml(booking.id)}.</p>
      </div>`;
    return {
      to: notification.recipient_email,
      subject: content.subject.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 180),
      html,
      text: [
        content.heading,
        `${greeting} ${content.message}`,
        ...details,
        `View booking: ${dashboardUrl}`,
        `Booking ${booking.id}`
      ].join('\n')
    };
  }

  async function deliverBookingEmail(notificationId) {
    if (!bookingEmailGateway.isConfigured()) return false;
    const claimed = db.transaction(() => {
      const notification = db.prepare(`
        SELECT status,attempts,attempted_at
        FROM artist_booking_email_notifications WHERE id=?
      `).get(notificationId);
      if (!notification || notification.status === 'sent') return false;
      const attemptedAt = notification.attempted_at ? Date.parse(`${notification.attempted_at}Z`) : 0;
      if (notification.status === 'sending' && attemptedAt > Date.now() - 10 * 60 * 1000) return false;
      if (notification.status === 'failed') {
        const delaySeconds = Math.min(3600, 60 * (2 ** Math.min(Math.max(notification.attempts - 1, 0), 6)));
        if (attemptedAt > Date.now() - delaySeconds * 1000) return false;
      }
      db.prepare(`
        UPDATE artist_booking_email_notifications SET status='sending',attempts=attempts+1,
          attempted_at=datetime('now'),last_error=''
        WHERE id=?
      `).run(notificationId);
      return true;
    })();
    if (!claimed) return false;
    try {
      const notification = db.prepare(`
        SELECT n.id,n.notification_type,n.recipient_account_id,
          a.email AS recipient_email,a.display_name AS recipient_name,
          b.id AS booking_id,b.event_name,b.event_date,b.event_location,b.service_price_kes,
          b.deposit_amount_kes,b.valor_fee_kes,b.artist_payout_kes,
          p.account_id AS artist_account_id,p.display_name AS artist_name,
          o.display_name AS organizer_name,s.title AS service_title
        FROM artist_booking_email_notifications n
        JOIN accounts a ON a.id=n.recipient_account_id
        JOIN artist_bookings b ON b.id=n.booking_id
        JOIN artist_profiles p ON p.id=b.profile_id
        JOIN accounts o ON o.id=b.organizer_account_id
        JOIN artist_services s ON s.id=b.service_id
        WHERE n.id=?
      `).get(notificationId);
      if (!notification) throw new Error('Booking notification or recipient was not found.');
      const email = bookingNotificationContent(notification, {
        ...notification,
        id: notification.booking_id,
        event_name: notification.event_name,
        event_date: notification.event_date,
        event_location: notification.event_location,
        service_title: notification.service_title,
        artist_name: notification.artist_name,
        artist_account_id: notification.artist_account_id,
        organizer_name: notification.organizer_name
      });
      await bookingEmailGateway.sendUpdate({
        idempotencyKey: `valor-artist-booking-${notification.id}`,
        ...email
      });
      db.prepare(`
        UPDATE artist_booking_email_notifications SET status='sent',sent_at=datetime('now'),last_error=''
        WHERE id=? AND status='sending'
      `).run(notificationId);
      return true;
    } catch (error) {
      const message = String(error && error.message || 'Unknown artist booking email delivery error').slice(0, 500);
      db.prepare(`
        UPDATE artist_booking_email_notifications SET status='failed',last_error=?
        WHERE id=? AND status='sending'
      `).run(message, notificationId);
      console.error(`Artist booking email failed for notification ${notificationId}: ${message}`);
      return false;
    }
  }

  function scheduleBookingEmail(notificationId) {
    setImmediate(() => {
      deliverBookingEmail(notificationId).catch((error) => {
        console.error(`Could not process artist booking email ${notificationId}:`, error);
      });
    });
  }

  function queueBookingEmails(booking, notificationType, recipientAccountIds) {
    const eventId = crypto.randomUUID();
    const insert = db.prepare(`
      INSERT OR IGNORE INTO artist_booking_email_notifications
        (id,event_id,booking_id,recipient_account_id,notification_type)
      VALUES (?,?,?,?,?)
    `);
    const notificationIds = [];
    for (const accountId of new Set(recipientAccountIds)) {
      const id = crypto.randomUUID();
      const result = insert.run(id, eventId, booking.id, accountId, notificationType);
      if (result.changes) notificationIds.push(id);
    }
    notificationIds.forEach(scheduleBookingEmail);
  }

  async function retryPendingBookingEmails() {
    if (!bookingEmailGateway.isConfigured()) return 0;
    const notifications = db.prepare(`
      SELECT id FROM artist_booking_email_notifications
      WHERE status IN ('pending','failed','sending')
        AND (
          status='pending'
          OR (status='failed' AND datetime(attempted_at) <=
            datetime('now',printf('-%d seconds',MIN(3600,60 * (1 << MIN(MAX(attempts - 1,0),6))))))
          OR (status='sending' AND datetime(attempted_at) <= datetime('now','-10 minutes'))
        )
      ORDER BY created_at ASC LIMIT 100
    `).all();
    let sent = 0;
    for (const notification of notifications) {
      if (await deliverBookingEmail(notification.id)) sent += 1;
    }
    return sent;
  }

  app.get('/api/artists', (req, res) => {
    const search = text(req.query.search, 100) || '';
    const city = text(req.query.city, 100) || '';
    const rows = db.prepare(`
      SELECT p.id,p.slug,p.display_name AS displayName,p.artist_type AS artistType,p.bio,p.city,
        p.genres,p.profile_image_url AS profileImageUrl,p.portfolio_url AS portfolioUrl,
        p.social_platform AS socialPlatform,p.social_profile_url AS socialProfileUrl,
        p.availability_note AS availabilityNote,p.created_at AS createdAt
      FROM artist_profiles p
      WHERE p.status='active'
        AND EXISTS (SELECT 1 FROM artist_services s WHERE s.profile_id=p.id AND s.active=1)
        AND (?='' OR p.city LIKE '%' || ? || '%')
        AND (?='' OR p.display_name LIKE '%' || ? || '%' OR p.bio LIKE '%' || ? || '%'
          OR p.genres LIKE '%' || ? || '%' OR EXISTS (
            SELECT 1 FROM artist_services s WHERE s.profile_id=p.id AND s.active=1
              AND (s.title LIKE '%' || ? || '%' OR s.category LIKE '%' || ? || '%')
          ))
      ORDER BY p.display_name COLLATE NOCASE LIMIT 60
    `).all(city, city, search, search, search, search, search, search);
    res.json({ artists: rows.map((profile) => profileWithServices(db, profile)) });
  });

  app.get('/api/artists/me', requireAccount, (req, res) => {
    const profile = getProfile(req.account.id);
    if (!profile) return res.json({ profile: null, referralUrl: null, bookings: [] });
    const partner = db.prepare(`
      SELECT id,referral_code AS referralCode,commission_percent AS commissionPercent
      FROM affiliate_partners WHERE account_id=? AND status='approved'
    `).get(req.account.id);
    const bookings = db.prepare(`
      SELECT b.id,b.event_name AS eventName,b.event_date AS eventDate,b.event_location AS eventLocation,
        b.message,b.service_price_kes AS servicePriceKes,b.deposit_amount_kes AS depositAmountKes,
        b.valor_fee_kes AS valorFeeKes,b.artist_payout_kes AS artistPayoutKes,
        b.cancellation_policy AS cancellationPolicy,b.policy_accepted_at AS policyAcceptedAt,
        b.status,b.created_at AS createdAt,b.accepted_at AS acceptedAt,b.paid_at AS paidAt,
        b.artist_completed_at AS artistCompletedAt,b.organizer_confirmed_at AS organizerConfirmedAt,
        a.display_name AS organizerName,a.email AS organizerEmail,s.title AS serviceTitle,
        s.duration_minutes AS durationMinutes,
        EXISTS (SELECT 1 FROM artist_booking_payouts ap WHERE ap.booking_id=b.id) AS payoutRecorded,
        EXISTS (SELECT 1 FROM artist_booking_refunds ar WHERE ar.booking_id=b.id) AS refundRecorded
      FROM artist_bookings b
      JOIN accounts a ON a.id=b.organizer_account_id
      JOIN artist_services s ON s.id=b.service_id
      WHERE b.profile_id=? ORDER BY b.created_at DESC LIMIT 100
    `).all(profile.id);
    let referralStats = null;
    if (partner) {
      const earnedKes = db.prepare(`
        SELECT COALESCE(SUM(ROUND(amount_kes * affiliate_commission_percent / 100.0)),0) AS amount
        FROM orders
        WHERE affiliate_partner_id=? AND order_type='ticket' AND status IN ('paid','confirmed')
      `).get(partner.id).amount;
      const paidKes = db.prepare('SELECT COALESCE(SUM(amount_kes),0) AS amount FROM affiliate_payouts WHERE partner_id=?')
        .get(partner.id).amount;
      referralStats = {
        clicks: db.prepare('SELECT COUNT(*) AS count FROM affiliate_referral_visits WHERE partner_id=?')
          .get(partner.id).count,
        conversions: db.prepare(`
          SELECT COUNT(*) AS count FROM orders
          WHERE affiliate_partner_id=? AND order_type='ticket' AND amount_kes>0 AND status IN ('paid','confirmed')
        `).get(partner.id).count,
        earnedKes,
        paidKes,
        dueKes: Math.max(0, earnedKes - paidKes)
      };
    }
    res.json({
      profile: profileWithServices(db, profile),
      referralUrl: partner?.referralCode ? `${publicSiteUrl}/events.html?ref=${partner.referralCode}` : null,
      commissionPercent: partner?.commissionPercent || CREATOR_COMMISSION_PERCENT,
      referralStats,
      bookings
    });
  });

  app.get('/api/artists/admin', requireAdmin, (req, res) => {
    const profiles = db.prepare(`
      SELECT p.id,p.slug,p.display_name AS displayName,p.artist_type AS artistType,p.city,p.status,
        p.social_platform AS socialPlatform,p.social_profile_url AS socialProfileUrl,
        p.created_at AS createdAt,a.email,a.display_name AS accountName,
        (SELECT COUNT(*) FROM artist_services s WHERE s.profile_id=p.id AND s.active=1) AS activeServices
      FROM artist_profiles p JOIN accounts a ON a.id=p.account_id
      ORDER BY p.created_at DESC LIMIT 300
    `).all();
    res.json({ profiles });
  });

  app.get('/api/artists/:slug', (req, res) => {
    const profile = db.prepare(`
      SELECT id,slug,display_name AS displayName,artist_type AS artistType,bio,city,genres,
        profile_image_url AS profileImageUrl,portfolio_url AS portfolioUrl,
        social_platform AS socialPlatform,social_profile_url AS socialProfileUrl,
        availability_note AS availabilityNote,created_at AS createdAt
      FROM artist_profiles WHERE slug=? AND status='active'
    `).get(req.params.slug);
    if (!profile) return res.status(404).json({ error: 'This artist profile is unavailable.' });
    const result = profileWithServices(db, profile);
    if (!result.services.length) return res.status(404).json({ error: 'This artist profile is unavailable.' });
    res.json({ artist: result });
  });

  app.put('/api/artists/me', requireAccount, requirePartnerTermsAcknowledgement, profileLimiter, (req, res) => {
    const body = req.body || {};
    const displayName = text(body.displayName, 100);
    const artistType = body.artistType;
    const bio = text(body.bio, 2000);
    const city = text(body.city, 100);
    const genres = text(body.genres || '', 300);
    const profileImageUrl = secureUrl(body.profileImageUrl || '', 'Profile image', true);
    const portfolioUrl = secureUrl(body.portfolioUrl || '', 'Portfolio', true);
    const socialProfileUrl = secureUrl(body.socialProfileUrl, 'Social profile');
    const socialPlatform = body.socialPlatform;
    const availabilityNote = text(body.availabilityNote || '', 500);
    if (!displayName || displayName.length < 2 || !['artist','dj','both'].includes(artistType)
      || !bio || bio.length < 20 || !city || !genres || profileImageUrl === null
      || portfolioUrl === null || !socialProfileUrl || !SOCIAL_PLATFORMS.has(socialPlatform)
      || availabilityNote === null) {
      return res.status(400).json({ error: 'Complete the required profile fields and use valid HTTPS links.' });
    }

    const existing = getProfile(req.account.id);
    const id = existing?.id || crypto.randomUUID();
    let slug = existing?.slug || slugify(displayName);
    if (!existing && db.prepare('SELECT 1 FROM artist_profiles WHERE slug=?').get(slug)) {
      slug = `${slug}-${crypto.randomBytes(3).toString('hex')}`;
    }
    const audienceDescription = `Artist / DJ event referral partner for ${displayName} in ${city}.`;
    const affiliate = db.prepare(`
      SELECT id,status,referral_code AS referralCode,commission_percent AS commissionPercent
      FROM affiliate_partners WHERE account_id=?
    `).get(req.account.id);
    if (affiliate?.status === 'suspended') {
      return res.status(409).json({ error: 'Your creator account is paused. Contact Valor Africa if you need help.' });
    }
    const code = affiliate?.referralCode || referralCode(db);
    if (!code) return res.status(503).json({ error: 'Could not create your ticket referral link. Please retry.' });

    db.transaction(() => {
      if (existing) {
        db.prepare(`
          UPDATE artist_profiles SET display_name=?,artist_type=?,bio=?,city=?,genres=?,profile_image_url=?,
            portfolio_url=?,social_platform=?,social_profile_url=?,availability_note=?,updated_at=datetime('now')
          WHERE id=?
        `).run(displayName, artistType, bio, city, genres, profileImageUrl, portfolioUrl,
          socialPlatform, socialProfileUrl, availabilityNote, id);
      } else {
        db.prepare(`
          INSERT INTO artist_profiles
            (id,account_id,slug,display_name,artist_type,bio,city,genres,profile_image_url,portfolio_url,
              social_platform,social_profile_url,availability_note)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(id, req.account.id, slug, displayName, artistType, bio, city, genres, profileImageUrl,
          portfolioUrl, socialPlatform, socialProfileUrl, availabilityNote);
      }
      if (affiliate) {
        db.prepare(`
          UPDATE affiliate_partners SET social_platform=?,profile_url=?,audience_description=?,
            status='approved',referral_code=?,commission_percent=?,admin_note='',reviewed_at=NULL WHERE id=?
        `).run(socialPlatform, socialProfileUrl, audienceDescription, code,
          affiliate.status === 'approved' && affiliate.commissionPercent
            ? affiliate.commissionPercent : CREATOR_COMMISSION_PERCENT, affiliate.id);
      } else {
        db.prepare(`
          INSERT INTO affiliate_partners
            (id,account_id,social_platform,profile_url,audience_description,status,referral_code,commission_percent)
          VALUES (?,?,?,?,?,'approved',?,?)
        `).run(crypto.randomUUID(), req.account.id, socialPlatform, socialProfileUrl,
          audienceDescription, code, CREATOR_COMMISSION_PERCENT);
      }
    })();

    res.status(existing ? 200 : 201).json({
      profile: profileWithServices(db, getProfile(req.account.id)),
      referralUrl: `${publicSiteUrl}/events.html?ref=${code}`,
      commissionPercent: affiliate?.status === 'approved' && affiliate.commissionPercent
        ? affiliate.commissionPercent : CREATOR_COMMISSION_PERCENT
    });
  });

  app.post('/api/artists/services', requireAccount, requirePartnerTermsAcknowledgement, profileLimiter, (req, res) => {
    const profile = getProfile(req.account.id);
    if (!profile) return res.status(409).json({ error: 'Create your artist profile before adding a service.' });
    if (profile.status !== 'active') return res.status(409).json({ error: 'Your public profile is paused. Contact Valor Africa before adding services.' });
    const body = req.body || {};
    const title = text(body.title, 120);
    const description = text(body.description, 2000);
    const category = body.category;
    const priceKes = Number(body.priceKes);
    const durationMinutes = Number(body.durationMinutes);
    const cancellationPolicy = text(body.cancellationPolicy, 1500);
    if (!title || title.length < 3 || !description || description.length < 20
      || !SERVICE_CATEGORIES.has(category) || !Number.isSafeInteger(priceKes) || priceKes < 1
      || !Number.isSafeInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 1440
      || !cancellationPolicy || cancellationPolicy.length < 20) {
      return res.status(400).json({ error: 'Enter a clear service description, valid price and duration, and cancellation policy.' });
    }
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO artist_services
        (id,profile_id,title,description,category,price_kes,duration_minutes,cancellation_policy)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(id, profile.id, title, description, category, priceKes, durationMinutes, cancellationPolicy);
    const service = db.prepare(`
      SELECT id,title,description,category,price_kes AS priceKes,duration_minutes AS durationMinutes,
        cancellation_policy AS cancellationPolicy,active,created_at AS createdAt
      FROM artist_services WHERE id=?
    `).get(id);
    res.status(201).json({ service });
  });

  app.patch('/api/artists/services/:id', requireAccount, requirePartnerTermsAcknowledgement, profileLimiter, (req, res) => {
    const profile = getProfile(req.account.id);
    if (!profile) return res.status(404).json({ error: 'Service not found.' });
    if (profile.status !== 'active') return res.status(409).json({ error: 'Your public profile is paused. Contact Valor Africa before changing services.' });
    const service = db.prepare('SELECT * FROM artist_services WHERE id=? AND profile_id=?')
      .get(req.params.id, profile.id);
    if (!service) return res.status(404).json({ error: 'Service not found.' });
    const body = req.body || {};
    if (body.active === false) {
      db.prepare("UPDATE artist_services SET active=0,updated_at=datetime('now') WHERE id=?").run(service.id);
      return res.json({ deactivated: true });
    }
    const title = text(body.title, 120);
    const description = text(body.description, 2000);
    const category = body.category;
    const priceKes = Number(body.priceKes);
    const durationMinutes = Number(body.durationMinutes);
    const cancellationPolicy = text(body.cancellationPolicy, 1500);
    if (!title || title.length < 3 || !description || description.length < 20
      || !SERVICE_CATEGORIES.has(category) || !Number.isSafeInteger(priceKes) || priceKes < 1
      || !Number.isSafeInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 1440
      || !cancellationPolicy || cancellationPolicy.length < 20) {
      return res.status(400).json({ error: 'Enter a clear service description, valid price and duration, and cancellation policy.' });
    }
    db.prepare(`
      UPDATE artist_services SET title=?,description=?,category=?,price_kes=?,duration_minutes=?,
        cancellation_policy=?,active=1,updated_at=datetime('now') WHERE id=?
    `).run(title, description, category, priceKes, durationMinutes, cancellationPolicy, service.id);
    res.json({ service: db.prepare(`
      SELECT id,title,description,category,price_kes AS priceKes,duration_minutes AS durationMinutes,
        cancellation_policy AS cancellationPolicy,active,created_at AS createdAt
      FROM artist_services WHERE id=?
    `).get(service.id) });
  });

  app.post('/api/artist-bookings', requireAccount, bookingLimiter, (req, res) => {
    const body = req.body || {};
    const serviceId = text(body.serviceId, 100);
    const clientRequestId = text(body.clientRequestId, 100);
    const eventName = text(body.eventName, 120);
    const eventLocation = text(body.eventLocation, 200);
    const message = text(body.message, 2000);
    const eventTime = typeof body.eventDate === 'string' ? Date.parse(body.eventDate) : NaN;
    if (!serviceId || !clientRequestId || !/^[0-9a-f-]{36}$/i.test(clientRequestId)
      || !eventName || eventName.length < 2 || !eventLocation || !message || message.length < 20
      || !Number.isFinite(eventTime) || eventTime <= Date.now()) {
      return res.status(400).json({ error: 'Add the event details, a future event date, and a short booking message.' });
    }
    const duplicate = db.prepare(`
      SELECT id,status FROM artist_bookings WHERE organizer_account_id=? AND client_request_id=?
    `).get(req.account.id, clientRequestId);
    if (duplicate) return res.status(200).json({ booking: duplicate, duplicate: true });
    const service = db.prepare(`
      SELECT s.*,p.id AS profile_id,p.status AS profile_status
      FROM artist_services s JOIN artist_profiles p ON p.id=s.profile_id
      WHERE s.id=? AND s.active=1 AND p.status='active'
    `).get(serviceId);
    if (!service || !service.profile_id) return res.status(404).json({ error: 'This service is not available for booking.' });
    const depositAmount = Math.ceil(service.price_kes * DEPOSIT_PERCENT / 100);
    const valorFee = Math.round(depositAmount * VALOR_DEPOSIT_FEE_PERCENT / 100);
    const bookingId = crypto.randomUUID();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO artist_bookings
          (id,service_id,profile_id,organizer_account_id,client_request_id,event_name,event_date,
            event_location,message,service_price_kes,deposit_amount_kes,valor_fee_kes,artist_payout_kes,
            cancellation_policy)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(bookingId, service.id, service.profile_id, req.account.id, clientRequestId, eventName,
        new Date(eventTime).toISOString(), eventLocation, message, service.price_kes,
        depositAmount, valorFee, depositAmount - valorFee, service.cancellation_policy);
      const booking = bookingById(bookingId);
      queueBookingEmails(booking, 'request', [booking.artist_account_id]);
    })();
    res.status(201).json({
      booking: { id: bookingId, status: 'requested', servicePriceKes: service.price_kes, depositAmountKes: depositAmount }
    });
  });

  app.post('/api/artist-bookings/:id/respond', requireAccount, bookingLimiter, (req, res) => {
    const booking = bookingById(req.params.id);
    if (!booking || booking.artist_account_id !== req.account.id) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.status !== 'requested') return res.status(409).json({ error: 'This booking request has already been answered.' });
    if (booking.artist_profile_status !== 'active') return res.status(409).json({ error: 'Your public profile is paused. Contact Valor Africa before accepting booking requests.' });
    if (!['accept','decline'].includes(req.body?.decision)) return res.status(400).json({ error: 'Choose accept or decline.' });
    if (req.body.decision === 'decline') {
      db.transaction(() => {
        db.prepare("UPDATE artist_bookings SET status='declined' WHERE id=? AND status='requested'").run(booking.id);
        queueBookingEmails(booking, 'declined', [booking.organizer_account_id]);
      })();
      return res.json({ status: 'declined' });
    }
    const dateStart = Date.parse(booking.event_date);
    if (dateStart <= Date.now()) return res.status(409).json({ error: 'This event date has passed. Decline the request and ask the organizer to send a new one.' });
    const dateEnd = dateStart + booking.duration_minutes * 60000;
    const existing = db.prepare(`
      SELECT event_date,s.duration_minutes AS durationMinutes
      FROM artist_bookings b JOIN artist_services s ON s.id=b.service_id
      WHERE b.profile_id=? AND b.id<>? AND b.status IN ('accepted','deposit_pending','deposit_paid','service_completed')
    `).all(booking.profile_id, booking.id);
    const conflict = existing.some((item) => {
      const start = Date.parse(item.event_date);
      const end = start + item.durationMinutes * 60000;
      return dateStart < end && start < dateEnd;
    });
    if (conflict) return res.status(409).json({ error: 'You already have an accepted booking during this time.' });
    db.transaction(() => {
      db.prepare(`
        UPDATE artist_bookings SET status='accepted',accepted_at=datetime('now')
        WHERE id=? AND status='requested'
      `).run(booking.id);
      queueBookingEmails(booking, 'accepted', [booking.organizer_account_id]);
    })();
    res.json({ status: 'accepted' });
  });

  app.post('/api/artist-bookings/:id/deposit', requireAccount, checkoutLimiter, async (req, res) => {
    if (!paymentsEnabled) {
      return res.status(503).json({
        error: 'M-Pesa deposit checkout is temporarily unavailable. Contact Valor Africa for assistance.'
      });
    }
    const booking = bookingById(req.params.id);
    if (!booking || booking.organizer_account_id !== req.account.id) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.artist_profile_status !== 'active') return res.status(409).json({ error: 'This artist profile is unavailable for payment. Contact Valor Africa for help.' });
    if (booking.status !== 'accepted') return res.status(409).json({ error: 'The artist must accept this request before deposit payment.' });
    if (req.body?.acceptedCancellationPolicy !== true) {
      return res.status(400).json({ error: 'Review and accept the artist cancellation policy before paying.' });
    }
    const phone = normalizeKenyanPhone(req.body?.phone);
    if (!phone) return res.status(400).json({ error: 'Enter a valid Kenyan M-Pesa phone number.' });
    const paidAt = new Date().toISOString();
    db.prepare(`
      UPDATE artist_bookings SET status='deposit_pending',policy_accepted_at=?,payment_method='mpesa',phone=?
      WHERE id=? AND status='accepted'
    `).run(paidAt, phone, booking.id);
    try {
      const checkout = await paymentGateway.initiateStkPush({
        id: booking.id,
        amountKes: booking.deposit_amount_kes,
        phone
      });
      if (!checkout || typeof checkout.checkoutRequestId !== 'string' || !checkout.checkoutRequestId) {
        throw new Error('Payment provider did not return a checkout request.');
      }
      db.prepare(`
        UPDATE artist_bookings SET checkout_request_id=?,merchant_request_id=?
        WHERE id=? AND status='deposit_pending'
      `).run(checkout.checkoutRequestId, checkout.merchantRequestId || '', booking.id);
      res.json({
        status: 'deposit_pending',
        amountKes: booking.deposit_amount_kes,
        currency: 'KES',
        customerMessage: checkout.customerMessage || 'Check your phone and enter your M-Pesa PIN.'
      });
    } catch (error) {
      db.prepare(`
        UPDATE artist_bookings SET status='accepted',checkout_request_id=NULL,merchant_request_id=NULL
        WHERE id=? AND status='deposit_pending'
      `).run(booking.id);
      console.error(`Could not initiate M-Pesa deposit for artist booking ${booking.id}:`, error.message);
      return res.status(502).json({ error: 'We could not start the M-Pesa payment. Please retry or contact support.' });
    }
  });

  app.post('/api/artist-bookings/:id/complete', requireAccount, (req, res) => {
    const booking = bookingById(req.params.id);
    if (!booking || ![booking.artist_account_id, booking.organizer_account_id].includes(req.account.id)) {
      return res.status(404).json({ error: 'Booking not found.' });
    }
    if (!['deposit_paid','service_completed'].includes(booking.status)) {
      return res.status(409).json({ error: 'Only a deposit-paid booking can be marked complete.' });
    }
    const scheduledEnd = Date.parse(booking.event_date) + booking.duration_minutes * 60000;
    if (Date.now() < scheduledEnd) {
      return res.status(409).json({ error: 'Service completion can be confirmed after the scheduled event time.' });
    }
    const isArtist = booking.artist_account_id === req.account.id;
    const updateField = isArtist ? 'artist_completed_at' : 'organizer_confirmed_at';
    const otherField = isArtist ? booking.organizer_confirmed_at : booking.artist_completed_at;
    if (booking[updateField]) return res.json({ status: booking.status });
    const status = otherField ? 'completed' : (isArtist ? 'service_completed' : 'deposit_paid');
    db.transaction(() => {
      db.prepare(`UPDATE artist_bookings SET ${updateField}=?,status=? WHERE id=?`)
        .run(new Date().toISOString(), status, booking.id);
      if (status === 'completed') {
        queueBookingEmails(booking, 'completed', [booking.artist_account_id, booking.organizer_account_id]);
      } else {
        const otherAccountId = isArtist ? booking.organizer_account_id : booking.artist_account_id;
        queueBookingEmails(booking, 'completion_requested', [otherAccountId]);
      }
    })();
    res.json({ status });
  });

  app.post('/api/artist-bookings/:id/cancel', requireAccount, (req, res) => {
    const booking = bookingById(req.params.id);
    if (!booking || ![booking.artist_account_id, booking.organizer_account_id].includes(req.account.id)) {
      return res.status(404).json({ error: 'Booking not found.' });
    }
    if (!['requested','accepted','deposit_paid','service_completed'].includes(booking.status)) {
      return res.status(409).json({ error: 'This booking can no longer be cancelled.' });
    }
    const status = ['deposit_paid','service_completed'].includes(booking.status) ? 'cancellation_review' : 'cancelled';
    db.transaction(() => {
      db.prepare(`
        UPDATE artist_bookings SET status=?,cancelled_at=datetime('now')
        WHERE id=? AND status=?
      `).run(status, booking.id, booking.status);
      const otherAccountId = req.account.id === booking.artist_account_id
        ? booking.organizer_account_id : booking.artist_account_id;
      queueBookingEmails(booking, status, [otherAccountId]);
    })();
    res.json({ status, message: status === 'cancellation_review'
      ? 'Valor support will review this cancellation and any refund under the policy you accepted.'
      : 'The booking was cancelled.' });
  });

  app.get('/api/artist-bookings/me', requireAccount, (req, res) => {
    const bookings = db.prepare(`
      SELECT b.id,b.event_name AS eventName,b.event_date AS eventDate,b.event_location AS eventLocation,
        b.message,b.service_price_kes AS servicePriceKes,b.deposit_amount_kes AS depositAmountKes,
        b.valor_fee_kes AS valorFeeKes,b.artist_payout_kes AS artistPayoutKes,
        b.cancellation_policy AS cancellationPolicy,b.policy_accepted_at AS policyAcceptedAt,
        b.status,b.created_at AS createdAt,b.accepted_at AS acceptedAt,b.paid_at AS paidAt,
        b.artist_completed_at AS artistCompletedAt,b.organizer_confirmed_at AS organizerConfirmedAt,
        p.slug AS artistSlug,p.display_name AS artistName,s.title AS serviceTitle,
        s.duration_minutes AS durationMinutes,
        EXISTS (SELECT 1 FROM artist_booking_payouts ap WHERE ap.booking_id=b.id) AS payoutRecorded,
        EXISTS (SELECT 1 FROM artist_booking_refunds ar WHERE ar.booking_id=b.id) AS refundRecorded
      FROM artist_bookings b
      JOIN artist_profiles p ON p.id=b.profile_id
      JOIN artist_services s ON s.id=b.service_id
      WHERE b.organizer_account_id=? ORDER BY b.created_at DESC LIMIT 100
    `).all(req.account.id);
    res.json({ bookings });
  });

  app.patch('/api/artists/admin/:id', requireAdmin, (req, res) => {
    if (!['active','suspended'].includes(req.body?.status)) {
      return res.status(400).json({ error: 'Choose active or suspended.' });
    }
    const result = db.prepare("UPDATE artist_profiles SET status=?,updated_at=datetime('now') WHERE id=?")
      .run(req.body.status, req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Artist profile not found.' });
    res.json({ status: req.body.status });
  });

  app.get('/api/artist-bookings/admin', requireAdmin, (req, res) => {
    const bookings = db.prepare(`
      SELECT b.id,b.event_name AS eventName,b.event_date AS eventDate,b.event_location AS eventLocation,
        b.service_price_kes AS servicePriceKes,b.deposit_amount_kes AS depositAmountKes,
        b.valor_fee_kes AS valorFeeKes,b.artist_payout_kes AS artistPayoutKes,
        b.cancellation_policy AS cancellationPolicy,b.status,b.payment_method AS paymentMethod,
        b.mpesa_receipt AS mpesaReceipt,b.received_amount_kes AS receivedAmountKes,
        b.paid_at AS paidAt,b.created_at AS createdAt,
        p.display_name AS artistName,a.email AS organizerEmail,s.title AS serviceTitle,
        ap.reference AS payoutReference,ap.amount_kes AS paidOutKes,ap.created_at AS payoutAt,
        ar.reference AS refundReference,ar.amount_kes AS refundedKes,ar.created_at AS refundAt
      FROM artist_bookings b JOIN artist_profiles p ON p.id=b.profile_id
      JOIN accounts a ON a.id=b.organizer_account_id JOIN artist_services s ON s.id=b.service_id
      LEFT JOIN artist_booking_payouts ap ON ap.booking_id=b.id
      LEFT JOIN artist_booking_refunds ar ON ar.booking_id=b.id
      ORDER BY b.created_at DESC LIMIT 500
    `).all();
    res.json({ bookings });
  });

  app.post('/api/artist-bookings/admin/:id/payout', requireAdmin, (req, res) => {
    const booking = bookingById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.status !== 'completed') return res.status(409).json({ error: 'Confirm service completion before recording payout.' });
    const existing = db.prepare('SELECT id FROM artist_booking_payouts WHERE booking_id=?').get(booking.id);
    if (existing) return res.status(409).json({ error: 'A payout has already been recorded for this booking.' });
    if (db.prepare('SELECT 1 FROM artist_booking_refunds WHERE booking_id=?').get(booking.id)) {
      return res.status(409).json({ error: 'A refunded booking cannot be paid out.' });
    }
    const reference = text(req.body?.reference, 120);
    const note = text(req.body?.note || '', 500);
    if (!reference || !note || booking.artist_payout_kes < 1) {
      return res.status(400).json({ error: 'Enter the transfer reference and a short payout note.' });
    }
    db.transaction(() => {
      db.prepare(`
        INSERT INTO artist_booking_payouts (id,booking_id,profile_id,amount_kes,reference,note,admin_id)
        VALUES (?,?,?,?,?,?,?)
      `).run(crypto.randomUUID(), booking.id, booking.profile_id, booking.artist_payout_kes,
        reference, note, Number(req.admin.sub));
      queueBookingEmails(booking, 'payout_recorded', [booking.artist_account_id]);
    })();
    res.status(201).json({ amountKes: booking.artist_payout_kes, reference });
  });

  app.post('/api/artist-bookings/admin/:id/refund', requireAdmin, (req, res) => {
    const booking = bookingById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (!['cancellation_review','payment_review'].includes(booking.status)) {
      return res.status(409).json({ error: 'Only a cancelled or payment-review booking can be refunded.' });
    }
    if (db.prepare('SELECT 1 FROM artist_booking_payouts WHERE booking_id=?').get(booking.id)) {
      return res.status(409).json({ error: 'A booking with a completed artist payout cannot be refunded.' });
    }
    const amountKes = Number(req.body?.amountKes);
    const reference = text(req.body?.reference, 120);
    const note = text(req.body?.note || '', 500);
    const maximumRefund = booking.received_amount_kes || booking.deposit_amount_kes;
    if (!Number.isSafeInteger(amountKes) || amountKes < 1 || amountKes > maximumRefund
      || !reference || !note) {
      return res.status(400).json({ error: `Enter a refund amount up to KES ${maximumRefund}, transfer reference, and note.` });
    }
    db.transaction(() => {
      db.prepare(`
        INSERT INTO artist_booking_refunds (id,booking_id,amount_kes,reference,note,admin_id)
        VALUES (?,?,?,?,?,?)
      `).run(crypto.randomUUID(), booking.id, amountKes, reference, note, Number(req.admin.sub));
      db.prepare("UPDATE artist_bookings SET status='refunded',refunded_at=datetime('now') WHERE id=?")
        .run(booking.id);
      queueBookingEmails(booking, 'refunded', [booking.artist_account_id, booking.organizer_account_id]);
    })();
    res.status(201).json({ amountKes, reference });
  });

  async function completeMpesaCallback(callback, booking) {
    if (booking.status !== 'deposit_pending') return;
    if (Number(callback.ResultCode) !== 0) {
      db.transaction(() => {
        db.prepare("UPDATE artist_bookings SET status='accepted' WHERE id=? AND status='deposit_pending'")
          .run(booking.id);
        queueBookingEmails(bookingById(booking.id), 'deposit_failed', [booking.organizer_account_id]);
      })();
      return;
    }
    const query = await paymentGateway.queryStkPush(booking.checkout_request_id, booking.merchant_request_id);
    if (String(query.CheckoutRequestID) !== booking.checkout_request_id || String(query.ResultCode) !== '0') return;
    const metadata = callback.CallbackMetadata && callback.CallbackMetadata.Item;
    const values = Array.isArray(metadata) ? Object.fromEntries(metadata.map((item) => [item.Name, item.Value])) : {};
    const actualAmount = Number(values.Amount);
    const receipt = typeof values.MpesaReceiptNumber === 'string' && values.MpesaReceiptNumber
      ? values.MpesaReceiptNumber : null;
    if (actualAmount !== booking.deposit_amount_kes || !receipt) {
      db.transaction(() => {
        db.prepare(`
          UPDATE artist_bookings SET status='payment_review',received_amount_kes=?,mpesa_receipt=?
          WHERE id=? AND status='deposit_pending'
        `).run(Number.isSafeInteger(actualAmount) && actualAmount > 0 ? actualAmount : null, receipt, booking.id);
        const updatedBooking = bookingById(booking.id);
        queueBookingEmails(updatedBooking, 'payment_review', [
          updatedBooking.artist_account_id,
          updatedBooking.organizer_account_id
        ]);
      })();
      return;
    }
    db.transaction(() => {
      db.prepare(`
        UPDATE artist_bookings SET status='deposit_paid',mpesa_receipt=?,received_amount_kes=?,paid_at=datetime('now')
        WHERE id=? AND status='deposit_pending'
      `).run(receipt, actualAmount, booking.id);
      const updatedBooking = bookingById(booking.id);
      queueBookingEmails(updatedBooking, 'deposit_paid', [
        updatedBooking.artist_account_id,
        updatedBooking.organizer_account_id
      ]);
    })();
  }

  return { completeMpesaCallback, retryPendingBookingEmails };
}

module.exports = { registerArtistMarketplaceRoutes };
