const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const db = require('./db');
const { createLoginLimiter, initializeAdmin, login, requireAdmin } = require('./auth');
const mpesa = require('./mpesa');

const allowedCategories = new Set(['Concerts','Festivals','Community','Food & Drink','Arts & Culture','Sports','Business','Other']);
const allowedTimezones = new Set(['Africa/Nairobi','UTC','Africa/Lagos','Africa/Accra']);
const allowedFormats = new Set(['Physical','Virtual','Hybrid']);
const uploadDirectory = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads', 'events'));
fs.mkdirSync(uploadDirectory, { recursive: true });

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function publicEvent(row) {
  const regular = { name: 'Regular', price: row.regular_price, currency: 'KES' };
  const tickets = [];
  if (row.early_bird_price !== null && row.early_bird_ends && Date.parse(row.early_bird_ends) > Date.now()) {
    tickets.push({
      name: 'Early bird',
      price: row.early_bird_price,
      regularPrice: row.regular_price,
      saleEnds: row.early_bird_ends,
      currency: 'KES'
    });
  } else {
    tickets.push(regular);
  }
  if (row.vip_price !== null) tickets.push({ name: 'VIP', price: row.vip_price, currency: 'KES' });
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    category: row.category,
    format: row.format,
    timezone: row.timezone,
    location: [row.venue_name, row.city].filter(Boolean).join(', ') || row.city,
    city: row.city,
    venueName: row.venue_name,
    meetingUrl: row.meeting_url,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    capacity: row.capacity,
    poster: row.poster_url,
    tags: JSON.parse(row.tags_json || '[]'),
    tickets,
    status: row.status,
    createdAt: row.created_at
  };
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^(?:254)[17]\d{8}$/.test(digits)) return digits;
  return null;
}

function validImage(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (buffer.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/)) return 'gif';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

function validateEvent(body) {
  const required = ['title','description','category','format','timezone','startsAt','endsAt','city','organizerName','organizerEmail','organizerPhone'];
  for (const field of required) {
    if (typeof body[field] !== 'string' || !body[field].trim()) return `${field} is required.`;
  }
  for (const field of ['venueName','meetingUrl','capacity','regularPrice','earlyBirdPrice','earlyBirdEnds','vipPrice','slug','tags']) {
    if (body[field] !== undefined && body[field] !== null && typeof body[field] !== 'string') {
      return `${field} must be text.`;
    }
  }
  if (body.title.trim().length > 120) return 'Event title must be 120 characters or fewer.';
  if (body.description.trim().length > 5000) return 'Event description must be 5,000 characters or fewer.';
  if (body.city.trim().length > 100) return 'City must be 100 characters or fewer.';
  if (body.organizerName.trim().length > 120) return 'Organizer name must be 120 characters or fewer.';
  if (body.organizerEmail.trim().length > 254) return 'Organizer email must be 254 characters or fewer.';
  if (body.organizerPhone.length > 24) return 'Organizer phone must be 24 characters or fewer.';
  if ((body.venueName || '').length > 180) return 'Venue name must be 180 characters or fewer.';
  if ((body.meetingUrl || '').length > 2048) return 'Meeting URL must be 2,048 characters or fewer.';
  if ((body.tags || '').length > 250) return 'Event tags must be 250 characters or fewer.';
  if (!allowedCategories.has(body.category)) return 'Choose a valid event category.';
  if (!allowedFormats.has(body.format)) return 'Choose a valid event format.';
  if (!allowedTimezones.has(body.timezone)) return 'Choose a supported event timezone.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.organizerEmail.trim())) return 'Enter a valid organizer email.';
  if (!normalizePhone(body.organizerPhone)) return 'Enter a valid Kenyan WhatsApp phone number.';
  const starts = Date.parse(body.startsAt);
  const ends = Date.parse(body.endsAt);
  if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts) return 'The event end must be after its start.';
  if (starts <= Date.now()) return 'Choose an event start time in the future.';
  const regular = Number(body.regularPrice);
  if (!Number.isSafeInteger(regular) || regular < 0) return 'Ticket prices must be whole KES amounts of zero or more.';
  if (body.capacity && (!Number.isSafeInteger(Number(body.capacity)) || Number(body.capacity) < 1)) return 'Capacity must be a positive whole number.';
  if (body.earlyBirdPrice) {
    const early = Number(body.earlyBirdPrice);
    const earlyEnd = Date.parse(body.earlyBirdEnds);
    if (!Number.isSafeInteger(early) || early < 0 || early >= regular || !Number.isFinite(earlyEnd) || earlyEnd >= starts || earlyEnd <= Date.now()) {
      return 'Early-bird price must be below the regular price and end in the future before the event starts.';
    }
  }
  if (body.vipPrice) {
    const vip = Number(body.vipPrice);
    if (!Number.isSafeInteger(vip) || vip <= regular) return 'VIP ticket price must be a whole KES amount above the regular price.';
  }
  if (body.meetingUrl) {
    try {
      const url = new URL(body.meetingUrl);
      if (url.protocol !== 'https:') return 'Virtual meeting links must use HTTPS.';
    } catch (error) {
      return 'Enter a valid virtual meeting URL.';
    }
  }
  if (body.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.slug)) return 'The event URL slug may use lowercase letters, numbers, and hyphens.';
  return null;
}

