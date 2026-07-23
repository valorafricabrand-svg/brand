# Valor Africa Shop Backend

A small Node.js/Express API + admin dashboard for managing shop merchandise and
promotional offers (e.g. "10% off everything"). The public storefront
(`/shop.html` at the repo root, hosted on GitHub Pages) calls this API to
display a paginated product catalog with live pricing.

## What's included

- **Public API** — paginated product listing, single product lookup, active offers
- **Admin API** — JWT-protected create/update/delete for products and offers
- **Admin dashboard** — a simple login-protected UI at `/admin` for managing merch and offers
- **SQLite database** — zero external services required; the DB is a single file

## Why a separate backend?

GitHub Pages only serves static files — it can't run a database or handle
logins. This backend runs elsewhere (any Node host) and the static site talks
to it over the API, using CORS to allow only your site's origin.

## Local setup

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env`:
- `JWT_SECRET` — generate one with `openssl rand -hex 32`
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` — your admin login (used once, by the seed script)
- `ALLOWED_ORIGINS` — the origins allowed to call the API from a browser (your GitHub Pages URL / custom domain)

Then seed the database (creates the admin user and, if the products table is
empty, a few starter products):

```bash
npm run seed
```

Run the server:

```bash
npm start
```

- API: `http://localhost:4000/api/...`
- Admin dashboard: `http://localhost:4000/admin`

## Deploying

Any host that runs Node.js works (Render, Railway, Fly.io, a small VPS,
etc.). General steps, using **Render** as an example (has a free tier):

1. Push this repo to GitHub (already done).
2. In Render: **New → Web Service**, connect the repo, set the **Root
   Directory** to `backend`.
3. Build command: `npm install`. Start command: `npm start`.
4. Add environment variables from `.env.example` (`JWT_SECRET`,
   `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ALLOWED_ORIGINS`).
5. **Important:** SQLite is a file on disk. On most free hosts the
   filesystem is ephemeral (wiped on redeploy). Attach a **persistent disk**
   mounted at `backend/data` (Render calls this a "Disk") so your product
   and offer data survives deploys.
6. After first deploy, run the seed once — either via a one-off shell
   command on the host (`npm run seed`) or temporarily set it as the start
   command, run once, then switch back to `npm start`.
7. Note your deployed URL, e.g. `https://valorafrica-shop.onrender.com`.

## Connecting the storefront to your deployed API

Both `shop.html` and the shop preview on `index.html` read the API base URL
from a `window.VALOR_SHOP_API` global, which defaults to
`http://localhost:4000` for local testing. Once deployed, set this to your
real API URL by adding one line before the closing `</head>` tag (or right
before the existing `<script>` block) in `shop.html` and `index.html`:

```html
<script>window.VALOR_SHOP_API = 'https://your-deployed-backend.example.com';</script>
```

Also update `ALLOWED_ORIGINS` in the backend's environment variables to
include your GitHub Pages / custom domain, so the browser is allowed to call
the API (CORS).

## Managing the shop

1. Go to `https://your-deployed-backend.example.com/admin`
2. Log in with the admin username/password you set during seeding
3. **Merchandise tab** — add, edit, hide, or delete products. Prices are
   entered in KES (or whatever currency you use) and stored precisely as
   cents internally.
4. **Offers tab** — create an offer such as "10% off everything":
   - Discount type: Percent off (%) or Fixed amount off
   - Value: e.g. `10`
   - Applies to: All products, or a specific product
   - Optional start/end dates for time-limited sales
   - Toggle Active on/off any time

Active offers are automatically applied to matching product prices in the
public API — no code changes needed. The shop page also shows a small banner
when a sitewide offer is active.

## API reference (summary)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | — | Health check |
| GET | `/api/products?page=1&limit=6` | — | Paginated, active products with offers applied |
| GET | `/api/products/:id` | — | Single active product |
| GET | `/api/products/admin/all` | Admin | All products, including hidden |
| POST | `/api/products` | Admin | Create product |
| PUT | `/api/products/:id` | Admin | Update product |
| DELETE | `/api/products/:id` | Admin | Delete product |
| GET | `/api/offers/active` | — | Currently active offers |
| GET | `/api/offers` | Admin | All offers |
| POST | `/api/offers` | Admin | Create offer |
| PUT | `/api/offers/:id` | Admin | Update offer |
| DELETE | `/api/offers/:id` | Admin | Delete offer |
| POST | `/api/auth/login` | — | `{ username, password }` → `{ token }` |

## Security notes

- Change the default admin password immediately after first login (re-run
  `npm run seed` with a new `ADMIN_PASSWORD`, or add a password-change
  endpoint later).
- Keep `JWT_SECRET` private and never commit `.env` (already gitignored).
- Login attempts are rate-limited (8 attempts per 10 minutes per IP).
