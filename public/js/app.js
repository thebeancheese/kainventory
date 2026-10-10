// Frontend logic: talks to the API with fetch
const API = '/api/restaurants';
const $ = (sel) => document.querySelector(sel);

// Escape text to prevent HTML injection
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

// Toast icons
const ICONS = {
  ok: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  error: '<svg viewBox="0 0 24 24"><path d="M12 7v6m0 4h.01"/><circle cx="12" cy="12" r="9"/></svg>',
  delete: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 11v6m4-6v6M9 7l1-3h4l1 3m-9 0 1 13h8l1-13"/></svg>'
};

// Show a toast: ok, error or delete
function notify(title, message = '', type = 'ok') {
  const box = $('#toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `
    <span class="toast-icon">${ICONS[type] || ICONS.ok}</span>
    <div class="toast-body"><strong>${esc(title)}</strong>${message ? `<span>${esc(message)}</span>` : ''}</div>
    <button class="toast-close" aria-label="Dismiss">&times;</button>`;
  const close = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 250); };
  el.querySelector('.toast-close').addEventListener('click', close);
  box.appendChild(el);
  setTimeout(close, type === 'error' ? 6500 : 4500);
}

// Header: live database status pill (uses /api/stats). Shows red if the server or database is unreachable.
async function loadDbStatus() {
  const pill = $('#dbStatus');
  const text = $('#dbStatusText');
  if (!pill || !text) return;
  try {
    const res = await fetch('/api/stats');
    const s = await res.json();
    if (!res.ok) throw new Error(s.error);
    text.textContent = `${s.db} \u00b7 ${s.total.toLocaleString()} ${s.total === 1 ? 'restaurant' : 'restaurants'}`;
    pill.classList.remove('offline');
    pill.title = 'Connected to MongoDB';
  } catch {
    text.textContent = 'Database offline';
    pill.classList.add('offline');
    pill.title = 'Cannot reach MongoDB';
  }
}

// Homepage: load live stats
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const s = await res.json();
    $('#statTotal').textContent = s.total.toLocaleString();
    $('#statAvg').textContent = s.avgRating ?? 'n/a';
    $('#statCuisines').textContent = s.cuisines ?? 'n/a';
  } catch {
    ['#statTotal', '#statAvg', '#statCuisines'].forEach((id) => ($(id).textContent = 'n/a'));
  }
}

// Homepage: expandable detail panel for one restaurant (full address, contact, id, rating, date)
function detailsHtml(r) {
  const added = r.createdAt
    ? new Date(r.createdAt).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })
    : '-';
  return `
    <div class="details">
      <div><span>Address</span><strong>${esc(r.address || r.borough || '-')}</strong></div>
      <div><span>Contact</span><strong>${esc(r.contact || '-')}</strong></div>
      <div><span>Restaurant ID</span><strong>#${esc(r.restaurant_id)}</strong></div>
      <div><span>Rating</span><strong>${r.rating === null ? '-' : esc(Number(r.rating).toFixed(1)) + ' / 5'}</strong></div>
      <div><span>Added</span><strong>${esc(added)}</strong></div>
    </div>`;
}

// Click or press Enter/Space on a homepage row to show or hide its details
function makeExpandable(list) {
  list.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-expandable]');
    if (!li) return;
    const open = li.classList.toggle('open');
    li.setAttribute('aria-expanded', open);
  });
  list.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const li = e.target.closest('li[data-expandable]');
    if (!li) return;
    e.preventDefault();
    li.click();
  });
}

// Homepage: fill the "Top rated" list (uses /api/restaurants/top)
async function loadTopRated() {
  const list = $('#topRated');
  if (!list) return;
  try {
    const res = await fetch('/api/restaurants/top');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    list.innerHTML = data.map((r) => `
      <li data-expandable tabindex="0" role="button" aria-expanded="false" title="Click for details">
        <span class="top-name">${esc(r.name)}</span>
        <span class="pill">${cuisineIcon(r.cuisine)} ${esc(r.cuisine)}</span>
        <span class="top-place">${esc(r.address || r.borough)}</span>
        <span class="rating ${ratingClass(r.rating)}">${esc(Number(r.rating).toFixed(1))}</span>
        ${detailsHtml(r)}
      </li>`).join('');
    makeExpandable(list);
  } catch (err) {
    list.innerHTML = '<li>Could not load top rated restaurants.</li>';
  }
}

// Homepage: "Recently added" list (uses /api/restaurants/recent)
async function loadRecent() {
  const list = $('#recentList');
  if (!list) return;
  try {
    const res = await fetch('/api/restaurants/recent');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    list.innerHTML = data.map((r) => {
      const when = r.createdAt
        ? new Date(r.createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
        : '';
      return `
      <li data-expandable tabindex="0" role="button" aria-expanded="false" title="Click for details">
        <span class="recent-name">${esc(r.name)}</span>
        <span class="pill">${cuisineIcon(r.cuisine)} ${esc(r.cuisine)}</span>
        <span class="recent-date">${esc(when)}</span>
        ${detailsHtml(r)}
      </li>`;
    }).join('');
    makeExpandable(list);
  } catch (err) {
    list.innerHTML = '<li>Could not load recent restaurants.</li>';
  }
}

// Homepage: average rating per place (uses /api/stats/places)
async function loadPlaceStats() {
  const list = $('#cityStats');
  if (!list) return;
  try {
    const res = await fetch('/api/stats/places');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    list.innerHTML = data.map((p) => `
      <li data-expandable tabindex="0" role="button" aria-expanded="false" title="Click for details">
        <span class="city-name">${esc(p._id)}</span>
        <span class="bar" aria-hidden="true"><i style="width:${Math.min(Number(p.avgRating) / 5 * 100, 100)}%"></i></span>
        <span class="city-avg">${esc(Number(p.avgRating).toFixed(2))}</span>
        <span class="city-count">${esc(p.count)} ${p.count === 1 ? 'restaurant' : 'restaurants'}</span>
        <div class="details">
          <div><span>Full place</span><strong>${esc(p._id)}</strong></div>
          <div><span>Restaurants here</span><strong>${esc((p.names || []).join(', ') || '-')}</strong></div>
          <div><span>Best rating</span><strong>${esc(Number(p.bestRating).toFixed(1))} / 5</strong></div>
        </div>
      </li>`).join('');
    makeExpandable(list);
  } catch (err) {
    list.innerHTML = '<li>Could not load place stats.</li>';
  }
}

/* Admin login status */
let isAdmin = false;

async function checkAdminSession() {
  try {
    const res = await fetch('/api/admin/session', {
      credentials: 'same-origin',
      cache: 'no-store'
    });

    if (!res.ok) throw new Error('Session check failed.');

    const data = await res.json();
    isAdmin = data.loggedIn === true;
  } catch (err) {
    isAdmin = false;
    console.error('Could not check admin session:', err);
  }

  const addBtn = $('#addBtn');
  const adminLink = $('#adminLink');
  const logoutBtn = $('#logoutBtn');

  if (addBtn) addBtn.hidden = !isAdmin;
  if (adminLink) adminLink.hidden = isAdmin;
  if (logoutBtn) logoutBtn.hidden = !isAdmin;

  document.querySelectorAll('[data-action="edit"], [data-action="delete"]')
    .forEach(btn => {
      btn.hidden = !isAdmin;
    });
}

// Restaurant page state
const PAGE_SIZE = 10;
const state = { page: 1, pages: 1, search: '', editingId: null, rows: [], highlightId: null };

// Rating color tier
const ratingClass = (r) => (r >= 4.5 ? 'great' : r >= 4 ? 'good' : 'ok');

// READ: fetch a page and draw the table
async function loadRestaurants() {
  const params = new URLSearchParams({ page: state.page, limit: PAGE_SIZE, search: state.search });
  try {
    const res = await fetch(`${API}?${params}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);

    state.rows = body.data;
    state.pages = body.pages;
    state.page = body.page;
    renderTable(body);
  } catch (err) {
    console.error(err);
    $('#rows').innerHTML = `<tr><td colspan="7" class="empty">${esc(err.message || 'Could not load restaurants.')}</td></tr>`;
    $('#count').textContent = 'Could not reach the database';
  }
}

