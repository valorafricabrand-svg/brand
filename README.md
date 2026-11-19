# Valor Africa Events

Valor Africa is an event discovery, publishing, ticketing, and event-promotion platform.

## Website

- `index.html` — a two-panel "hero promo" carousel at the very top showing the admin-managed homepage highlights (`GET /api/ads/hero`), the paid Valor Ads carousel just below it, event discovery and approved event listings, a "What people are saying" strip of real reviews from sold-out events, and a pausable right-to-left showcase of branding examples.
- `events.html` — searchable and filterable event listings with M-Pesa and wallet checkout, alongside the same branding showcase.
- `account.html` — Google/email account sign-in, account session management, and sign-out. Sign-in links return users to the page they came from; the account session is maintained for the current browser tab.
- `my-tickets.html`, `event.html`, and `organizer-dashboard.html` — account-linked ticket QR passes with event love/review feedback on ticket and event pages, organizer sales summaries, and event editing/removal when there are no active ticket orders or promotions.
- `wallet.html` — one-time phone-wallet linking, M-Pesa deposits, and transaction history.
- `host.html` — organizer event submission and local draft saving.
- `partnership.html` — creator applications and tracking, plus signed-in organizer and sponsor inquiries with follow-up status alongside investor information.
- `partners.html` — a showcase landing page listing all five partnership programs (event sponsors, event organizers, affiliates, artists & DJs, branding services) as independently expandable cards, each linking into its real flow.
- `gifts.html` — Valor gift credit redeemable to a linked wallet and approved merchants' one-time voucher offers, with buyer and merchant tools.
- `branding.html` — event branding and merchandise examples for organizers, vendors and sponsors, with an inquiry link and a separate path to the official Valor Africa shop.
- `event.html`, `order.html`, `ticket.html`, and `advertise.html` — public event details, payment status and ticket confirmations, ticket verification, and paid ad booking.
- `privacy-policy.html` — optional advertising-cookie and Meta Pixel consent details.
- `backend-events/` — API and admin dashboard for publishing, review, event orders, tickets, creator affiliate referrals, organizer and sponsor inquiries, ad packages, and the merchandise catalog with Valor Wallet checkout.

## SEO and advertising measurement

The public site is currently focused on discoverable events in Kenya. The home and event pages include search metadata and structured data; published event details receive event-specific metadata and Event structured data after loading. This helps search engines understand the pages but cannot guarantee rankings or rich results. To get indexed, verify `valorafrica.co.ke` in Google Search Console, submit `https://valorafrica.co.ke/sitemap.xml`, and inspect key URLs after deployment. Keep the event API available so published listings can load for search crawlers. Add translated or country-specific landing pages only when the corresponding event supply and services are available; there are no separate country-language versions to declare with `hreflang` today.

Meta Pixel uses the configured ID in `scripts/privacy-consent.js` and loads only after a visitor accepts optional cookies. Public discovery, event, organizer, and marketing pages record page views, published event views, and clicks to start ticket checkout. The order-status page can send a Purchase event only after payment is confirmed and only with consent; it does not send a PageView. Account, wallet, ticket, and organizer-dashboard pages remain excluded. Purchase events are deduplicated in the browser by order ID. Visitors can reject or withdraw consent using the persistent Cookie settings control. Review `privacy-policy.html` against your actual data practices and legal obligations for the countries you serve.

Any signed-in visitor can bookmark an event with one tap from its published detail page (`POST /api/account/events/:id/feedback` with no rating or review attached) — this is a private favorite, not a public review. Writing an actual star rating and comment is reserved for real attendees: from `my-tickets.html`, buyers with a confirmed or paid ticket get an interactive 1–5 star picker and a review of up to 1,200 characters per event, but the backend only accepts a rating or review once that specific event's end time has passed — the API rejects both an attempt from an account with no ticket for the event (`403`, "You can only rate and review events you attended") and an attempt before the event has ended (`403`, "You can rate and review this event once it has ended"). Older paid/confirmed tickets that predate account linking are also shown after the buyer verifies and links the same phone number used for the ticket order.

