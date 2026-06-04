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
    ...(token && { 'Authorization': 'Bearer ' + token })
  };
}

// Sign up
async function signup(username, email, password, phone, country) {
  try {
    const response = await fetch(API_URL + '/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password, phone, country })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Signup failed');
    localStorage.setItem('token', data.token);
    localStorage.setItem('upsocial_user', JSON.stringify(data.user));
    localStorage.setItem('upsocial_loggedIn', 'true');
    localStorage.setItem('upsocial_currentUser', data.user.email);
    window.location.href = 'Dashboard.html';
  } catch (err) {
    alert(err.message);
  }
}

// Login
async function login(email, password) {
  try {
    const response = await fetch(API_URL + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Login failed');
    localStorage.setItem('token', data.token);
    localStorage.setItem('upsocial_user', JSON.stringify(data.user));
    localStorage.setItem('upsocial_loggedIn', 'true');
    localStorage.setItem('upsocial_currentUser', data.user.email);
    window.location.href = 'Dashboard.html';
  } catch (err) {
    alert(err.message);
  }
}

// Logout
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('upsocial_user');
  localStorage.removeItem('upsocial_loggedIn');
  localStorage.removeItem('upsocial_currentUser');
  window.location.href = 'index.html';
}

// ==================== ORDERS ====================

// Get user's orders from API
async function getOrders() {
  try {
    const response = await fetch(API_URL + '/orders', {
      headers: getHeaders()
    });
    if (!response.ok) throw new Error('Failed to load orders');
    return await response.json();
  } catch (err) {
    console.error(err);
    return [];
  }
}

// Create new order via API
async function createOrder(service, link, quantity) {
  try {
    const response = await fetch(API_URL + '/orders', {
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

// Get wallet balance from API
async function getBalance() {
  try {
    const response = await fetch(API_URL + '/wallet', {
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

// Get transaction history from API
async function getTransactions() {
  try {
    const response = await fetch(API_URL + '/transactions', {
      headers: getHeaders()
    });
    if (!response.ok) throw new Error('Failed to load transactions');
    return await response.json();
  } catch (err) {
    console.error(err);
    return [];
  }
}

// Add funds (mock - integrate real payment later)
async function addFunds(amount) {
  try {
    const response = await fetch(API_URL + '/wallet/add', {
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
  return 'N' + parseFloat(amount).toFixed(2);
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
  const userStr = localStorage.getItem('upsocial_user');
  const user = userStr ? JSON.parse(userStr) : {};
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
      const userStr = localStorage.getItem('upsocial_user');
      const user = userStr ? JSON.parse(userStr) : {};
      user.balance = balance;
      localStorage.setItem('upsocial_user', JSON.stringify(user));
      updateUserUI();
    });
  }

  // Protect dashboard pages
  const protectedPages = ['Dashboard.html', 'new-order.html', 'my-orders.html', 'wallet-history.html', 'profile.html'];
  const currentPage = window.location.pathname.split('/').pop();
  if (protectedPages.includes(currentPage) && !isLoggedIn()) {
    window.location.href = 'login.html';
  }
});