function slugify(value) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || 'event';
}

function createSubmissionLimiter() {
  const attempts = new Map();
  const windowMs = 30 * 60 * 1000;
  return function submissionLimiter(req, res, next) {
    const now = Date.now();
    let entry = attempts.get(req.ip);
    if (!entry || now - entry.startedAt > windowMs) {
      entry = { startedAt: now, count: 0 };
      attempts.set(req.ip, entry);
    }
    entry.count += 1;
    if (entry.count > 5) return res.status(429).json({ error: 'Too many event submissions. Please try again later.' });
    next();
  };
}

function safeOrderAccess(order, suppliedToken) {
  if (!suppliedToken || !order) return false;
  const actual = Buffer.from(order.access_token_hash, 'hex');
  const expected = Buffer.from(sha256(suppliedToken), 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function createApp(options = {}) {
  const paymentGateway = options.mpesa || mpesa;
  const publicSiteUrl = (options.publicSiteUrl || process.env.PUBLIC_SITE_URL || 'http://localhost:8765').replace(/\/+$/, '');
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  const origins = (process.env.ALLOWED_ORIGINS || 'http://localhost:8765,http://127.0.0.1:8765')
    .split(',').map((origin) => origin.trim()).filter(Boolean);
  app.use(cors((req, callback) => {
    const origin = req.get('Origin');
    const sameOrigin = origin && origin === `${req.protocol}://${req.get('host')}`;
    if (!origin || origins.includes(origin) || sameOrigin) {
      return callback(null, {
        origin: true,
        allowedHeaders: ['Content-Type','Authorization','X-Order-Access'],
        methods: ['GET','POST','PATCH','OPTIONS']
      });
    }
    return callback(new Error('Origin is not allowed.'));
  }));
  app.use(express.json({ limit: '64kb' }));
  app.use('/uploads/events', express.static(uploadDirectory, {
    fallthrough: false,
    maxAge: '1d',
    setHeaders(response) {
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    }
  }));

  const loginLimiter = createLoginLimiter();
  const submissionLimiter = createSubmissionLimiter();
  const imageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 22, parts: 23, fieldSize: 10000 },
    fileFilter(req, file, callback) {
      const allowed = new Set(['image/jpeg','image/png','image/gif','image/webp']);
      if (allowed.has(file.mimetype)) return callback(null, true);
      const error = new Error('Upload a JPEG, PNG, GIF, or WebP event poster.');
      error.status = 400;
      return callback(error);
    }
  }).single('eventImage');

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, paymentsConfigured: paymentGateway.isConfigured() });
  });

  app.post('/api/auth/login', loginLimiter, (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }
    const token = login(username, password);
    if (!token) return res.status(401).json({ error: 'Invalid admin credentials.' });
    res.json({ token, expiresIn: '8h' });
  });

  app.get('/api/events', (req, res) => {
    const rows = db.prepare(`
      SELECT * FROM events WHERE status = 'approved'
        AND julianday(starts_at) > julianday('now') AND julianday(ends_at) > julianday('now')
      ORDER BY starts_at ASC LIMIT 100
    `).all();
    res.json({ events: rows.map(publicEvent) });
  });

  app.get('/api/events/by-slug/:slug', (req, res) => {
    const row = db.prepare(`
      SELECT * FROM events WHERE slug = ? AND status = 'approved'
    `).get(req.params.slug);
    if (!row) return res.status(404).json({ error: 'This event is not available.' });
    res.json({ event: publicEvent(row) });
  });

  app.post('/api/events/submissions', submissionLimiter, (req, res, next) => {
    imageUpload(req, res, (error) => {
      if (error) return next(error);
      if (req.body.website) return res.status(400).json({ error: 'Invalid event submission.' });
      const input = {
        title: req.body.title,
        description: req.body.description,
        category: req.body.category,
        format: req.body.format,
        timezone: req.body.timezone,
        startsAt: req.body.startsAt,
        endsAt: req.body.endsAt,
        venueName: req.body.venueName || '',
        meetingUrl: req.body.meetingUrl || '',
        city: req.body.city,
        capacity: req.body.capacity || '',
        regularPrice: req.body.regularPrice,
        earlyBirdPrice: req.body.earlyBirdPrice || '',
        earlyBirdEnds: req.body.earlyBirdEnds || '',
        vipPrice: req.body.vipPrice || '',
        slug: req.body.slug || '',
        tags: req.body.tags || '',
        organizerName: req.body.organizerName,
        organizerEmail: req.body.organizerEmail,
        organizerPhone: req.body.organizerPhone
      };
      const invalid = validateEvent(input);
      if (invalid) return res.status(400).json({ error: invalid });
      if (req.file && !validImage(req.file.buffer)) return res.status(400).json({ error: 'The uploaded file is not a supported image.' });

      const id = crypto.randomUUID();
      const slug = input.slug ? input.slug.trim() : slugify(input.title);
      let posterUrl = '';
      if (req.file) {
        const extension = validImage(req.file.buffer);
        const filename = `${id}.${extension}`;
        try {
          fs.writeFileSync(path.join(uploadDirectory, filename), req.file.buffer, { flag: 'wx' });
        } catch (error) {
          return next(error);
        }
        posterUrl = `/uploads/events/${filename}`;
      }
      try {
        db.prepare(`
          INSERT INTO events (
            id, slug, title, description, category, format, timezone, starts_at, ends_at,
            venue_name, meeting_url, city, capacity, regular_price, early_bird_price,
            early_bird_ends, vip_price, tags_json, poster_url, organizer_name, organizer_email,
            organizer_phone
          ) VALUES (
            @id, @slug, @title, @description, @category, @format, @timezone, @startsAt, @endsAt,
            @venueName, @meetingUrl, @city, @capacity, @regularPrice, @earlyBirdPrice,
            @earlyBirdEnds, @vipPrice, @tags, @posterUrl, @organizerName, @organizerEmail,
            @organizerPhone
          )
        `).run({
          ...input,
          id,
          slug,
          startsAt: new Date(input.startsAt).toISOString(),
          endsAt: new Date(input.endsAt).toISOString(),
          earlyBirdEnds: input.earlyBirdEnds ? new Date(input.earlyBirdEnds).toISOString() : null,
          capacity: input.capacity ? Number(input.capacity) : null,
          regularPrice: Number(input.regularPrice),
          earlyBirdPrice: input.earlyBirdPrice ? Number(input.earlyBirdPrice) : null,
          vipPrice: input.vipPrice ? Number(input.vipPrice) : null,
          tags: JSON.stringify(input.tags.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 12)),
          posterUrl
        });
      } catch (error) {
        if (posterUrl) {
          try {
            fs.unlinkSync(path.join(uploadDirectory, path.basename(posterUrl)));
          } catch (cleanupError) {
            console.error('Could not remove an unlinked event poster:', cleanupError.message);
          }
        }
        if (error.errcode === 2067 || error.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/.test(error.message)) {
          return res.status(409).json({ error: 'That event URL is already in use. Choose a different slug.' });
        }
        throw error;
      }
      res.status(202).json({
        id,
        slug,
        status: 'pending',
        message: 'Your event was submitted for review. It will appear publicly after Valor Africa approves it.'
      });
    });
  });

  app.get('/api/events/admin/submissions', requireAdmin, (req, res) => {
    const status = ['pending','approved','rejected'].includes(req.query.status) ? req.query.status : null;
    const rows = status
      ? db.prepare('SELECT * FROM events WHERE status = ? ORDER BY created_at DESC LIMIT 200').all(status)
      : db.prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT 200').all();
    res.json({
      events: rows.map((row) => ({
        ...publicEvent(row),
        organizer: { name: row.organizer_name, email: row.organizer_email, phone: row.organizer_phone },
        reviewNote: row.review_note
      }))
    });
  });

  app.get('/api/orders/admin', requireAdmin, (req, res) => {
    const rows = db.prepare(`
      SELECT o.id,o.order_type AS orderType,o.status,o.buyer_name AS buyerName,o.phone,
        o.ticket_type AS ticketType,o.quantity,o.amount_kes AS amountKes,
        o.mpesa_receipt AS receipt,o.result_description AS resultDescription,
        o.created_at AS createdAt,o.paid_at AS paidAt,e.title AS eventTitle,
        p.name AS adPackage
      FROM orders o
      LEFT JOIN events e ON e.id=o.event_id
      LEFT JOIN ad_bookings b ON b.id=o.ad_booking_id
      LEFT JOIN ad_packages p ON p.id=b.package_id
      ORDER BY o.created_at DESC LIMIT 200
    `).all();
    res.json({ orders: rows });
  });

  app.patch('/api/events/admin/:id/review', requireAdmin, (req, res) => {
    const { status, reviewNote = '' } = req.body || {};
    if (!['approved','rejected'].includes(status)) return res.status(400).json({ error: 'Choose approve or reject.' });
    if (typeof reviewNote !== 'string' || reviewNote.length > 1000) return res.status(400).json({ error: 'Review notes must be 1,000 characters or fewer.' });
    const existing = db.prepare('SELECT id,status FROM events WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Event submission not found.' });
    if (existing.status !== 'pending') return res.status(409).json({ error: 'Only pending event submissions can be reviewed.' });
    db.prepare(`
      UPDATE events SET status = ?, review_note = ?, reviewed_at = datetime('now') WHERE id = ?
    `).run(status, reviewNote.trim(), req.params.id);
    res.json({ id: req.params.id, status });
  });

  app.get('/api/ads/packages', (req, res) => {
    const packages = db.prepare(`
      SELECT id,name,description,duration_days AS durationDays,price_kes AS priceKes
      FROM ad_packages WHERE active = 1 ORDER BY price_kes ASC
    `).all();
    res.json({ packages });
  });

  app.get('/api/ads/featured', (req, res) => {
    const rows = db.prepare(`
      SELECT DISTINCT e.* FROM events e
      INNER JOIN ad_bookings b ON b.event_id = e.id
      WHERE e.status = 'approved' AND b.status = 'active'
        AND julianday(b.starts_at) <= julianday('now')
        AND julianday(b.ends_at) > julianday('now')
        AND julianday(e.ends_at) > julianday('now')
      ORDER BY b.starts_at DESC LIMIT 10
    `).all();
    res.json({ events: rows.map(publicEvent) });
  });

  app.get('/api/ads/admin/packages', requireAdmin, (req, res) => {
    res.json({
      packages: db.prepare(`
        SELECT id,name,description,duration_days AS durationDays,price_kes AS priceKes,active,created_at AS createdAt
        FROM ad_packages ORDER BY created_at DESC
      `).all()
    });
  });

  app.post('/api/ads/admin/packages', requireAdmin, (req, res) => {
    const { name, description = '', durationDays, priceKes } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 80) return res.status(400).json({ error: 'Package name is required (80 characters maximum).' });
    if (typeof description !== 'string' || description.length > 500) return res.status(400).json({ error: 'Package description must be 500 characters or fewer.' });
    if (!Number.isSafeInteger(durationDays) || durationDays < 1 || durationDays > 90) return res.status(400).json({ error: 'Package duration must be 1–90 days.' });
    if (!Number.isSafeInteger(priceKes) || priceKes < 1) return res.status(400).json({ error: 'Set a positive whole-number KES price.' });
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO ad_packages (id,name,description,duration_days,price_kes) VALUES (?,?,?,?,?)')
      .run(id, name.trim(), description.trim(), durationDays, priceKes);
    res.status(201).json({ id, name: name.trim(), description: description.trim(), durationDays, priceKes, active: 1 });
  });

  app.patch('/api/ads/admin/packages/:id', requireAdmin, (req, res) => {
    const existing = db.prepare('SELECT * FROM ad_packages WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Ad package not found.' });
    const { name = existing.name, description = existing.description, durationDays = existing.duration_days, priceKes = existing.price_kes, active = existing.active } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 80) return res.status(400).json({ error: 'Package name is required (80 characters maximum).' });
    if (typeof description !== 'string' || description.length > 500) return res.status(400).json({ error: 'Package description must be 500 characters or fewer.' });
    if (!Number.isSafeInteger(durationDays) || durationDays < 1 || durationDays > 90) return res.status(400).json({ error: 'Package duration must be 1–90 days.' });
    if (!Number.isSafeInteger(priceKes) || priceKes < 1 || ![0,1,false,true].includes(active)) return res.status(400).json({ error: 'Choose a positive whole-number KES price and a valid availability setting.' });
    db.prepare('UPDATE ad_packages SET name=?,description=?,duration_days=?,price_kes=?,active=? WHERE id=?')
      .run(name.trim(), description.trim(), durationDays, priceKes, active ? 1 : 0, req.params.id);
    res.json({ id: req.params.id, name: name.trim(), description: description.trim(), durationDays, priceKes, active: active ? 1 : 0 });
  });

  function paymentsUnavailable(res) {
    if (paymentGateway.isConfigured()) return false;
    res.status(503).json({ error: 'M-Pesa checkout is not enabled yet. Valor Africa must configure its Daraja account and public callback URL.' });
    return true;
  }

  function createPendingOrder({ orderType, eventId = null, adBookingId = null, buyerName, phone, ticketType = '', quantity = 1, amountKes }) {
    const id = crypto.randomUUID();
    const accessToken = crypto.randomBytes(32).toString('base64url');
    db.prepare(`
      INSERT INTO orders (id,access_token_hash,order_type,event_id,ad_booking_id,buyer_name,phone,ticket_type,quantity,amount_kes)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(id, sha256(accessToken), orderType, eventId, adBookingId, buyerName.trim(), phone, ticketType, quantity, amountKes);
    return { id, accessToken };
  }

  async function startCheckout(res, order, amountKes, phone) {
    try {
      const request = await paymentGateway.initiateStkPush({
        id: order.id,
        amountKes,
        phone,
        orderType: order.orderType
      });
      db.prepare(`
        UPDATE orders SET checkout_request_id = ?, merchant_request_id = ? WHERE id = ?
      `).run(request.checkoutRequestId, request.merchantRequestId, order.id);
      res.status(201).json({
        orderId: order.id,
        accessToken: order.accessToken,
        status: 'pending',
        message: request.customerMessage
      });
    } catch (error) {
      db.prepare('UPDATE orders SET status = ?, result_description = ? WHERE id = ? AND status = ?')
        .run('failed', 'Could not start M-Pesa checkout.', order.id, 'pending');
      console.error('M-Pesa checkout could not be started:', error.message);
      res.status(502).json({ error: 'M-Pesa could not start the payment prompt. Check the phone number and try again.' });
    }
  }

  app.post('/api/orders/tickets', async (req, res, next) => {
    try {
      const { eventId, ticketType, buyerName, phone: inputPhone, quantity = 1 } = req.body || {};
      const phone = normalizePhone(inputPhone);
      if (typeof eventId !== 'string' || !eventId || typeof ticketType !== 'string' || !ticketType) return res.status(400).json({ error: 'Choose a published event and ticket type.' });
      if (typeof buyerName !== 'string' || !buyerName.trim() || buyerName.length > 120) return res.status(400).json({ error: 'Enter the ticket buyer’s name.' });
      if (!phone) return res.status(400).json({ error: 'Enter a valid Safaricom number, for example 0712345678.' });
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10) return res.status(400).json({ error: 'Ticket quantity must be 1–10.' });
      const event = db.prepare("SELECT * FROM events WHERE id = ? AND status = 'approved'").get(eventId);
      if (!event) return res.status(404).json({ error: 'This event is not available for ticket sales.' });
      if (Date.parse(event.starts_at) <= Date.now()) return res.status(409).json({ error: 'Ticket sales for this event have closed.' });
      let price;
      if (ticketType === 'Regular') price = event.regular_price;
      else if (ticketType === 'Early bird' && event.early_bird_price !== null && Date.parse(event.early_bird_ends) > Date.now()) price = event.early_bird_price;
      else if (ticketType === 'VIP' && event.vip_price !== null) price = event.vip_price;
      else return res.status(400).json({ error: 'That ticket type is unavailable.' });
      if (!Number.isSafeInteger(price * quantity)) return res.status(400).json({ error: 'The ticket order total is too large.' });

      let order;
      try {
        order = db.transaction(() => {
          if (event.capacity !== null) {
            const reserved = db.prepare(`
              SELECT COALESCE(SUM(quantity),0) AS total FROM orders
              WHERE event_id = ? AND order_type = 'ticket' AND (
                status IN ('paid','confirmed') OR (status = 'pending' AND created_at >= datetime('now','-5 minutes'))
              )
            `).get(eventId).total;
            if (reserved + quantity > event.capacity) throw Object.assign(new Error('There are not enough tickets remaining.'), { statusCode: 409 });
          }
          const created = createPendingOrder({
            orderType: 'ticket', eventId, buyerName, phone, ticketType, quantity,
            amountKes: price * quantity
          });
          if (price === 0) {
            db.prepare("UPDATE orders SET status='confirmed',result_description=?,paid_at=datetime('now') WHERE id=?")
              .run('Free ticket registration confirmed.', created.id);
            const insertTicket = db.prepare('INSERT INTO tickets (code,order_id,event_id,ticket_type) VALUES (?,?,?,?)');
            for (let ticket = 0; ticket < quantity; ticket += 1) {
              insertTicket.run(crypto.randomUUID(), created.id, eventId, ticketType);
            }
          }
          return created;
        })();
      } catch (error) {
        if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
        throw error;
      }
      if (price === 0) {
        return res.status(201).json({
          orderId: order.id,
          accessToken: order.accessToken,
          status: 'confirmed',
          message: 'Your free event registration is confirmed.'
        });
      }
      if (paymentsUnavailable(res)) return;
      return startCheckout(res, order, price * quantity, phone);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/orders/ads', async (req, res, next) => {
    try {
      if (paymentsUnavailable(res)) return;
      const { eventId, packageId, buyerName, phone: inputPhone } = req.body || {};
      const phone = normalizePhone(inputPhone);
      if (typeof eventId !== 'string' || !eventId || typeof packageId !== 'string' || !packageId) return res.status(400).json({ error: 'Choose an approved event and advertising package.' });
      if (typeof buyerName !== 'string' || !buyerName.trim() || buyerName.length > 120) return res.status(400).json({ error: 'Enter the advertiser’s name.' });
      if (!phone) return res.status(400).json({ error: 'Enter a valid Safaricom number, for example 0712345678.' });
      const event = db.prepare("SELECT id FROM events WHERE id = ? AND status = 'approved' AND julianday(starts_at) > julianday('now')").get(eventId);
      if (!event) return res.status(404).json({ error: 'Only approved events can be advertised.' });
      const packageRow = db.prepare('SELECT * FROM ad_packages WHERE id = ? AND active = 1').get(packageId);
      if (!packageRow) return res.status(404).json({ error: 'This advertising package is not available.' });
      const bookingId = crypto.randomUUID();
      let order;
      try {
        order = db.transaction(() => {
          db.prepare('INSERT INTO ad_bookings (id,event_id,package_id) VALUES (?,?,?)').run(bookingId, eventId, packageId);
          return createPendingOrder({
            orderType: 'ad', eventId, adBookingId: bookingId, buyerName, phone,
            amountKes: packageRow.price_kes
          });
        })();
      } catch (error) {
        throw error;
      }
      return startCheckout(res, order, packageRow.price_kes, phone);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/orders/:id', async (req, res, next) => {
    try {
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
      if (!safeOrderAccess(order, req.get('X-Order-Access'))) return res.status(404).json({ error: 'Order not found.' });
      const result = {
        orderId: order.id,
        status: order.status,
        orderType: order.order_type,
        amountKes: order.amount_kes,
        quantity: order.quantity,
        ticketType: order.ticket_type,
        receipt: order.status === 'paid' ? order.mpesa_receipt : '',
        resultDescription: order.result_description,
        createdAt: order.created_at
      };
      if (order.order_type === 'ticket' && ['paid','confirmed'].includes(order.status)) {
        const tickets = db.prepare(`
          SELECT t.code,t.ticket_type AS ticketType,e.title,e.slug,e.starts_at AS startsAt,e.venue_name AS venueName,e.city
          FROM tickets t JOIN events e ON e.id=t.event_id WHERE t.order_id=? ORDER BY t.created_at,t.code
        `).all(order.id);
        result.tickets = await Promise.all(tickets.map(async (ticket) => ({
          ...ticket,
          qr: await QRCode.toDataURL(`${publicSiteUrl}/ticket.html?code=${encodeURIComponent(ticket.code)}`, { errorCorrectionLevel: 'M', margin: 1, width: 220 })
        })));
      }
      if (order.order_type === 'ad' && order.ad_booking_id) {
        const booking = db.prepare(`
          SELECT b.status AS campaignStatus,b.starts_at AS startsAt,b.ends_at AS endsAt,
            e.title AS eventTitle,p.name AS packageName
          FROM ad_bookings b JOIN events e ON e.id=b.event_id JOIN ad_packages p ON p.id=b.package_id
          WHERE b.id=?
        `).get(order.ad_booking_id);
        result.campaign = booking;
      }
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/mpesa/callback', async (req, res) => {
    const callback = req.body && req.body.Body && req.body.Body.stkCallback;
    if (!callback || typeof callback.CheckoutRequestID !== 'string' || typeof callback.MerchantRequestID !== 'string') {
      console.error('Received an invalid M-Pesa callback payload.');
      return res.status(400).json({ ResultCode: 1, ResultDesc: 'Invalid callback payload.' });
    }
    const order = db.prepare(`
      SELECT * FROM orders WHERE checkout_request_id = ? AND merchant_request_id = ?
    `).get(callback.CheckoutRequestID, callback.MerchantRequestID);
    if (!order || order.status !== 'pending') return res.json({ ResultCode: 0, ResultDesc: 'Callback accepted.' });
    if (Number(callback.ResultCode) !== 0) {
      db.prepare('UPDATE orders SET status = ?, result_description = ? WHERE id = ? AND status = ?')
        .run('failed', String(callback.ResultDesc || 'M-Pesa payment was not completed.').slice(0, 250), order.id, 'pending');
      return res.json({ ResultCode: 0, ResultDesc: 'Callback accepted.' });
    }
    try {
      const query = await paymentGateway.queryStkPush(order.checkout_request_id);
      if (String(query.CheckoutRequestID) !== order.checkout_request_id || String(query.ResultCode) !== '0') {
        return res.json({ ResultCode: 0, ResultDesc: 'Payment verification is pending.' });
      }
      const metadata = callback.CallbackMetadata && callback.CallbackMetadata.Item;
      const values = Array.isArray(metadata) ? Object.fromEntries(metadata.map((item) => [item.Name, item.Value])) : {};
      if (Number(values.Amount) !== order.amount_kes || typeof values.MpesaReceiptNumber !== 'string' || !values.MpesaReceiptNumber) {
        db.prepare('UPDATE orders SET status = ?, result_description = ? WHERE id = ? AND status = ?')
          .run('review', 'Payment details did not match the order; support review is required.', order.id, 'pending');
        return res.json({ ResultCode: 0, ResultDesc: 'Payment requires review.' });
      }
      db.transaction(() => {
        const current = db.prepare("SELECT * FROM orders WHERE id = ? AND status = 'pending'").get(order.id);
        if (!current) return;
        if (current.order_type === 'ticket' && current.event_id) {
          const event = db.prepare('SELECT capacity FROM events WHERE id=?').get(current.event_id);
          if (event.capacity !== null) {
            const sold = db.prepare("SELECT COALESCE(SUM(quantity),0) AS total FROM orders WHERE event_id=? AND order_type='ticket' AND status IN ('paid','confirmed')").get(current.event_id).total;
            if (sold + current.quantity > event.capacity) {
              db.prepare('UPDATE orders SET status=?,mpesa_receipt=?,result_description=? WHERE id=?')
                .run('review', values.MpesaReceiptNumber, 'Payment received but capacity was reached; contact support for a refund.', current.id);
              return;
            }
          }
          db.prepare("UPDATE orders SET status='paid',mpesa_receipt=?,result_description=?,paid_at=datetime('now') WHERE id=?")
            .run(values.MpesaReceiptNumber, 'Payment confirmed by M-Pesa.', current.id);
          const insertTicket = db.prepare('INSERT INTO tickets (code,order_id,event_id,ticket_type) VALUES (?,?,?,?)');
          for (let ticket = 0; ticket < current.quantity; ticket += 1) {
            insertTicket.run(crypto.randomUUID(), current.id, current.event_id, current.ticket_type);
          }
        } else if (current.order_type === 'ad' && current.ad_booking_id) {
          const booking = db.prepare(`
            SELECT b.id,p.duration_days FROM ad_bookings b JOIN ad_packages p ON p.id=b.package_id WHERE b.id=?
          `).get(current.ad_booking_id);
          const beginsAt = new Date(Math.floor(Date.now() / 1000) * 1000);
          const endsAt = new Date(beginsAt.getTime() + booking.duration_days * 86400000);
          db.prepare("UPDATE orders SET status='paid',mpesa_receipt=?,result_description=?,paid_at=datetime('now') WHERE id=?")
            .run(values.MpesaReceiptNumber, 'Payment confirmed by M-Pesa.', current.id);
          db.prepare("UPDATE ad_bookings SET status='active',starts_at=?,ends_at=? WHERE id=?")
            .run(beginsAt.toISOString(), endsAt.toISOString(), booking.id);
        }
      })();
    } catch (error) {
      console.error('M-Pesa payment verification failed; order remains unconfirmed:', error.message);
    }
    res.json({ ResultCode: 0, ResultDesc: 'Callback accepted.' });
  });

  app.get('/api/tickets/:code/verify', (req, res) => {
    const ticket = db.prepare(`
      SELECT t.code,t.ticket_type AS ticketType,t.checked_in_at AS checkedInAt,
        e.title AS eventTitle,e.starts_at AS startsAt,e.ends_at AS endsAt,e.venue_name AS venueName,e.city,
        o.status AS paymentStatus
      FROM tickets t JOIN events e ON e.id=t.event_id JOIN orders o ON o.id=t.order_id
      WHERE t.code=?
    `).get(req.params.code);
    if (!ticket || !['paid','confirmed'].includes(ticket.paymentStatus)) return res.status(404).json({ error: 'Ticket is invalid.' });
    const { paymentStatus, ...publicTicket } = ticket;
    res.json({ valid: true, ...publicTicket });
  });

  app.post('/api/tickets/admin/:code/check-in', requireAdmin, (req, res) => {
    const ticket = db.prepare('SELECT checked_in_at FROM tickets WHERE code=?').get(req.params.code);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
    if (ticket.checked_in_at) return res.status(409).json({ error: 'This ticket was already checked in.' });
    db.prepare("UPDATE tickets SET checked_in_at=datetime('now') WHERE code=? AND checked_in_at IS NULL").run(req.params.code);
    res.json({ checkedIn: true });
  });

  app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));
  app.use('/admin-assets', express.static(path.join(__dirname, '..', 'public'), { index: false }));
  app.get('/admin-assets/:file', (req, res, next) => {
    if (!['admin.js','admin.css'].includes(req.params.file)) return next();
    res.sendFile(path.join(__dirname, '..', 'public', req.params.file));
  });

  app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Event poster must be 10 MB or smaller.' : 'Invalid image upload.' });
    }
    if (error.status === 400) return res.status(400).json({ error: error.message || 'Invalid request.' });
    if (error.status === 413) return res.status(413).json({ error: 'Request body is too large.' });
    if (error && error.status === 404 && error.code === 'ENOENT') return res.status(404).json({ error: 'Uploaded event poster not found.' });
    if (error.message === 'Origin is not allowed.') return res.status(403).json({ error: error.message });
    console.error('Event API error:', error);
    return res.status(500).json({ error: 'The event service could not complete the request.' });
  });
  return app;
}

module.exports = { createApp, initializeAdmin };