// Draw table rows and paging
function renderTable({ data, total, page, pages }) {
  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(page * PAGE_SIZE, total);
  $('#count').textContent = total
    ? `Showing ${from}-${to} of ${total.toLocaleString()} restaurants`
    : 'No restaurants found';
  $('#pageInfo').textContent = `Page ${page} of ${pages}`;
  $('#prev').disabled = page <= 1;
  $('#next').disabled = page >= pages;

  if (!data.length) {
    $('#rows').innerHTML = '<tr class="empty-row"><td colspan="7" class="empty">No restaurants match your search. Try a different name, place or ID, or add a new restaurant.</td></tr>';
    return;
  }

  $('#rows').innerHTML = data.map((r) => `
    <tr data-id="${esc(r._id)}" title="Click for details" class="${r._id === state.highlightId ? 'flash' : ''}">
      <td data-label="ID"><span class="id">#${esc(r.restaurant_id)}</span></td>
      <td data-label="Restaurant" class="name-cell">
        <span class="avatar" aria-hidden="true">${esc((r.name || '?').charAt(0).toUpperCase())}</span>
        <span class="strong">${esc(r.name)}</span>
      </td>
      <td data-label="Cuisine"><span class="pill">${cuisineIcon(r.cuisine)} ${esc(r.cuisine)}</span></td>
      <td data-label="Place">${esc(r.address || r.borough) || '-'}</td>
      <td data-label="Rating">${r.rating === null ? '-' : `<span class="rating ${ratingClass(r.rating)}">${esc(r.rating.toFixed(1))}</span>`}</td>
      <td data-label="Contact">${esc(r.contact) || '-'}</td>
      ${isAdmin ? `
        <td class="right actions">
          <button class="link" data-action="edit" data-id="${esc(r._id)}">Edit</button>
          <button class="link danger" data-action="delete" data-id="${esc(r._id)}">Delete</button>
        </td>
      ` : '<td class="right actions">View only</td>'}
    </tr>`).join('');

  state.highlightId = null;
}

