# Valor Africa Events

Valor Africa is an event discovery, publishing, ticketing, and event-promotion platform.

## Website

- `index.html` — event discovery, approved event listings, and the paid Valor Ads carousel.
- `events.html` — searchable and filterable event listings with M-Pesa and wallet checkout.
- `account.html` — Google/email account sign-in, account session management, and sign-out. Sign-in links return users to the page they came from; the account session is maintained for the current browser tab.
- `my-tickets.html`, `event.html`, and `organizer-dashboard.html` — account-linked ticket QR passes with event love/review feedback on ticket and event pages, organizer sales summaries, and event editing/removal when there are no active ticket orders or promotions.
- `wallet.html` — one-time phone-wallet linking, M-Pesa deposits, and transaction history.
- `host.html` — organizer event submission and local draft saving.
- `partnership.html` — creator applications and tracking, plus signed-in organizer and sponsor inquiries with follow-up status alongside investor information.
- `gifts.html` — Valor gift credit redeemable to a linked wallet and approved merchants' one-time voucher offers, with buyer and merchant tools.
- `event.html`, `order.html`, `ticket.html`, and `advertise.html` — public event details, payment status and ticket confirmations, ticket verification, and paid ad booking.
- `privacy-policy.html` — optional advertising-cookie and Meta Pixel consent details.
- `backend-events/` — API and admin dashboard for publishing, review, event orders, tickets, creator affiliate referrals, organizer and sponsor inquiries, ad packages, and the merchandise catalog with Valor Wallet checkout.

## SEO and advertising measurement

The public site is currently focused on discoverable events in Kenya. The home and event pages include search metadata and structured data; published event details receive event-specific metadata and Event structured data after loading. This helps search engines understand the pages but cannot guarantee rankings or rich results. To get indexed, verify `valorafrica.co.ke` in Google Search Console, submit `https://valorafrica.co.ke/sitemap.xml`, and inspect key URLs after deployment. Keep the event API available so published listings can load for search crawlers. Add translated or country-specific landing pages only when the corresponding event supply and services are available; there are no separate country-language versions to declare with `hreflang` today.

Meta Pixel uses the configured ID in `scripts/privacy-consent.js` and loads only after a visitor accepts optional cookies. Public discovery, event, organizer, and marketing pages record page views, published event views, and clicks to start ticket checkout. The order-status page can send a Purchase event only after payment is confirmed and only with consent; it does not send a PageView. Account, wallet, ticket, and organizer-dashboard pages remain excluded. Purchase events are deduplicated in the browser by order ID. Visitors can reject or withdraw consent using the persistent Cookie settings control. Review `privacy-policy.html` against your actual data practices and legal obligations for the countries you serve.

Signed-in buyers with confirmed or paid tickets can save one loved state, an optional 1–5 star rating, and a review of up to 1,200 characters per event from `my-tickets.html` or that event's published detail page. Feedback is private to the buyer's account; it is not published publicly. Older paid/confirmed tickets that predate account linking are also shown after the buyer verifies and links the same phone number used for the ticket order.

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
- `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`, `NOWPAYMENTS_KES_PER_USD`, and `NOWPAYMENTS_IPN_CALLBACK_URL` for ticket checkout; the exchange rate is the number of Kenyan shillings per US dollar.
- `AT_ENV`, `AT_USERNAME`, and `AT_API_KEY` for Africa's Talking one-time phone-wallet linking verification; configure `AT_SENDER_ID` only if your account has an approved sender ID.
- `GOOGLE_CLIENT_ID` for Google Identity Services sign-in; register the public website origin in the Google OAuth client.
- `RESEND_API_KEY` and `RESEND_FROM_EMAIL` for email verification, password-reset codes, and ticket confirmation emails with individual QR attachments. Verify the sender domain in Resend before production use.

