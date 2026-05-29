// CONFIG: Your Render API URL
const API_URL = 'https://upsocial-api.onrender.com/api';

// ==================== AUTH ====================

// Check if user is logged in
function isLoggedIn() {
  return !!localStorage.getItem('token');
}

// Get auth headers for API calls
function getHeaders() {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` })
  };
}

// Sign up
async function signup(username, email, password) {
  try {
    const response = await fetch(`${API_URL}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Signup failed');
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    window.location.href = 'dashboard.html';
  } catch (err) {
    alert(err.message);
  }
}

// Login
async function login(email, password) {
  try {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Login failed');
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    window.location.href = 'dashboard.html';
  } catch (err) {
    alert(err.message);
  }
}

// Logout
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = 'index.html';
}

// ==================== ORDERS ====================

// Get user's orders
async function getOrders() {
  try {
    const response = await fetch(`${API_URL}/orders`, {
      headers: getHeaders()
    });
    if (!response.ok) throw new Error('Failed to load orders');
    return await response.json();
  } catch (err) {
    console.error(err);
    return [];
  }
}

// Create new order
async function createOrder(service, link, quantity) {
  try {
    const response = await fetch(`${API_URL}/orders`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ service, link, quantity })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Order failed');
    return data;
  } catch (err) {
    alert(err.message);
    return null;
  }
}

// ==================== WALLET ====================

// Get wallet balance
async function getBalance() {
  try {
    const response = await fetch(`${API_URL}/wallet`, {
      headers: getHeaders()
    });
    if (!response.ok) throw new Error('Failed to load balance');
    const data = await response.json();
    return data.balance;
  } catch (err) {
    console.error(err);
    return 0;
  }
}

// Add funds (mock - integrate real payment later)
async function addFunds(amount) {
  try {
    const response = await fetch(`${API_URL}/wallet/add`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ amount })
    });
    if (!response.ok) throw new Error('Failed to add funds');
    return await response.json();
  } catch (err) {
    alert(err.message);
    return null;
  }
}

// ==================== UI HELPERS ====================

// Format currency
function formatCurrency(amount) {
  return '$' + parseFloat(amount).toFixed(2);
}

// Show loading
function showLoading(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'block';
}

// Hide loading
function hideLoading(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

// Update user info in header
function updateUserUI() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const userNameEl = document.getElementById('userName');
  const userBalanceEl = document.getElementById('userBalance');
  if (userNameEl) userNameEl.textContent = user.username || 'User';
  if (userBalanceEl) userBalanceEl.textContent = formatCurrency(user.balance || 0);
}

// ==================== INIT ====================

document.addEventListener('DOMContentLoaded', () => {
  // Update UI if logged in
  if (isLoggedIn()) {
    updateUserUI();
    getBalance().then(balance => {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      user.balance = balance;
      localStorage.setItem('user', JSON.stringify(user));
      updateUserUI();
    });
  }
  
  // Protect dashboard pages
  const protectedPages = ['dashboard.html', 'new-order.html', 'my-orders.html', 'wallet-history.html', 'profile.html'];
  const currentPage = window.location.pathname.split('/').pop();
  if (protectedPages.includes(currentPage) && !isLoggedIn()) {
    window.location.href = 'login.html';
  }
});
  } catch (err) {
    showError(err.message);
  }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
  // Load existing items
  loadItems();
  
  // Handle form submission
  const form = document.getElementById('itemForm');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = document.getElementById('title').value;
      const description = document.getElementById('description').value;
      addItem(title, description);
      form.reset();
    });
  }
});
