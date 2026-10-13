# Valor Africa Events

Valor Africa is an event discovery, publishing, ticketing, and event-promotion platform.

## Website

- `index.html` — event discovery, approved event listings, and the paid Valor Ads carousel.
- `events.html` — searchable and filterable event listings with M-Pesa and wallet checkout.
- `wallet.html` — Google/email account sign-in, one-time phone-wallet linking, M-Pesa deposits, and transaction history.
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
- `AT_ENV`, `AT_USERNAME`, and `AT_API_KEY` for Africa's Talking one-time phone-wallet linking verification; configure `AT_SENDER_ID` only if your account has an approved sender ID.
- `GOOGLE_CLIENT_ID` for Google Identity Services sign-in; register the public website origin in the Google OAuth client.
- `RESEND_API_KEY` and `RESEND_FROM_EMAIL` for email verification and password-reset codes. Verify the sender domain in Resend before production use.

Set the Daraja callback to a public HTTPS URL ending in `/api/mpesa/callback`. Update `scripts/events-api.js` on the static site to set `window.VALOR_EVENTS_API` to the deployed API HTTPS origin. Verify `/api/health` reports `paymentsConfigured: true`, `phoneLinkSmsConfigured: true`, `emailAuthConfigured: true`, and `googleAuthConfigured: true`; `/api/auth/config` provides the Google client ID and email/SMS configuration for the sign-in UI. Test email and phone verification with Resend and Africa's Talking sandboxes, and payments against the Daraja sandbox before configuring production credentials. Event submissions and review work without Daraja, but M-Pesa deposits and checkout remain unavailable until it is configured. Wallet deposits are credited only after Daraja callback verification. Wallet balance changes are recorded in a transaction ledger, and ticket/ad purchases debit that balance atomically.

Buyers and organizers sign in using a verified Google or email account. Email accounts require email verification; passwords must be at least 12 characters, and reset codes expire after 10 minutes. Google ID tokens are verified by the API against `GOOGLE_CLIENT_ID`. To access a wallet, users sign in first and verify their Kenyan phone number by SMS once. This links any existing phone wallet—including its balance and transaction history—to the account; if no wallet exists for that number, one is created. Phone numbers already linked to another account cannot be claimed. SMS is not used for sign-in. Deposits are KES 100–150,000 per transaction. Users can then deposit M-Pesa funds or choose Valor Wallet during ticket checkout or event promotion booking.

Use the admin dashboard to review event submissions and manage advertising-package names, durations, and KES prices. Back up the SQLite database and uploaded-poster directory together.

With the API configured, the Valor Ads carousel displays events with active paid bookings. The static-only preview still contains sample artwork/listings and cannot publish events, accept checkout, or issue tickets. Existing animated artwork and configured video previews can be used; campaign-video upload management and impression analytics are not included yet.

### Render setup

This repository includes a Render Blueprint in `render.yaml`. To deploy the event API:

1. Push the Blueprint to the `main` branch on GitHub, then create a Blueprint instance in Render using the `valorafricabrand-svg/brand` repository.
2. Review Render's current pricing before confirming. The Blueprint uses a paid web-service plan and a 1 GB persistent disk; the disk is required to retain the SQLite database and uploaded event posters across deploys.
3. Set `ADMIN_USERNAME` and a unique `ADMIN_PASSWORD` of at least 16 characters when prompted, or in the service's Environment settings before the first deploy. Do not put the password in GitHub.
4. Wait for the service to deploy, then open `https://<your-render-service-host>/api/health`. It should return JSON with `"ok": true` and `"paymentsConfigured": false` until Daraja is configured. Open `https://<your-render-service-host>/admin` to sign in.
5. In `scripts/events-api.js`, set `window.VALOR_EVENTS_API` to the Render service's HTTPS origin (no trailing slash), then push that frontend change to `main`. GitHub Pages will publish it; verify event submission, admin review, and approved listings.
6. Configure Daraja sandbox credentials and set `MPESA_CALLBACK_URL` to `https://<your-render-service-host>/api/mpesa/callback`. Test ticket and ad checkout before enabling production Daraja credentials.

Render assigns the service host during creation, so the website API URL and M-Pesa callback URL cannot be filled in until then. Event publishing and review can be tested before payments are configured. The persistent disk must remain attached to the service; back it up regularly.

## Legacy shop backend

`backend-shop/` is the existing merchandise-store service. Keep it separate; it is not used to publish events or process event payments.
