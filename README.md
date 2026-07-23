# Valor Africa Brand Studio

Static landing page for Valor Africa, a brand studio, merch house, and community partner for African businesses.

## About

This site showcases Valor Africa's services in branding, merchandise, and community engagement.

## Files

- `index.html` — main landing page
- `404.html` — custom GitHub Pages fallback page
- `README.md` — project overview
- `favicon.svg` — site icon

## GitHub Pages

To publish this site on GitHub Pages, use the repository root as the publishing source.

## Contact

- Email: `hello@valorafrica.co.ke`
- Phone: `+254 113 665 283`
- Visit: `https://valorafrica.co.ke/contact`

## Image optimization (local)

This repo includes a Node-based image optimizer that resizes and writes WebP variants for faster loading.

1. Install Node (v16+) and `npm`.
2. From the project root run:

```powershell
npm install
npm run optimize-images
```

3. Optimized images are written to `images/optimized/w_<width>/` (e.g. `images/optimized/w_1024/`).

Notes:
- The optimizer uses `sharp`. Installing `sharp` will build native binaries for your platform.
- If you prefer ImageMagick, use the `mogrify` CLI or another tool — the Node script is provided for convenience.
## Shop backend & admin dashboard

The `backend-shop/` folder now contains a Node.js/Express API + admin dashboard
for managing merchandise and offers, plus a new `shop.html` page at the repo root
that shows a paginated product catalog pulling live from that API.

See `backend-shop/README.md` for setup, deployment, and how to connect
`shop.html` to your deployed backend.
## Laravel backend (scaffold helper)

We keep the frontend static site at the repository root. If you want a Laravel backend in the same workspace, follow these steps.

Prerequisites:
- PHP 8.1+ with common extensions (OpenSSL, PDO, Mbstring, Tokenizer, XML, Ctype, JSON, BCMath).
- Composer (https://getcomposer.org/)

Automated helper (PowerShell):

```powershell
# from the repository root
.\setup-laravel.ps1
```

Or use the Windows batch helper:

```bat
install-laravel.bat
```

What the helper does:
- Creates a new Laravel project in `backend/` using `composer create-project`.
- After creation, run the following inside `backend/`:

```powershell
copy .env.example .env
php artisan key:generate
# set APP_URL in .env (e.g. APP_URL=http://localhost:8000)
php artisan migrate --seed
php artisan serve --host=127.0.0.1 --port=8000
```

Security & VCS:
- The helper writes a `backend.gitignore` file at repository root. After Laravel scaffolding, move or copy it into `backend/.gitignore` before committing.

If you'd like, I can run these steps for you (requires Composer and PHP available in the environment). I can also scaffold a minimal API endpoint and a CORS configuration so the static frontend can call the Laravel API.

