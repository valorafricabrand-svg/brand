require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET is not set in .env — refusing to start for security reasons.');
  process.exit(1);
}

const productsRouter = require('./routes/products');
const offersRouter = require('./routes/offers');
const authRouter = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 4000;

// Allow your GitHub Pages site (and localhost while developing) to call this API.
// Set ALLOWED_ORIGINS in .env as a comma-separated list, e.g.:
// ALLOWED_ORIGINS=https://valorafrica.co.ke,https://valorafricabrand-svg.github.io
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // allow no-origin requests (curl, server-to-server) and any explicitly allowed origin
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error('Not allowed by CORS'));
    }
  })
);
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRouter);
app.use('/api/products', productsRouter);
app.use('/api/offers', offersRouter);

// Serve the built-in admin dashboard at /admin
app.use('/admin', express.static(path.join(__dirname, '..', 'public', 'admin')));

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`Valor Africa shop backend running on http://localhost:${PORT}`);
  console.log(`Admin dashboard: http://localhost:${PORT}/admin`);
});