// Restaurants page: cuisine chips with counts (uses /api/cuisines).
// Clicking a chip types the cuisine into the search box to filter the list.
async function loadCuisineChips() {
  const box = $('#cuisineChips');
  const search = $('#search');
  if (!box || !search) return;
  try {
    const res = await fetch('/api/cuisines');
    const list = await res.json();
    if (!res.ok) throw new Error(list.error);

    box.innerHTML = list.map((c) => `
      <button type="button" class="chip" data-cuisine="${esc(c._id)}">
        ${cuisineIcon(c._id)} ${esc(c._id)} <span class="chip-count">${c.count}</span>
      </button>`).join('');

    box.onclick = (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const wasActive = chip.classList.contains('active');
      box.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      if (!wasActive) chip.classList.add('active');
      search.value = wasActive ? '' : chip.dataset.cuisine;
      state.search = search.value.trim();
      state.page = 1;
      loadRestaurants();
    };
  } catch (err) {
    console.error(err);
  }
}
let originalFormData = '';

function getFormData() {
  const form = $('#restaurantForm');

  return JSON.stringify({
    name: form.elements.namedItem('name').value,
    cuisine: form.elements.namedItem('cuisine').value,
    address: form.elements.namedItem('address').value,
    rating: form.elements.namedItem('rating').value,
    contact: form.elements.namedItem('contact').value
  });
}

function closeRestaurantForm() {
  const form = $('#restaurantForm');

  if (form.dataset.saving === 'true') return;

  if (getFormData() !== originalFormData) {
    const discard = confirm('You have unsaved changes. Discard them?');

    if (!discard) return;
  }

  $('#formDialog').close();
}
// Open the form (blank to add, filled to edit)
function openForm(restaurant = null) {
  const form = $('#restaurantForm');
  form.reset();
  $('#formError').textContent = '';
  state.editingId = restaurant ? restaurant._id : null;
  $('#formTitle').textContent = restaurant ? 'Edit restaurant' : 'Add restaurant';

  if (restaurant) {
    form.name.value = restaurant.name;
    form.cuisine.value = restaurant.cuisine;
    form.address.value = restaurant.address || restaurant.borough;
    form.rating.value = restaurant.rating ?? '';
    form.contact.value = restaurant.contact;
  }
  originalFormData = getFormData();

  $('#formDialog').showModal();
  form.name.focus();
}

