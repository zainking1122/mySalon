const loginView = document.querySelector('#login-view');
const dashboardView = document.querySelector('#dashboard-view');
const loginForm = document.querySelector('#login-form');
const loginStatus = document.querySelector('#login-status');
const dashboardStatus = document.querySelector('#dashboard-status');
const logoutButton = document.querySelector('#logout-button');
const appointmentsBody = document.querySelector('#appointments-body');
const settingsForm = document.querySelector('#settings-form');
const settingsStatus = document.querySelector('#settings-status');
const servicesForm = document.querySelector('#services-form');
const servicesStatus = document.querySelector('#services-status');
const ownerServiceLists = document.querySelector('#owner-service-lists');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character]));
}

function showDashboard(appointments) {
  loginView.hidden = true;
  dashboardView.hidden = false;
  logoutButton.hidden = false;
  appointmentsBody.innerHTML = appointments.length
    ? appointments.slice().reverse().map((appointment) => `<tr><td>${escapeHtml(appointment.date)}</td><td>${escapeHtml(appointment.time)}</td><td>${escapeHtml(appointment.name)}</td><td>${escapeHtml(appointment.phone)}</td><td>${escapeHtml(appointment.email || 'Not provided')}</td><td>${escapeHtml(appointment.service)}</td><td>${escapeHtml(appointment.audience)}</td></tr>`).join('')
    : '<tr><td colspan="7">No appointments in the last 30 days.</td></tr>';
}

async function loadAppointments() {
  const response = await fetch('/api/owner/appointments');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Unable to load appointments.');
  showDashboard(data);
}

function renderOwnerServices(catalog) {
  if (!ownerServiceLists) return;
  const categories = { men: 'Men', women: 'Women', baby: 'Baby' };
  ownerServiceLists.innerHTML = Object.entries(categories).map(([category, label]) => {
    const services = Array.isArray(catalog?.[category]) ? catalog[category] : [];
    const rows = services.map((service, index) => `
      <div class="service-editor-row" data-category="${category}">
        <input type="text" name="${category}-name-${index}" value="${escapeHtml(service.name || '')}" aria-label="${label} service name ${index + 1}" />
        <input type="text" name="${category}-price-${index}" value="${escapeHtml(service.price || '')}" aria-label="${label} service price ${index + 1}" />
        <button type="button" class="button button-light remove-service" data-category="${category}" data-index="${index}">Remove</button>
      </div>
    `).join('');

    return `
      <div class="service-editor-category">
        <div class="service-editor-header">
          <h3>${label}</h3>
          <button type="button" class="button button-light add-service" data-category="${category}">Add service</button>
        </div>
        <div class="service-editor-list">${rows || '<p class="empty-state">No services yet.</p>'}</div>
      </div>
    `;
  }).join('');

  ownerServiceLists.querySelectorAll('.add-service').forEach((button) => {
    button.addEventListener('click', () => {
      const category = button.dataset.category;
      const list = button.closest('.service-editor-category').querySelector('.service-editor-list');
      const count = list.querySelectorAll('.service-editor-row').length;
      const row = document.createElement('div');
      row.className = 'service-editor-row';
      row.dataset.category = category;
      row.innerHTML = `
        <input type="text" name="${category}-name-${count}" value="" placeholder="Service name" aria-label="${category} service name ${count + 1}" />
        <input type="text" name="${category}-price-${count}" value="" placeholder="Price" aria-label="${category} service price ${count + 1}" />
        <button type="button" class="button button-light remove-service" data-category="${category}" data-index="${count}">Remove</button>
      `;
      list.appendChild(row);
      bindServiceRowActions();
    });
  });

  bindServiceRowActions();
}

function bindServiceRowActions() {
  ownerServiceLists?.querySelectorAll('.remove-service').forEach((button) => {
    button.addEventListener('click', () => {
      const row = button.closest('.service-editor-row');
      if (row) row.remove();
    });
  });
}

async function loadSettings() {
  const response = await fetch('/api/config');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Unable to load booking settings.');
  Object.entries(data.settings).forEach(([category, enabled]) => {
    const input = settingsForm.elements[category];
    if (input) input.checked = enabled;
  });
  renderOwnerServices(data.services || {});
}

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  settingsStatus.textContent = 'Saving access settings...';
  const settings = Object.fromEntries(['men', 'women', 'custom'].map((category) => [category, settingsForm.elements[category].checked]));
  try {
    const response = await fetch('/api/owner/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to save booking settings.');
    settingsStatus.textContent = 'Booking access updated.';
  } catch (error) {
    settingsStatus.textContent = error.message;
  }
});

servicesForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  servicesStatus.textContent = 'Saving service list...';
  const catalog = {};
  const categories = ['men', 'women', 'baby'];
  categories.forEach((category) => {
    const rows = [...ownerServiceLists.querySelectorAll(`.service-editor-row[data-category="${category}"]`)];
    catalog[category] = rows.map((row) => {
      const inputs = row.querySelectorAll('input');
      const name = inputs[0]?.value?.trim() || '';
      const price = inputs[1]?.value?.trim() || '';
      return { name, price };
    }).filter((item) => item.name || item.price);
  });

  try {
    const response = await fetch('/api/owner/services', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(catalog) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to save the service list.');
    servicesStatus.textContent = 'Service list updated.';
    renderOwnerServices(data);
  } catch (error) {
    servicesStatus.textContent = error.message;
  }
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginStatus.textContent = 'Signing in...';
  try {
    const response = await fetch('/api/owner/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: new FormData(loginForm).get('password') }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Sign-in failed.');
    loginForm.reset();
    await Promise.all([loadAppointments(), loadSettings()]);
  } catch (error) {
    loginStatus.textContent = error.message;
  }
});

logoutButton.addEventListener('click', async () => {
  await fetch('/api/owner/logout', { method: 'POST' });
  dashboardView.hidden = true;
  loginView.hidden = false;
  logoutButton.hidden = true;
});

loadAppointments().catch(() => {});
