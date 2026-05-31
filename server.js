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
        phone VARCHAR(20),
        country VARCHAR(50),
        balance DECIMAL(10,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        service VARCHAR(100) NOT NULL,
        link TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        price DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS wallets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        balance DECIMAL(10,2) DEFAULT 0,
        spent DECIMAL(10,2) DEFAULT 0,
        total_topup DECIMAL(10,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

// ========== AUTH ROUTES ==========
app.post('/api/auth/signup', async (req, res) => {
  const { username, email, password, phone, country } = req.body;
  
  try {
    const hash = await bcrypt.hash(password, 10);
    
    // Insert user
    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash, phone, country) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, email, balance',
      [username, email, hash, phone || null, country || null]
    );
    
    const user = result.rows[0];
    
    // Create wallet for user
    await pool.query(
      'INSERT INTO wallets (user_id, balance) VALUES ($1, $2)',
      [user.id, 0]
    );
    
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'your-secret-key');
    res.json({ token, user });
  } catch (err) {
    res.status(400).json({ error: err.message.includes('duplicate') ? 'Username or email exists' : err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'User not found' });
    }
    
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    
    if (!valid) {
      return res.status(400).json({ error: 'Wrong password' });
    }
    
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'your-secret-key');
    res.json({ 
      token, 
      user: { 
        id: user.id, 
        username: user.username, 
        email: user.email, 
        balance: user.balance,
        phone: user.phone,
        country: user.country
      } 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== USER PROFILE ROUTES ==========
app.get('/api/user/profile', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, email, phone, country, balance, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/user/profile', authMiddleware, async (req, res) => {
  const { username, phone, country } = req.body;
  
  try {
    const result = await pool.query(
      'UPDATE users SET username = $1, phone = $2, country = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 RETURNING *',
      [username, phone, country, req.user.id]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== ORDER ROUTES ==========
app.get('/api/orders', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders', authMiddleware, async (req, res) => {
  const { service, link, quantity } = req.body;
  
  try {
    const price = quantity * 0.01;
    const result = await pool.query(
      'INSERT INTO orders (user_id, service, link, quantity, price, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [req.user.id, service, link, quantity, price, 'pending']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orders/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== WALLET ROUTES ==========
app.get('/api/wallet', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT balance FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json({ balance: parseFloat(result.rows[0].balance) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wallet/add', authMiddleware, async (req, res) => {
  const { amount } = req.body;
  
  try {
    // Update user balance
    await pool.query(
      'UPDATE users SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [amount, req.user.id]
    );
    
    // Update wallet total_topup
    await pool.query(
      'UPDATE wallets SET balance = balance + $1, total_topup = total_topup + $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
      [amount, req.user.id]
    );
    
    const result = await pool.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
    res.json({ balance: parseFloat(result.rows[0].balance) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wallet/deduct', authMiddleware, async (req, res) => {
  const { amount } = req.body;
  
  try {
    // Check balance
    const checkResult = await pool.query(
      'SELECT balance FROM users WHERE id = $1',
      [req.user.id]
    );
    
    if (parseFloat(checkResult.rows[0].balance) < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    
    // Update user balance
    await pool.query(
      'UPDATE users SET balance = balance - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [amount, req.user.id]
    );
    
    // Update wallet spent
    await pool.query(
      'UPDATE wallets SET spent = spent + $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
      [amount, req.user.id]
    );
    
    const result = await pool.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
    res.json({ balance: parseFloat(result.rows[0].balance) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== ADMIN API ROUTES ==========

// GET /api/admin/stats - Dashboard overview statistics
app.get('/api/admin/stats', async (req, res) => {
  try {
    const usersResult = await pool.query('SELECT COUNT(*) as count FROM users');
    const ordersResult = await pool.query('SELECT COUNT(*) as count FROM orders');
    const revenueResult = await pool.query(
      'SELECT COALESCE(SUM(price), 0) as total FROM orders WHERE status = $1',
      ['completed']
    );
    const completedResult = await pool.query(
      'SELECT COUNT(*) as count FROM orders WHERE status = $1',
      ['completed']
    );
    const pendingResult = await pool.query(
      'SELECT COUNT(*) as count FROM orders WHERE status = $1',
      ['pending']
    );
    const processingResult = await pool.query(
      'SELECT COUNT(*) as count FROM orders WHERE status = $1',
      ['processing']
    );
    const avgResult = await pool.query('SELECT COALESCE(AVG(price), 0) as avg FROM orders');

    res.json({
      total_users: parseInt(usersResult.rows[0].count),
      total_orders: parseInt(ordersResult.rows[0].count),
      total_revenue: parseFloat(revenueResult.rows[0].total),
      completed_orders: parseInt(completedResult.rows[0].count),
      pending_orders: parseInt(pendingResult.rows[0].count),
      processing_orders: parseInt(processingResult.rows[0].count),
      active_users: parseInt(usersResult.rows[0].count),
      avg_order_value: parseFloat(avgResult.rows[0].avg)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/users - List all users
app.get('/api/admin/users', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    
    const result = await pool.query(`
      SELECT 
        id, 
        username, 
        email, 
        phone,
        country,
        balance, 
        created_at,
        'active' as status
      FROM users 
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/orders - List all orders
app.get('/api/admin/orders', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    
    const result = await pool.query(`
      SELECT 
        o.id,
        o.user_id,
        o.service,
        o.link,
        o.quantity,
        o.status,
        o.price,
        o.created_at,
        u.username,
        u.email as user_email
      FROM orders o 
      JOIN users u ON o.user_id = u.id 
      ORDER BY o.created_at DESC 
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/wallets - List all user wallets
app.get('/api/admin/wallets', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    
    const result = await pool.query(`
      SELECT 
        u.username,
        u.email,
        u.balance,
        w.spent,
        w.total_topup,
        w.updated_at,
        u.created_at
      FROM users u
      LEFT JOIN wallets w ON u.id = w.user_id
      ORDER BY u.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/orders/status - Update order status
app.post('/api/admin/orders/status', async (req, res) => {
  try {
    const { orderId, status } = req.body;
    
    if (!orderId || !status) {
      return res.status(400).json({ error: 'orderId and status required' });
    }
    
    const result = await pool.query(
      'UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [status, orderId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    res.json({ success: true, order: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users/balance - Update user balance
app.post('/api/admin/users/balance', async (req, res) => {
  try {
    const { email, balance } = req.body;
    
    if (!email || balance === undefined) {
      return res.status(400).json({ error: 'email and balance required' });
    }
    
    const result = await pool.query(
      'UPDATE users SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE email = $2 RETURNING *',
      [balance, email]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Also update wallet
    await pool.query(
      'UPDATE wallets SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
      [balance, result.rows[0].id]
    );
    
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/users/:id - Delete user
app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    
    // Delete wallets first (has foreign key)
    await pool.query('DELETE FROM wallets WHERE user_id = $1', [userId]);
    
    // Delete orders
    await pool.query('DELETE FROM orders WHERE user_id = $1', [userId]);
    
    // Delete user
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING *', [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ success: true, message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== ERROR HANDLING ==========
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// START SERVER
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