function validateRestaurant(payload) {
  const name = payload.name.trim();
  const cuisine = payload.cuisine.trim();
  const address = payload.address.trim();
  const rating = payload.rating.trim();
  const contact = payload.contact.trim();

  if (!name) return 'Restaurant name is required.';
  if (!cuisine) return 'Cuisine is required.';

  if (name.length > 100) return 'Restaurant name must be 100 characters or fewer.';
  if (cuisine.length > 60) return 'Cuisine must be 60 characters or fewer.';
  if (address.length > 200) return 'Address must be 200 characters or fewer.';
  if (contact.length > 30) return 'Contact number must be 30 characters or fewer.';

  if (rating !== '') {
    const number = Number(rating);

    if (!Number.isFinite(number) || number < 0 || number > 5) {
      return 'Rating must be between 0 and 5.';
    }

    if (!Number.isInteger(number * 10)) {
      return 'Rating must use increments of 0.1.';
    }
  }

  return '';
}

// CREATE / UPDATE: send the form to the API
async function saveRestaurant(event) {
  event.preventDefault();

  const form = event.target;

  if (form.dataset.saving === 'true') return;
  const payload = {
    name: form.name.value,
    cuisine: form.cuisine.value,
    address: form.address.value,
    rating: form.rating.value,
    contact: form.contact.value
  };

  const name = payload.name.trim();
  const editing = Boolean(state.editingId);

  const error = validateRestaurant(payload);

  if (error) {
    $('#formError').textContent = error;
    return;
  }

  $('#formError').textContent = '';

  const saveBtn = $('#saveBtn');
  const originalText = saveBtn.textContent;
  form.dataset.saving = 'true';
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  saveBtn.setAttribute('aria-busy', 'true');


  try {
    const res = await fetch(editing ? `${API}/${state.editingId}` : API, {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);

    $('#formDialog').close();
    state.highlightId = editing ? state.editingId : String(body._id);

    if (editing) {
      notify('Restaurant updated', `"${name}" was saved.`, 'ok');
    } else {
      notify('Restaurant added', `"${name}" is now in the database.`, 'ok');
      state.search = name;
      $('#search').value = name;
      state.page = 1;
    }
    loadRestaurants();
    loadDbStatus();
    loadCuisineChips();
  } catch (err) {
    const message = err.message || 'Something went wrong. Please try again.';

    $('#formError').textContent = message;

    notify(
      'Restaurant not saved',
      message,
      'error'
    );
  } finally {
    form.dataset.saving = 'false';
    saveBtn.disabled = false;
    saveBtn.textContent = originalText;
    saveBtn.removeAttribute('aria-busy');
  }
}

// Confirm dialog before deleting
function askDelete(name) {
  return new Promise((resolve) => {
    const dlg = $('#confirmDialog');
    $('#confirmText').textContent = `"${name}" will be removed from the database. This cannot be undone.`;
    const done = (answer) => { dlg.close(); resolve(answer); };
    $('#confirmYes').onclick = () => done(true);
    $('#confirmNo').onclick = () => done(false);
    dlg.oncancel = () => resolve(false);
    dlg.showModal();
    $('#confirmNo').focus();
  });
}

// DELETE: confirm, then remove
async function deleteRestaurant(id) {
  const target = state.rows.find((r) => r._id === id);
  const name = target ? target.name : 'this restaurant';
  if (!(await askDelete(name))) return;
  try {
    const res = await fetch(`${API}/${id}`, { method: 'DELETE' });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    notify(
      'Restaurant deleted successfully',
      `"${name}" has been removed from the directory.`,
      'delete'
    );
    if (state.rows.length === 1 && state.page > 1) state.page -= 1;
    loadRestaurants();
    loadDbStatus();
    loadCuisineChips();
  } catch (err) {
    notify('Could not delete', err.message || 'Please try again.', 'error');
  }
}

// Popup with the full details of one restaurant (built on first use, no extra HTML needed)
function showDetails(r) {
  let dlg = $('#detailDialog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'detailDialog';
    dlg.className = 'detail-card';
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    document.body.appendChild(dlg);
  }
  const added = r.createdAt
    ? new Date(r.createdAt).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })
    : '-';
  dlg.innerHTML = `
    <div class="detail-head">
      <span class="avatar big" aria-hidden="true">${esc((r.name || '?').charAt(0).toUpperCase())}</span>
      <div class="detail-title">
        <h2>${esc(r.name)}</h2>
        <span class="pill">${cuisineIcon(r.cuisine)} ${esc(r.cuisine)}</span>
      </div>
      ${r.rating === null ? '' : `<span class="rating ${ratingClass(r.rating)}">${esc(r.rating.toFixed(1))}</span>`}
    </div>
    <dl class="detail-list">
      <div><dt>Address</dt><dd>${esc(r.address || r.borough || '-')}</dd></div>
      <div><dt>Contact</dt><dd>${esc(r.contact || '-')}</dd></div>
      <div><dt>Restaurant ID</dt><dd>#${esc(r.restaurant_id)}</dd></div>
      <div><dt>Added</dt><dd>${esc(added)}</dd></div>
    </dl>
    <div class="form-actions">
      <button type="button" class="btn ghost" data-close>Close</button>
      ${isAdmin ? '<button type="button" class="btn" data-edit>Edit restaurant</button>' : ''}
    </div>`;
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  const editBtn = dlg.querySelector('[data-edit]');

  if (editBtn) {
    editBtn.onclick = () => {
      dlg.close();
      openForm(r);
    };
  }
  dlg.showModal();
}

