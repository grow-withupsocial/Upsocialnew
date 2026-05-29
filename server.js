const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
// 👇 ADD THIS LINE (line 4)
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
// 👆 END ADD
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: [
    'https://grow-withupsocial.github.io',
    'http://localhost:5500'
  ]
}));

app.use(express.json());

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// AUTO-CREATE TABLE ON STARTUP
async function initDatabase() {
  try {
    // Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        balance DECIMAL(10,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Orders table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        service VARCHAR(100) NOT NULL,
        link TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        price DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('✅ Database tables ready');
  } catch (err) {
    console.error('❌ Database init error:', err.message);
  }
}

initDatabase();

// 👇 ADD THIS BLOCK HERE — after initDatabase(), before app.get('/api/health', ...)
// ========== AUTH MIDDLEWARE ==========
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ========== AUTH ROUTES ==========
app.post('/api/auth/signup', async (req, res) => {
  const { username, email, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  try {
    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, balance',
      [username, email, hash]
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'your-secret-key');
    res.json({ token, user });
  } catch (err) {
    res.status(400).json({ error: 'Username or email exists' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  if (result.rows.length === 0) return res.status(400).json({ error: 'User not found' });
  const user = result.rows[0];
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(400).json({ error: 'Wrong password' });
  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'your-secret-key');
  res.json({ token, user: { id: user.id, username: user.username, email: user.email, balance: user.balance } });
});

// ========== ORDER ROUTES ==========
app.get('/api/orders', authMiddleware, async (req, res) => {
  const result = await pool.query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
  res.json(result.rows);
});

app.post('/api/orders', authMiddleware, async (req, res) => {
  const { service, link, quantity } = req.body;
  const price = quantity * 0.01;
  const result = await pool.query(
    'INSERT INTO orders (user_id, service, link, quantity, price) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [req.user.id, service, link, quantity, price]
  );
  res.status(201).json(result.rows[0]);
});

// ========== WALLET ROUTES ==========
app.get('/api/wallet', authMiddleware, async (req, res) => {
  const result = await pool.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
  res.json({ balance: result.rows[0].balance });
});

app.post('/api/wallet/add', authMiddleware, async (req, res) => {
  const { amount } = req.body;
  await pool.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amount, req.user.id]);
  const result = await pool.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
  res.json({ balance: result.rows[0].balance });
});
// 👆 END OF BLOCK TO ADD

// Test connection
app.get('/api/health', async (req, res) => {
  // ... rest stays the same


// ... rest of your routes stay the same


// Test connection
app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ status: 'OK', database: 'connected', time: result.rows[0] });
  } catch (err) {
    res.status(500).json({ status: 'ERROR', message: err.message });
  }
});

// GET all items
app.get('/api/items', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM items ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single item
app.get('/api/items/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM items WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CREATE item
app.post('/api/items', async (req, res) => {
  try {
    const { title, description } = req.body;
    const result = await pool.query(
      'INSERT INTO items (title, description) VALUES ($1, $2) RETURNING *',
      [title, description]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE item
app.put('/api/items/:id', async (req, res) => {
  try {
    const { title, description } = req.body;
    await pool.query(
      'UPDATE items SET title = $1, description = $2 WHERE id = $3',
      [title, description, req.params.id]
    );
    res.json({ message: 'Updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE item
app.delete('/api/items/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM items WHERE id = $1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
