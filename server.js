const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
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

// AUTO-CREATE TABLES ON STARTUP
async function initDatabase() {
  try {
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

// AUTH MIDDLEWARE
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

// HEALTH CHECK
app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ status: 'OK', database: 'connected', time: result.rows[0] });
  } catch (err) {
    res.status(500).json({ status: 'ERROR', message: err.message });
  }
});

// AUTH ROUTES
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

// ORDER ROUTES
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

// WALLET ROUTES
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

// ========== ADMIN API ROUTES ==========

// GET /api/admin/stats - Dashboard overview
app.get('/api/admin/stats', async (req, res) => {
  try {
    const [users] = await pool.query('SELECT COUNT(*) as count FROM users');
    const [orders] = await pool.query('SELECT COUNT(*) as count FROM orders');
    const [revenue] = await pool.query('SELECT COALESCE(SUM(price), 0) as total FROM orders WHERE status = $1', ['completed']);
    const [completed] = await pool.query('SELECT COUNT(*) as count FROM orders WHERE status = $1', ['completed']);
    const [pending] = await pool.query('SELECT COUNT(*) as count FROM orders WHERE status = $1', ['pending']);
    const [processing] = await pool.query('SELECT COUNT(*) as count FROM orders WHERE status = $1', ['processing']);
    const [avg] = await pool.query('SELECT COALESCE(AVG(price), 0) as avg FROM orders');

    res.json({
      totalUsers: parseInt(users[0].count),
      totalOrders: parseInt(orders[0].count),
      totalRevenue: parseFloat(revenue[0].total),
      completedOrders: parseInt(completed[0].count),
      pendingOrders: parseInt(pending[0].count),
      processingOrders: parseInt(processing[0].count),
      activeUsers: parseInt(users[0].count),
      avgOrderValue: parseFloat(avg[0].avg)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/users - All users
app.get('/api/admin/users', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, username, email, balance, created_at as "joinDate", 'active' as status
      FROM users 
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/orders - All orders
app.get('/api/admin/orders', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const result = await pool.query(`
      SELECT o.*, u.username 
      FROM orders o 
      JOIN users u ON o.user_id = u.id 
      ORDER BY o.created_at DESC 
      LIMIT $1
    `, [limit]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/payments - All payments (user balances + deposits)
app.get('/api/admin/payments', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const result = await pool.query(`
      SELECT 
        u.username,
        u.email,
        u.balance,
        COALESCE((SELECT SUM(price) FROM orders WHERE user_id = u.id), 0) as spent,
        u.created_at as "joinDate"
      FROM users u
      ORDER BY u.created_at DESC
      LIMIT $1
    `, [limit]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users/balance - Update user balance
app.post('/api/admin/users/balance', async (req, res) => {
  try {
    const { email, balance } = req.body;
    await pool.query('UPDATE users SET balance = $1 WHERE email = $2', [balance, email]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/orders/status - Update order status
app.post('/api/admin/orders/status', async (req, res) => {
  try {
    const { orderId, status } = req.body;
    await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, orderId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// START SERVER
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