// Wire up the restaurant page
function initRestaurantPage() {
  $('#addBtn').addEventListener('click', () => openForm());
  $('#cancelBtn').addEventListener('click', closeRestaurantForm);
  $('#formDialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    closeRestaurantForm();
  });
  $('#restaurantForm').addEventListener('submit', saveRestaurant);

  // Search with a short typing delay
  let timer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.search = e.target.value.trim(); state.page = 1; loadRestaurants(); }, 300);
  });

  $('#prev').addEventListener('click', () => { state.page -= 1; loadRestaurants(); });
  $('#next').addEventListener('click', () => { state.page += 1; loadRestaurants(); });

  // Edit and delete buttons in the table
  $('#rows').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) {
      // Click anywhere else on a row: open the details popup
      const row = e.target.closest('tr[data-id]');
      const r = row && state.rows.find((x) => x._id === row.dataset.id);
      if (r) showDetails(r);
      return;
    }
    const id = btn.dataset.id;
    if (btn.dataset.action === 'edit') openForm(state.rows.find((r) => r._id === id));
    if (btn.dataset.action === 'delete') deleteRestaurant(id);
  });

  document.querySelectorAll('dialog').forEach((dlg) =>
    dlg.addEventListener('click', (e) => {
      if (e.target !== dlg) return;

      if (dlg.id === 'formDialog') {
        closeRestaurantForm();
      } else {
        dlg.close();
      }
    })
  );

  checkAdminSession().then(() => {
    loadRestaurants();
    loadCuisineChips();
  });
  const logoutBtn = $('#logoutBtn');

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/admin/logout', {
          method: 'POST',
          credentials: 'same-origin'
        });

        if (!res.ok) throw new Error('Could not log out.');

        window.location.href = 'login.html';
      } catch (err) {
        notify('Logout failed', err.message, 'error');
      }
    });
  }
  // Header "Add restaurant" link (restaurants.html#add) opens the form straight away
  if (location.hash === '#add') openForm();
}

// Contact form submit
function initContactPage() {
  const form = $('#contactForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#sendBtn');

    if (btn.disabled) return;

    const originalText = btn.textContent;

    $('#contactError').textContent = '';
    btn.disabled = true;
    btn.textContent = 'Sending...';
    btn.setAttribute('aria-busy', 'true');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name.value, email: form.email.value, message: form.message.value })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      notify('Message sent', `Thanks, ${form.name.value.trim()}. We got your message.`, 'ok');
      form.reset();
    } catch (err) {
      $('#contactError').textContent = err.message || 'Could not send. Try again.';
      notify('Message not sent', err.message || 'Please try again.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
      btn.removeAttribute('aria-busy');
    }
  });
}

// Run what this page needs
loadDbStatus();
if ($('#statTotal')) loadStats();
if ($('#topRated')) loadTopRated();
if ($('#recentList')) loadRecent();
if ($('#cityStats')) loadPlaceStats();
if ($('#rows')) initRestaurantPage();
if ($('#contactForm')) initContactPage();
