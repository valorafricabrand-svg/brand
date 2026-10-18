# Valor Africa Events

Valor Africa is an event discovery, publishing, ticketing, and event-promotion platform.

## Website

- `index.html` — event discovery, approved event listings, and the paid Valor Ads carousel.
- `events.html` — searchable and filterable event listings with M-Pesa and wallet checkout.
- `account.html` — Google/email account sign-in and account session management.
- `wallet.html` — one-time phone-wallet linking, M-Pesa deposits, and transaction history.
- `host.html` — organizer event submission and local draft saving.
- `event.html`, `order.html`, `ticket.html`, and `advertise.html` — public event details, payment status and ticket confirmations, ticket verification, and paid ad booking.
- `backend-events/` — API and admin dashboard for publishing, review, event orders, tickets, ad packages, and the merchandise catalog with Valor Wallet checkout.

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

Buyers and organizers can sign in from the Account page, which is linked throughout the public site. Authentication uses a verified Google or email account. Email accounts require email verification; passwords must be at least 12 characters, and reset codes expire after 10 minutes. Google ID tokens are verified by the API against `GOOGLE_CLIENT_ID`. Every ticket checkout—including free registrations, M-Pesa, and Valor Wallet—requires an authenticated account session, and ticket orders are available only to the account that placed them. To access a wallet, users sign in first and verify their Kenyan phone number by SMS once. This links any existing phone wallet—including its balance and transaction history—to the account; if no wallet exists for that number, one is created. Phone numbers already linked to another account cannot be claimed. SMS is not used for sign-in. Deposits are KES 100–150,000 per transaction. Users can then deposit M-Pesa funds or choose Valor Wallet during ticket checkout or event promotion booking.

Use the admin dashboard to review event submissions and manage advertising-package names, durations, and KES prices. Back up the SQLite database and uploaded-poster directory together.

With the API configured, the Valor Ads carousel displays events with active paid bookings. The static-only preview still contains sample artwork/listings and cannot publish events, accept checkout, or issue tickets. Existing animated artwork and configured video previews can be used; campaign-video upload management and impression analytics are not included yet.

### Oracle Cloud Free Tier setup

The event API can run on an Oracle Cloud VM, including an Ampere A1 ARM VM, using Docker Compose. Oracle's free-tier availability and eligibility vary by region and account; confirm the current limits before creating resources. A free VM is self-managed and has no managed-service uptime guarantee.

1. Create an Ubuntu 24.04 ARM VM with a public IPv4 address. In Oracle's network security rules and the VM firewall, allow inbound TCP ports 80 and 443; keep SSH restricted to your own IP.
2. Point an `A` DNS record such as `api.valorafrica.co.ke` to the VM's public IPv4 address. Set the same hostname as `API_DOMAIN` in `backend-events/.env`. Caddy will obtain and renew its HTTPS certificate after DNS resolves and ports 80/443 are reachable.
3. Attach an Oracle block volume for the database and event posters. Format and mount it at `/opt/valorafrica-data`, then configure it to mount automatically after reboot. Create the directory and grant the container's `node` user (UID 1000) write access:

   ```bash
   sudo mkdir -p /opt/valorafrica-data
   sudo chown -R 1000:1000 /opt/valorafrica-data
   ```

4. Install Docker Engine and the Docker Compose plugin on the VM. Clone this repository, enter `backend-events/`, and prepare its private environment file:

   ```bash
   cp .env.example .env
   chmod 600 .env
   ```

   Edit `.env` on the VM: set a unique `JWT_SECRET` of at least 32 characters, `ADMIN_USERNAME`, a strong `ADMIN_PASSWORD` of at least 16 characters, `API_DOMAIN`, `VALOR_DATA_DIR=/opt/valorafrica-data`, and `PUBLIC_SITE_URL`. Remove localhost from `ALLOWED_ORIGINS` and keep only the exact public website origins. Add provider credentials privately as needed; do not commit `.env`.
5. Start the service from `backend-events/`:

   ```bash
   docker compose up -d --build
   docker compose ps
   ```

   Check `https://api.valorafrica.co.ke/api/health` and open `https://api.valorafrica.co.ke/admin`. The VM's attached block volume holds the SQLite database and uploaded posters across container rebuilds and VM restarts. Back it up regularly; do not delete the volume when replacing the VM.
6. After HTTPS is working, set `MPESA_CALLBACK_URL=https://api.valorafrica.co.ke/api/mpesa/callback` and add Daraja credentials to `.env` if ready to test payments. Configure Google, Resend, and Africa's Talking credentials there if those sign-in/verification services are needed. Restart after environment changes with `docker compose up -d`.
7. Set `window.VALOR_EVENTS_API` in `scripts/events-api.js` to `https://api.valorafrica.co.ke`, then publish the static-site change. Verify account sign-in, event submission, admin approval, and ticket checkout; test M-Pesa with Daraja sandbox credentials before using production credentials.

The hostname in these steps is an example; use the API subdomain you control and set it consistently in DNS, `.env`, the Daraja callback, and `scripts/events-api.js`. The VM and DNS must be created before the public frontend can be wired to the API.

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