Published reviews are public: `GET /api/events/:id/reviews` returns the average rating and every written review for an event, rendered as a "What people say" section on that event's own page. Each event's detail page also reports whether it sold out (`ticketsSold` reaching its `capacity`) with a SOLD OUT badge. The homepage's "What people are saying" section (`GET /api/reviews/highlights`, rendered by `scripts/testimonials.js`) displays the latest written reviews from all approved, non-deleted events, whether sold out or not. Each card shows the ticket holder's star rating and comment and links to the event; if there are no reviews yet, the section says so rather than showing sample reviews.

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
- `PAYHERO_API_USERNAME`, `PAYHERO_API_PASSWORD`, `PAYHERO_CHANNEL_ID`, and `PAYHERO_CALLBACK_URL`.
- `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`, `NOWPAYMENTS_KES_PER_USD`, and `NOWPAYMENTS_IPN_CALLBACK_URL` for ticket checkout; the exchange rate is the number of Kenyan shillings per US dollar.
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_ENV` (`sandbox` or `production`), and `PAYPAL_KES_PER_USD` for PayPal Valor Wallet deposits; PayPal does not settle in KES, so deposits are converted to USD using this rate.
- `AT_ENV`, `AT_USERNAME`, and `AT_API_KEY` for Africa's Talking one-time phone-wallet linking verification; configure `AT_SENDER_ID` only if your account has an approved sender ID.
- `GOOGLE_CLIENT_ID` for Google Identity Services sign-in; register the public website origin in the Google OAuth client.
- `RESEND_API_KEY` and `RESEND_FROM_EMAIL` for email verification, password-reset codes, and ticket confirmation emails with individual QR attachments. Verify the sender domain in Resend before production use.

M-Pesa checkout is brokered through [PayHero](https://payhero.co.ke) rather than a direct Safaricom Daraja integration. Create a PayHero account, link your Till, Paybill, or bank account to it, and copy the API Username, API Password, and Channel ID from its dashboard into `PAYHERO_API_USERNAME`, `PAYHERO_API_PASSWORD`, and `PAYHERO_CHANNEL_ID`. Set `PAYHERO_CALLBACK_URL` to a public HTTPS URL ending in `/api/payhero/callback`; this is sent with every payment request rather than configured once in a dashboard. PayHero's own payment-completion callback is not signed, so every callback is only a trigger to check again: the API independently re-verifies each payment's status through PayHero's transaction-status endpoint, using its own API credentials, before ever marking an order paid — a forged or replayed callback cannot issue a ticket on its own. In NOWPayments, generate an API key and IPN secret, then set `NOWPAYMENTS_IPN_CALLBACK_URL` to the public HTTPS API endpoint ending in `/api/nowpayments/ipn`. Set `NOWPAYMENTS_KES_PER_USD` to the current number of Kenyan shillings per US dollar; KES ticket totals are converted and rounded to USD cents when the invoice is created. IPN signatures are verified before a payment can issue tickets. Update `scripts/events-api.js` on the static site to set `window.VALOR_EVENTS_API` to the deployed API HTTPS origin. Verify `/api/health` reports `paymentsConfigured: true`, `stripePaymentsConfigured: true`, `nowpaymentsConfigured: true`, `phoneLinkSmsConfigured: true`, `emailAuthConfigured: true`, `ticketEmailsConfigured: true`, and `googleAuthConfigured: true`; `/api/auth/config` provides the Google client ID and email/SMS configuration for the sign-in UI. Test email and phone verification with Resend and Africa's Talking sandboxes before configuring production credentials; PayHero itself has no separate sandbox mode, so test M-Pesa payments move real money through your linked Till/Paybill. Confirmed ticket orders queue an email with per-ticket QR attachments; failed sends are recorded and retried with backoff. M-Pesa deposits and checkout remain unavailable until PayHero is configured. Wallet deposits are credited only after PayHero callback verification. Wallet balance changes are recorded in a transaction ledger, and ticket/ad purchases debit that balance atomically.

The legacy direct-Daraja module (`backend-events/src/mpesa.js`) remains in the codebase but is no longer wired into the API; it was superseded by PayHero because PayHero does not require Safaricom's own Daraja business approval. Switching back would mean reinstating it in `src/app.js` in place of `src/payhero.js`.

Buyers and organizers can sign in from the Account page, which is linked throughout the public site. Authentication uses a verified Google or email account. Email accounts require email verification; passwords must be 8–128 characters, and reset codes expire after 10 minutes. Google ID tokens are verified by the API against `GOOGLE_CLIENT_ID`. Every ticket checkout—including free registrations, M-Pesa, Stripe, and Valor Wallet—requires an authenticated account session, and ticket orders are available only to the account that placed them. Confirmed ticket QR passes are listed on `my-tickets.html`. Signed-in organizers can publish events immediately; their events appear in `organizer-dashboard.html` and on the public site. Administrators can unpublish live events. To access a wallet, users sign in first and confirm the Kenyan phone number they want to link by entering a six-digit code emailed to their own account address (`/api/account/wallet/email-code` and `/api/account/wallet/email-verify`, sent via Resend). This links any existing phone wallet—including its balance and transaction history—to the account; if no wallet exists for that number, one is created. Phone numbers already linked to another account cannot be claimed. Because this only confirms control of the signed-in account's email rather than control of the phone number, any signed-in account can claim an unclaimed phone wallet—including one with an existing balance—by entering its number; this tradeoff avoids requiring paid SMS credits before launch. The original SMS-based path (`/api/account/phone/otp` and `/api/account/phone/verify`, requiring Africa's Talking) still exists in the API and can be reinstated in the frontend if stronger phone-ownership verification is needed later. Deposits are KES 100–150,000 per transaction and can be made with M-Pesa (via PayHero), crypto (via NOWPayments, redirecting to its hosted checkout and crediting the balance only after a signed, matching finished-payment IPN), or PayPal (converted to USD using `PAYPAL_KES_PER_USD`, redirecting to PayPal's approval flow; the balance is credited only once the capture is confirmed on return and matched against the stored order, or once PayPal's signed webhook independently reports the same completed, matching capture — whichever arrives first, with the other call treated as an idempotent no-op). Users can then choose Valor Wallet during ticket checkout or event promotion booking.

Use the admin dashboard to manage live event listings, advertising tiers and their per-day KES prices and placement, and creator partner applications and commissions. Back up the SQLite database and uploaded-poster directory together.

Event advertising (`advertise.html`, `GET/POST /api/ads/packages` and `/api/orders/ads`) is priced per day rather than as a flat package. Each tier (seeded by default as Listing Spotlight, Category Boost, Homepage Carousel, and Premium Placement, from KES 100–1,500 per day) grants a `placement` that determines where a paid event actually appears: `listing` adds a SPONSORED badge to the event's card in the main grid and the sponsored-events rail; `category` adds the same plus priority within category filters; `homepage` adds rotation in the homepage hero carousel, gated via `GET /api/ads/featured?placement=homepage`; `premium` sorts ahead of other paid placements within the carousel. Organizers choose a tier and a number of days (bounded by the tier's configured minimum/maximum) on `advertise.html`; the total price, placement, and day count are snapshotted onto the booking at purchase time so later admin price changes never alter what was already paid for. Ad orders can be paid with M-Pesa, Valor Wallet, crypto (NOWPayments), or PayPal; the last two redirect to the provider's hosted checkout and the booking activates only once that payment is independently confirmed (a signed NOWPayments IPN, or a captured PayPal order re-verified on return or by PayPal's own webhook, whichever arrives first).

Every published event page records a page view (`POST /api/events/:id/views`, unauthenticated, rate-limited per IP) regardless of sign-in state. In `organizer-dashboard.html`, organizers can expand "View ad analytics" on any of their events to see a daily chart of those page views alongside ticket sales for that day (`GET /api/events/mine/:id/ad-analytics`), the event's advertising package bookings and their active date ranges, and totals since the earliest ad booking (or the last 30 days if none has been purchased yet) — so organizers can see whether traffic actually grew while a paid promotion was running.

Once Resend is configured, two kinds of reminder emails send automatically, checked hourly and gated so each is sent at most once: a ticket countdown ("7 days until…", "tomorrow", "today") to buyers with a paid or confirmed ticket, and a re-engagement reminder to signed-in visitors who viewed a published event (while signed in) but have not booked it, sent at least 24 hours after that view. Ticket countdown reminders are always sent to ticket holders; re-engagement reminders are skipped for accounts that opted out from the Account page or by using the one-click unsubscribe link included in every re-engagement email, and are never sent for an event the recipient has already booked. Administrators can trigger a batch immediately from the admin dashboard's "Reminder emails" tab instead of waiting for the next hourly run.

Creator/affiliate partners apply while signed in from `partnership.html`. Administrators review each application and record its individually agreed commission rate before activating a unique referral link. The latest valid referral click is attributed for 30 days; commission is calculated on ticket subtotal, excluding payment fees, and credited only after a ticket order is paid or confirmed. A partner cannot earn commission on ticket orders from their own account. The admin dashboard reports link visits, paid ticket orders, earned commission, and balances due. Payouts are manual: an administrator records the amount and transfer reference after sending funds; the system does not initiate affiliate payments.

Organizer partners and event sponsors submit separate inquiries from `partnership.html` while signed in. Each account can keep one inquiry per track, view its follow-up status and applicant-facing note, and resubmit a rejected inquiry. Administrators manage these applications in the admin dashboard. An approved status means the inquiry is ready for follow-up only; fees, campaign budgets, deliverables, and contracts must be agreed separately. These inquiries do not create charges or automatically activate event sponsorships.

Sponsor inquiries also pick one of three indicative packages (`GET /api/partnership-applications/sponsorship-tiers`): Community Sponsor (KES 25,000), City Sponsor (KES 75,000), or Premium Partner (KES 200,000), each listing example deliverables that scale up with the package. The chosen package is stored on the inquiry and shown to the admin reviewing it, but — consistent with the rest of this flow — it is only a starting point for a follow-up conversation; no payment is collected and no package, price, or deliverable is committed until Valor Africa and the sponsor agree separately.

Sponsors who don't want to wait on a follow-up conversation can instead check out immediately on `partnership.html` (`GET /api/sponsorships/tiers`, `POST /api/sponsorships`) for the same three packages — Community (KES 25,000 / 14 days), City (KES 75,000 / 30 days), and Premium (KES 200,000 / 60 days) — paying with M-Pesa, Valor Wallet, crypto (NOWPayments), or PayPal. Visibility activates automatically the moment payment is confirmed (a verified PayHero callback, a signed NOWPayments IPN, or a captured PayPal order), with no admin step required: the brand's name, logo, and website link appear in a sponsor strip on `events.html` and `index.html` (`GET /api/sponsorships/active`, rendered by `scripts/sponsors.js`), ordered by tier (Premium first) and then by most recent payment, for the sponsorship's paid day count. Buyers can track status and retry payment from `sponsorship-status.html` using the access token issued at checkout. Administrators can review every purchase and cancel one early — pulling it out of the sponsor strip immediately — from the "Paid sponsorships" tab in the admin dashboard (`GET/PATCH /api/sponsorships/admin*`); cancellation only records that the sponsor's visibility window ended early and does not itself issue a refund.

## Gift marketplace operations and launch gate

Before deploying the gift marketplace, back up the SQLite database and set `GIFT_CARD_ENCRYPTION_KEY` in the hosting provider's secret settings to a dedicated base64-encoded 32-byte key (generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). Production startup validates this key. Keep it stable and backed up separately from the database: rotating or losing it makes stored bearer codes unreadable. Do not put the key in source control or logs. Back up the database before deploying schema changes.

Administrators should verify each merchant and approve the merchant account in the admin dashboard. The merchant then creates a listing, loads one-time codes, and activates the offer. Codes are encrypted at rest, are never shown again to the merchant, and are released to a buyer only after a wallet charge or verified matching PayHero callback. Purchasers share Valor codes themselves; the platform does not automatically deliver them to recipients. Configure PayHero before enabling M-Pesa gift or voucher purchases.

Merchant payouts are records of manual transfers already made; recording a payout does not send money. Refund requests require support review. A merchant must confirm a voucher code is unused before support can approve a merchant-voucher refund; record any manual M-Pesa refund reference when approving. Wallet refunds are posted to the purchaser's Valor Wallet.

The wallet-credit and merchant-voucher flows are product implementations, not legal or regulatory approval. Before public launch, obtain Kenya-specific legal and payments advice on stored value/payment-service classification, safeguarding/customer funds, consumer disclosures, tax, merchant agreements, settlement, expiry/refund rules, and any licensing or exemption requirements. Do not accept real gift-marketplace payments until this review and the required operational controls are complete.

With the API configured, the Valor Ads carousel displays events with active paid bookings. The static-only preview still contains sample artwork/listings and cannot publish events, accept checkout, or issue tickets. Existing animated artwork and configured video previews can be used; campaign-video upload management and impression analytics are not included yet.

The admin dashboard's "Homepage hero slides" manager (video or image, with a title, category, description, and call-to-action) now feeds a dedicated two-panel carousel at the very top of `index.html` (`scripts/hero-promo.js`), separate from the Valor Ads carousel beneath it. Each slide's own media plays on one side while a colored panel cycling through a small accent palette shows its title, category badge, description, and call-to-action alongside a generic "Browse all events" link. It stays hidden if no hero slides are active. Both the create form and each slide's edit row can upload a file directly (MP4/WebM for video slides, up to 100 MB; JPG/PNG/GIF/WebP for image slides) instead of only pasting a path or URL — the upload control shown switches automatically with the selected slide type.

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
6. After HTTPS is working, set `PAYHERO_CALLBACK_URL=https://api.valorafrica.co.ke/api/payhero/callback` and add PayHero credentials to `.env` if ready to test payments. Configure Google, Resend, and Africa's Talking credentials there if those sign-in/verification services are needed. Restart after environment changes with `docker compose up -d`.
7. Set `window.VALOR_EVENTS_API` in `scripts/events-api.js` to `https://api.valorafrica.co.ke`, then publish the static-site change. Verify account sign-in, immediate event publishing, organizer dashboard visibility, and ticket checkout; PayHero has no sandbox mode, so a successful test payment moves real money through your linked Till/Paybill.

