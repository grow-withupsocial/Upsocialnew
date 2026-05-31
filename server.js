const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ========== KORAPAY CONFIG ==========
const KORAPAY_SECRET_KEY = process.env.KORAPAY_SECRET_KEY || 'your-secret-key';
const KORAPAY_PUBLIC_KEY = process.env.KORAPAY_PUBLIC_KEY || 'your-public-key';
const KORAPAY_BASE_URL = 'https://api.korapay.com/merchant/api/v1';

app.use(cors({
  origin: [
    'https://grow-withupsocial.github.io',
    'http://localhost:5500',
    'http://localhost:3000'
  ]
}));

app.use(express.json());

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ========== AUTO-CREATE TABLES ==========
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
        phone VARCHAR(20),
        country VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Wallets table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wallets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE REFERENCES users(id),
        balance DECIMAL(10,2) DEFAULT 0,
        spent DECIMAL(10,2) DEFAULT 0,
        total_topup DECIMAL(10,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Transactions table (for payment history)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        type VARCHAR(20) NOT NULL DEFAULT 'deposit',
        amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        reference VARCHAR(100) UNIQUE NOT NULL,
        payment_reference VARCHAR(100),
        description TEXT,
        metadata JSONB DEFAULT '{}',
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

// ========== HEALTH CHECK ==========
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
    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash, phone, country) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, email, balance',
      [username, email, hash, phone || null, country || null]
    );
    
    const user = result.rows[0];
    await pool.query('INSERT INTO wallets (user_id, balance) VALUES ($1, $2)', [user.id, 0]);
    
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
    if (result.rows.length === 0) return res.status(400).json({ error: 'User not found' });
    
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(400).json({ error: 'Wrong password' });
    
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'your-secret-key');
    res.json({ 
      token, 
      user: { 
        id: user.id, 
        username: user.username, 
        email: user.email, 
        balance: user.balance,
        phone: user.phone || null,
        country: user.country || null
      } 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== USER PROFILE ==========
app.get('/api/user/profile', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, email, phone, country, balance, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/user/profile', authMiddleware, async (req, res) => {
  const { username, phone, country } = req.body;
  try {
    const result = await pool.query(
      'UPDATE users SET username = COALESCE($1, username), phone = COALESCE($2, phone), country = COALESCE($3, country), updated_at = CURRENT_TIMESTAMP WHERE id = $4 RETURNING *',
      [username || null, phone || null, country || null, req.user.id]
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

// ========== WALLET ROUTES ==========
app.get('/api/wallet', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
    res.json({ balance: parseFloat(result.rows[0].balance) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wallet/add', authMiddleware, async (req, res) => {
  const { amount } = req.body;
  try {
    await pool.query('UPDATE users SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [amount, req.user.id]);
    await pool.query('UPDATE wallets SET balance = balance + $1, total_topup = total_topup + $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2', [amount, req.user.id]);
    const result = await pool.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
    res.json({ balance: parseFloat(result.rows[0].balance) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wallet/deduct', authMiddleware, async (req, res) => {
  const { amount } = req.body;
  try {
    const checkResult = await pool.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
    if (parseFloat(checkResult.rows[0].balance) < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    await pool.query('UPDATE users SET balance = balance - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [amount, req.user.id]);
    await pool.query('UPDATE wallets SET spent = spent + $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2', [amount, req.user.id]);
    const result = await pool.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
    res.json({ balance: parseFloat(result.rows[0].balance) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== KORAPAY PAYMENT ROUTES ==========

// Initialize payment (called from frontend)
app.post('/api/payment/initialize', authMiddleware, async (req, res) => {
  const { amount } = req.body;
  
  if (!amount || amount < 100) {
    return res.status(400).json({ error: 'Minimum amount is ₦100' });
  }

  const reference = 'UPS-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6).toUpperCase();

  try {
    // Get user details
    const userResult = await pool.query('SELECT username, email FROM users WHERE id = $1', [req.user.id]);
    const user = userResult.rows[0];

    // Log pending transaction
    await pool.query(
      'INSERT INTO transactions (user_id, type, amount, status, reference, description) VALUES ($1, $2, $3, $4, $5, $6)',
      [req.user.id, 'deposit', amount, 'pending', reference, 'Wallet funding via Korapay']
    );

    res.json({
      success: true,
      reference,
      amount: parseFloat(amount),
      currency: 'NGN',
      publicKey: KORAPAY_PUBLIC_KEY,
      customer: {
        name: user.username,
        email: user.email
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify payment status (called from frontend after payment)
app.get('/api/payment/verify/:reference', authMiddleware, async (req, res) => {
  const { reference } = req.params;
  
  try {
    // Check if already processed
    const txnResult = await pool.query('SELECT * FROM transactions WHERE reference = $1', [reference]);
    if (txnResult.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    const txn = txnResult.rows[0];
    
    // If already success, return current balance
    if (txn.status === 'success') {
      const userResult = await pool.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
      return res.json({ 
        status: 'success', 
        amount: parseFloat(txn.amount),
        balance: parseFloat(userResult.rows[0].balance)
      });
    }

    // Verify with Korapay API
    const verifyResponse = await fetch(`${KORAPAY_BASE_URL}/charges/${reference}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${KORAPAY_SECRET_KEY}`
      }
    });

    if (!verifyResponse.ok) {
      return res.json({ status: 'pending', message: 'Payment still processing' });
    }

    const verifyData = await verifyResponse.json();
    
    if (verifyData.status && verifyData.data?.status === 'success') {
      // Auto-fund wallet
      await pool.query('BEGIN');
      
      await pool.query(
        'UPDATE users SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [txn.amount, txn.user_id]
      );
      
      await pool.query(
        'UPDATE wallets SET balance = balance + $1, total_topup = total_topup + $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
        [txn.amount, txn.user_id]
      );
      
      await pool.query(
        'UPDATE transactions SET status = $1, payment_reference = $2, updated_at = CURRENT_TIMESTAMP WHERE reference = $3',
        ['success', verifyData.data.reference || reference, reference]
      );
      
      await pool.query('COMMIT');
      
      const userResult = await pool.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
      return res.json({ 
        status: 'success', 
        amount: parseFloat(txn.amount),
        balance: parseFloat(userResult.rows[0].balance)
      });
    }

    res.json({ status: verifyData.data?.status || 'pending', message: verifyData.message });
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// ========== KORAPAY WEBHOOK ==========
app.post('/api/webhook/korapay', async (req, res) => {
  // Immediately acknowledge receipt
  res.status(200).send('OK');

  try {
    const signature = req.headers['x-korapay-signature'];
    const payload = req.body;
    
    // Verify webhook signature
    if (signature && KORAPAY_SECRET_KEY !== 'your-secret-key') {
      const hash = crypto
        .createHmac('sha256', KORAPAY_SECRET_KEY)
        .update(JSON.stringify(payload.data))
        .digest('hex');
      
      if (hash !== signature) {
        console.log('❌ Invalid webhook signature');
        return;
      }
    }

    const event = payload.event;
    const data = payload.data;

    if (event !== 'charge.success') {
      console.log('ℹ️ Ignoring non-success event:', event);
      return;
    }

    const reference = data.payment_reference; // Your custom reference
    const amount = parseFloat(data.amount);

    // Find transaction
    const txnResult = await pool.query('SELECT * FROM transactions WHERE reference = $1', [reference]);
    if (txnResult.rows.length === 0) {
      console.log('❌ Transaction not found:', reference);
      return;
    }

    const txn = txnResult.rows[0];

    // Skip if already processed
    if (txn.status === 'success') {
      console.log('ℹ️ Transaction already processed:', reference);
      return;
    }

    // Auto-fund wallet
    await pool.query('BEGIN');
    
    await pool.query(
      'UPDATE users SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [amount, txn.user_id]
    );
    
    await pool.query(
      'UPDATE wallets SET balance = balance + $1, total_topup = total_topup + $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
      [amount, txn.user_id]
    );
    
    await pool.query(
      'UPDATE transactions SET status = $1, payment_reference = $2, metadata = $3, updated_at = CURRENT_TIMESTAMP WHERE reference = $4',
      ['success', data.reference, JSON.stringify(data), reference]
    );
    
    await pool.query('COMMIT');
    
    console.log('✅ Wallet auto-funded:', { reference, amount, user_id: txn.user_id });
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => {});
    console.error('❌ Webhook processing error:', err.message);
  }
});

// ========== TRANSACTION HISTORY ==========
app.get('/api/transactions', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== ADMIN ROUTES ==========
app.get('/api/admin/stats', async (req, res) => {
  try {
    const usersResult = await pool.query('SELECT COUNT(*) as count FROM users');
    const ordersResult = await pool.query('SELECT COUNT(*) as count FROM orders');
    const revenueResult = await pool.query('SELECT COALESCE(SUM(price), 0) as total FROM orders WHERE status = $1', ['completed']);
    const completedResult = await pool.query('SELECT COUNT(*) as count FROM orders WHERE status = $1', ['completed']);
    const pendingResult = await pool.query('SELECT COUNT(*) as count FROM orders WHERE status = $1', ['pending']);
    const processingResult = await pool.query('SELECT COUNT(*) as count FROM orders WHERE status = $1', ['processing']);
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

app.get('/api/admin/users', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const result = await pool.query(
      'SELECT id, username, email, phone, country, balance, created_at, \'active\' as status FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/orders', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const result = await pool.query(
      `SELECT o.id, o.user_id, o.service, o.link, o.quantity, o.status, o.price, o.created_at, u.username, u.email as user_email 
       FROM orders o JOIN users u ON o.user_id = u.id ORDER BY o.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/wallets', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const result = await pool.query(
      `SELECT u.username, u.email, u.balance, COALESCE(w.spent, 0) as spent, COALESCE(w.total_topup, 0) as total_topup, 
       COALESCE(w.updated_at, u.created_at) as updated_at, u.created_at 
       FROM users u LEFT JOIN wallets w ON u.id = w.user_id ORDER BY u.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/orders/status', async (req, res) => {
  try {
    const { orderId, status } = req.body;
    if (!orderId || !status) return res.status(400).json({ error: 'orderId and status required' });
    const result = await pool.query(
      'UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [status, orderId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    res.json({ success: true, order: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/users/balance', async (req, res) => {
  try {
    const { email, balance } = req.body;
    if (!email || balance === undefined) return res.status(400).json({ error: 'email and balance required' });
    const result = await pool.query(
      'UPDATE users SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE email = $2 RETURNING *',
      [balance, email]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    await pool.query('UPDATE wallets SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2', [balance, result.rows[0].id]);
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    await pool.query('DELETE FROM wallets WHERE user_id = $1', [userId]).catch(() => {});
    await pool.query('DELETE FROM orders WHERE user_id = $1', [userId]).catch(() => {});
    await pool.query('DELETE FROM transactions WHERE user_id = $1', [userId]).catch(() => {});
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING *', [userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
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
  console.log(`💳 Korapay Webhook URL: https://your-domain.com/api/webhook/korapay`);
});