Set the Daraja callback to a public HTTPS URL ending in `/api/mpesa/callback`. M-Pesa STK Push is configured for Buy Goods Till payments using `CustomerBuyGoodsOnline`; `MPESA_SHORTCODE` must contain the Till number and the Daraja app must have matching STK Push access. Set `MPESA_ENV=production` and use live Daraja credentials before accepting real payments. In NOWPayments, generate an API key and IPN secret, then set `NOWPAYMENTS_IPN_CALLBACK_URL` to the public HTTPS API endpoint ending in `/api/nowpayments/ipn`. Set `NOWPAYMENTS_KES_PER_USD` to the current number of Kenyan shillings per US dollar; KES ticket totals are converted and rounded to USD cents when the invoice is created. IPN signatures are verified before a payment can issue tickets. Update `scripts/events-api.js` on the static site to set `window.VALOR_EVENTS_API` to the deployed API HTTPS origin. Verify `/api/health` reports `paymentsConfigured: true`, `stripePaymentsConfigured: true`, `nowpaymentsConfigured: true`, `phoneLinkSmsConfigured: true`, `emailAuthConfigured: true`, `ticketEmailsConfigured: true`, and `googleAuthConfigured: true`; `/api/auth/config` provides the Google client ID and email/SMS configuration for the sign-in UI. Test email and phone verification with Resend and Africa's Talking sandboxes, and payments against the Daraja sandbox before configuring production credentials. Confirmed ticket orders queue an email with per-ticket QR attachments; failed sends are recorded and retried with backoff. M-Pesa deposits and checkout remain unavailable until Daraja is configured. Wallet deposits are credited only after Daraja callback verification. Wallet balance changes are recorded in a transaction ledger, and ticket/ad purchases debit that balance atomically.

Buyers and organizers can sign in from the Account page, which is linked throughout the public site. Authentication uses a verified Google or email account. Email accounts require email verification; passwords must be 8–128 characters, and reset codes expire after 10 minutes. Google ID tokens are verified by the API against `GOOGLE_CLIENT_ID`. Every ticket checkout—including free registrations, M-Pesa, Stripe, and Valor Wallet—requires an authenticated account session, and ticket orders are available only to the account that placed them. Confirmed ticket QR passes are listed on `my-tickets.html`. Signed-in organizers can publish events immediately; their events appear in `organizer-dashboard.html` and on the public site. Administrators can unpublish live events. To access a wallet, users sign in first and verify their Kenyan phone number by SMS once. This links any existing phone wallet—including its balance and transaction history—to the account; if no wallet exists for that number, one is created. Phone numbers already linked to another account cannot be claimed. SMS is not used for sign-in. Deposits are KES 100–150,000 per transaction. Users can then deposit M-Pesa funds or choose Valor Wallet during ticket checkout or event promotion booking.

Use the admin dashboard to manage live event listings, advertising-package names, durations, and KES prices, and creator partner applications and commissions. Back up the SQLite database and uploaded-poster directory together.

Creator/affiliate partners apply while signed in from `partnership.html`. Administrators review each application and record its individually agreed commission rate before activating a unique referral link. The latest valid referral click is attributed for 30 days; commission is calculated on ticket subtotal, excluding payment fees, and credited only after a ticket order is paid or confirmed. A partner cannot earn commission on ticket orders from their own account. The admin dashboard reports link visits, paid ticket orders, earned commission, and balances due. Payouts are manual: an administrator records the amount and transfer reference after sending funds; the system does not initiate affiliate payments.

Organizer partners and event sponsors submit separate inquiries from `partnership.html` while signed in. Each account can keep one inquiry per track, view its follow-up status and applicant-facing note, and resubmit a rejected inquiry. Administrators manage these applications in the admin dashboard. An approved status means the inquiry is ready for follow-up only; fees, campaign budgets, deliverables, and contracts must be agreed separately. These inquiries do not create charges or automatically activate event sponsorships.

## Gift marketplace operations and launch gate

Before deploying the gift marketplace, back up the SQLite database and set `GIFT_CARD_ENCRYPTION_KEY` in the hosting provider's secret settings to a dedicated base64-encoded 32-byte key (generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). Production startup validates this key. Keep it stable and backed up separately from the database: rotating or losing it makes stored bearer codes unreadable. Do not put the key in source control or logs. Back up the database before deploying schema changes.

