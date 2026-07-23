require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./index');

function seedAdmin() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    console.log('⚠️  No ADMIN_PASSWORD set in .env — skipping admin seed.');
    console.log('   Set ADMIN_USERNAME and ADMIN_PASSWORD in .env, then re-run: npm run seed');
    return;
  }

  const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
  if (existing) {
    console.log(`Admin "${username}" already exists — updating password.`);
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE admins SET password_hash = ? WHERE username = ?').run(hash, username);
  } else {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(username, hash);
    console.log(`Created admin user "${username}".`);
  }
}

function seedProducts() {
  const count = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
  if (count > 0) {
    console.log(`Products table already has ${count} row(s) — skipping product seed.`);
    return;
  }

  const insert = db.prepare(`
    INSERT INTO products (name, description, price_cents, currency, image_url, active, stock)
    VALUES (@name, @description, @price_cents, @currency, @image_url, @active, @stock)
  `);

  const seedData = [
    {
      name: 'Valor Africa Tote Bag',
      description: 'Durable canvas tote with the Valor Africa emblem, hand-printed.',
      price_cents: 450000,
      currency: 'KES',
      image_url: '/images/one.jpg',
      active: 1,
      stock: null
    },
    {
      name: 'Community Print Tee',
      description: 'Soft cotton tee celebrating African entrepreneurship.',
      price_cents: 280000,
      currency: 'KES',
      image_url: '/images/IMG_0729.jpg',
      active: 1,
      stock: null
    },
    {
      name: 'Founder\u2019s Notebook',
      description: 'A5 hardcover notebook for brand-building notes and sketches.',
      price_cents: 620000,
      currency: 'KES',
      image_url: '/images/IMG_1212.jpg',
      active: 1,
      stock: null
    }
  ];

  const insertMany = db.transaction((rows) => {
    for (const row of rows) insert.run(row);
  });
  insertMany(seedData);
  console.log(`Seeded ${seedData.length} products.`);
}

seedAdmin();
seedProducts();
console.log('Seed complete.');