The hostname in these steps is an example; use the API subdomain you control and set it consistently in DNS, `.env`, PayHero's callback URL, and `scripts/events-api.js`. The VM and DNS must be created before the public frontend can be wired to the API.

### Render setup

This repository includes a Render Blueprint in `render.yaml`. To deploy the event API:

1. Push the Blueprint to the `main` branch on GitHub, then create a Blueprint instance in Render using the `valorafricabrand-svg/brand` repository.
2. Review Render's current pricing before confirming. The Blueprint uses a paid web-service plan and a 1 GB persistent disk; the disk is required to retain the SQLite database and uploaded event posters across deploys.
3. Set `ADMIN_USERNAME` and a unique `ADMIN_PASSWORD` of at least 16 characters when prompted, or in the service's Environment settings before the first deploy. Do not put the password in GitHub.
4. Wait for the service to deploy, then open `https://<your-render-service-host>/api/health`. It should return JSON with `"ok": true` and `"paymentsConfigured": false` until PayHero is configured. Open `https://<your-render-service-host>/admin` to sign in.
5. Create a [PayHero](https://payhero.co.ke) account and link your Till, Paybill, or bank account to it. In the Render service's Environment settings, add the resulting `PAYHERO_API_USERNAME`, `PAYHERO_API_PASSWORD`, and `PAYHERO_CHANNEL_ID`, and set `PAYHERO_CALLBACK_URL` to `https://<your-render-service-host>/api/payhero/callback`. PayHero has no sandbox mode, so every successful payment — including your first test — moves real money through your linked Till/Paybill. Set `AT_USERNAME` and `AT_API_KEY` for wallet phone-verification SMS. Configure either `RESEND_API_KEY` plus `RESEND_FROM_EMAIL` for email sign-in, or `GOOGLE_CLIENT_ID` for Google sign-in. Keep all credentials in Render, never in Git.
6. In `scripts/events-api.js`, set `window.VALOR_EVENTS_API` to the deployed service's HTTPS origin (no trailing slash), then publish that frontend change. Verify `/api/health` reports `"paymentsConfigured": true`, sign in, link a phone wallet, deposit using M-Pesa, and confirm the balance updates only after PayHero's callback is independently re-verified. Use that balance for shop or ticket purchases.

Render assigns the service host during creation, so the frontend API URL and PayHero callback URL cannot be filled in until then. The `/api/health` response includes `mpesaEnvironment` for historical reasons, though PayHero reports a single `production` value since it has no sandbox mode. The persistent disk must remain attached to the service; back it up regularly.

## Legacy shop backend

`backend-shop/` is the existing merchandise-store service. Keep it separate; it is not used to publish events or process event payments.