Administrators should verify each merchant and approve the merchant account in the admin dashboard. The merchant then creates a listing, loads one-time codes, and activates the offer. Codes are encrypted at rest, are never shown again to the merchant, and are released to a buyer only after a wallet charge or verified matching Daraja callback. Purchasers share Valor codes themselves; the platform does not automatically deliver them to recipients. Configure Daraja before enabling M-Pesa gift or voucher purchases.

Merchant payouts are records of manual transfers already made; recording a payout does not send money. Refund requests require support review. A merchant must confirm a voucher code is unused before support can approve a merchant-voucher refund; record any manual M-Pesa refund reference when approving. Wallet refunds are posted to the purchaser's Valor Wallet.

The wallet-credit and merchant-voucher flows are product implementations, not legal or regulatory approval. Before public launch, obtain Kenya-specific legal and payments advice on stored value/payment-service classification, safeguarding/customer funds, consumer disclosures, tax, merchant agreements, settlement, expiry/refund rules, and any licensing or exemption requirements. Do not accept real gift-marketplace payments until this review and the required operational controls are complete.

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
7. Set `window.VALOR_EVENTS_API` in `scripts/events-api.js` to `https://api.valorafrica.co.ke`, then publish the static-site change. Verify account sign-in, immediate event publishing, organizer dashboard visibility, and ticket checkout; test M-Pesa with Daraja sandbox credentials before using production credentials.

The hostname in these steps is an example; use the API subdomain you control and set it consistently in DNS, `.env`, the Daraja callback, and `scripts/events-api.js`. The VM and DNS must be created before the public frontend can be wired to the API.

### Render setup

This repository includes a Render Blueprint in `render.yaml`. To deploy the event API:

1. Push the Blueprint to the `main` branch on GitHub, then create a Blueprint instance in Render using the `valorafricabrand-svg/brand` repository.
2. Review Render's current pricing before confirming. The Blueprint uses a paid web-service plan and a 1 GB persistent disk; the disk is required to retain the SQLite database and uploaded event posters across deploys.
3. Set `ADMIN_USERNAME` and a unique `ADMIN_PASSWORD` of at least 16 characters when prompted, or in the service's Environment settings before the first deploy. Do not put the password in GitHub.
4. Wait for the service to deploy, then open `https://<your-render-service-host>/api/health`. It should return JSON with `"ok": true` and `"paymentsConfigured": false` until Daraja is configured. Open `https://<your-render-service-host>/admin` to sign in.
5. In the Render service's Environment settings, add Daraja sandbox credentials (`MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, and `MPESA_PASSKEY`) and set `MPESA_ENV=sandbox` and `MPESA_CALLBACK_URL` to `https://<your-render-service-host>/api/mpesa/callback`. Sandbox only accepts Daraja's test numbers; real customer numbers require approved production Daraja credentials and `MPESA_ENV=production`. Set `AT_USERNAME` and `AT_API_KEY` for wallet phone-verification SMS. Configure either `RESEND_API_KEY` plus `RESEND_FROM_EMAIL` for email sign-in, or `GOOGLE_CLIENT_ID` for Google sign-in. Keep all credentials in Render, never in Git.
6. In `scripts/events-api.js`, set `window.VALOR_EVENTS_API` to the deployed service's HTTPS origin (no trailing slash), then publish that frontend change. Verify `/api/health` reports `"paymentsConfigured": true`, sign in, link a phone wallet, deposit using M-Pesa, and confirm the balance updates only after the Daraja callback. Use that balance for shop or ticket purchases.

Render assigns the service host during creation, so the frontend API URL and M-Pesa callback URL cannot be filled in until then. The `/api/health` response includes `mpesaEnvironment` (`sandbox` or `production`) so you can confirm the active mode without exposing credentials. Start with Daraja sandbox credentials and switch to production credentials only after a successful end-to-end test. The persistent disk must remain attached to the service; back it up regularly.

## Legacy shop backend

`backend-shop/` is the existing merchandise-store service. Keep it separate; it is not used to publish events or process event payments.
