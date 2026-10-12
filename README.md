# Valor Africa Events

Valor Africa is an event discovery, publishing, ticketing, and event-promotion platform.

## Website

- `index.html` — event discovery, approved event listings, and the paid Valor Ads carousel.
- `events.html` — searchable and filterable event listings with M-Pesa checkout.
- `host.html` — organizer event submission and local draft saving.
- `event.html`, `order.html`, `ticket.html`, and `advertise.html` — public event details, payment status and ticket confirmations, ticket verification, and paid ad booking.
- `backend-events/` — separate API and admin dashboard for publishing, review, orders, tickets, and ad packages. It is not connected to the merchandise shop backend.

## Run locally

Use Node.js 22.13 or later. In `backend-events/`, install dependencies, copy `.env.example` to `.env`, set a unique admin password (at least 16 characters) and a random `JWT_SECRET` (at least 32 characters), then run:

```powershell
cd backend-events
npm install
npm start
```

Serve the repository root on port 8765 (for example, `python -m http.server 8765`) and open `http://localhost:8765`. The local site connects to `http://localhost:4001`; the admin dashboard is at `http://localhost:4001/admin`.

## Production deployment

The public website is static. Deploy `backend-events/` separately as a Node service and attach persistent storage for its SQLite database and event posters. Set environment variables in the hosting provider; do not commit production secrets:

- `JWT_SECRET`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD`.
- `DB_PATH` and `UPLOAD_DIR` on the persistent disk.
- `ALLOWED_ORIGINS` to only the public site origin(s), without URL paths. The API also permits its own same-origin admin dashboard.
- `PUBLIC_SITE_URL` to the public website base URL (include `/brand` if using a GitHub Pages project site).
- `MPESA_ENV`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, and `MPESA_CALLBACK_URL`.

Set the Daraja callback to a public HTTPS URL ending in `/api/mpesa/callback`. Update `scripts/events-api.js` on the static site to set `window.VALOR_EVENTS_API` to the deployed API HTTPS origin. Verify `/api/health` reports `paymentsConfigured: true`, test checkout against the Daraja sandbox, and only then configure production credentials. Event submissions and review work without Daraja, but ticket and ad payments remain unavailable until it is configured. A ticket or ad placement is activated only after backend M-Pesa verification.

Use the admin dashboard to review event submissions and manage advertising-package names, durations, and KES prices. Back up the SQLite database and uploaded-poster directory together.

With the API configured, the Valor Ads carousel displays events with active paid bookings. The static-only preview still contains sample artwork/listings and cannot publish events, accept checkout, or issue tickets. Existing animated artwork and configured video previews can be used; campaign-video upload management and impression analytics are not included yet.

## Legacy shop backend

`backend-shop/` is the existing merchandise-store service. Keep it separate; it is not used to publish events or process event payments.
