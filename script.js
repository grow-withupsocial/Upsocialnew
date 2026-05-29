// CONFIG: Your Render API URL
const API_URL = 'https://upsocial-api.onrender.com/api';

// Helper: Show error message
function showError(msg) {
  const errorDiv = document.getElementById('error');
  if (errorDiv) {
    errorDiv.textContent = msg;
    errorDiv.classList.remove('hidden');
    setTimeout(() => errorDiv.classList.add('hidden'), 5000);
  }
}

// Helper: Escape HTML to prevent XSS
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Fetch all items from the database
async function loadItems() {
  const loading = document.getElementById('loading');
  const itemList = document.getElementById('itemList');
  
  if (loading) loading.style.display = 'block';
  
  try {
    const response = await fetch(`${API_URL}/items`);
    if (!response.ok) throw new Error('Failed to load items');
    const items = await response.json();
    renderItems(items);
  } catch (err) {
    showError(err.message);
  } finally {
    if (loading) loading.style.display = 'none';
  }
}

// Render items to the page
function renderItems(items) {
  const itemList = document.getElementById('itemList');
  if (!itemList) return;
  
  itemList.innerHTML = '';
  
  if (items.length === 0) {
    itemList.innerHTML = '<li style="text-align:center;color:#888;">No items yet. Add one above!</li>';
    return;
  }
  
  items.forEach(item => {
    const li = document.createElement('li');
    li.innerHTML = `
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.description || 'No description')}</p>
      <div class="actions">
        <button onclick="editItem(${item.id}, '${escapeHtml(item.title)}', '${escapeHtml(item.description || '')}')">Edit</button>
        <button class="delete-btn" onclick="deleteItem(${item.id})">Delete</button>
      </div>
    `;
    itemList.appendChild(li);
  });
}

// Add new item
async function addItem(title, description) {
  try {
    const response = await fetch(`${API_URL}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description })
    });
    if (!response.ok) throw new Error('Failed to add item');
    loadItems();
  } catch (err) {
    showError(err.message);
  }
}

// Delete item
async function deleteItem(id) {
  if (!confirm('Delete this item?')) return;
  try {
    const response = await fetch(`${API_URL}/items/${id}`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error('Failed to delete');
    loadItems();
  } catch (err) {
    showError(err.message);
  }
}

// Edit item
async function editItem(id, currentTitle, currentDesc) {
  const title = prompt('New title:', currentTitle);
  if (title === null) return;
  const description = prompt('New description:', currentDesc);
  if (description === null) return;

  try {
    const response = await fetch(`${API_URL}/items/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description })
    });
    if (!response.ok) throw new Error('Failed to update');
    loadItems();
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
