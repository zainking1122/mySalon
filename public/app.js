const formToObject = (form) => {
  const values = {};
  new FormData(form).forEach((value, key) => {
    if (key === 'service') values.service = [...(values.service || []), value];
    else values[key] = value;
  });
  return values;
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character]));
}

function serviceImageFor(category, serviceName) {
  const normalizedName = String(serviceName || '').toLowerCase();
  const nameMap = {
    'hair cutting': '/images/salon-service-hair-cutting.jpeg',
    'beard': '/images/salon-service-beard.jpeg',
    'hair color': '/images/salon-service-coloring.jpeg',
    'threading': '/images/salon-women.jpeg',
    'hair washing': '/images/salon-service-hair-washing.jpeg',
    'shaving': '/images/salon-service-shaving.jpeg',
    'bald': '/images/salon-service-shaving.jpeg',
    'hair wash': '/images/salon-service-hair-washing.jpeg',
    'hair style': '/images/salon-women.jpeg',
    'highlights': '/images/salon-women.jpeg',
    'therapy botox': '/images/salon-women.jpeg',
    'brazilian therapy': '/images/salon-women.jpeg',
    'haircut - hairstyle': '/images/salon-women.jpeg',
    'dyeing styling': '/images/salon-women.jpeg',
    'baby cutting': '/images/salon-custom.jpeg',
    'babylights': '/images/salon-custom.jpeg'
  };
  const womenImageMap = {
    'hair cutting': '/images/salon-hero-07.jpeg',
    'hair color': '/images/salon-hero-09.jpeg',
    'hair wash': '/images/salon-hero-06.jpeg',
    'hair style': '/images/salon-hero-04.jpeg',
    'highlights': '/images/salon-hero-02.jpeg',
    'dyeing styling': '/images/salon-hero-11.jpeg'
  };
  const menImageMap = {
    bald: '/images/salon-hero-14.jpeg'
  };

  const fallbackByCategory = {
    men: '/images/salon-men.jpeg',
    women: '/images/salon-women.jpeg',
    baby: '/images/salon-custom.jpeg'
  };

  return (category === 'men' && menImageMap[normalizedName])
    || (category === 'women' && womenImageMap[normalizedName])
    || nameMap[normalizedName]
    || fallbackByCategory[category]
    || '/images/salon-custom.jpeg';
}

function renderServiceCatalog(catalog) {
  const catalogRoot = document.querySelector('#service-catalog');
  if (!catalogRoot) return;

  const sectionLabels = { men: 'Men', women: 'Women', baby: 'Baby' };
  const serviceCards = Object.entries(sectionLabels).map(([category, label]) => {
    const services = Array.isArray(catalog?.[category]) ? catalog[category] : [];
    const cards = services.map((service, index) => `
      <article class="service-card">
        <img src="${serviceImageFor(category, service.name)}" alt="${escapeHtml(service.name || label + ' service')}" />
        <span class="service-number">${String(index + 1).padStart(2, '0')}</span>
        <h3>${escapeHtml(service.name || 'Service')}</h3>
        ${service.note ? `<p class="service-note">${escapeHtml(service.note)}</p>` : '<p class="service-note">Signature salon care</p>'}
        <b>${escapeHtml(service.price || 'Custom price')}</b>
      </article>
    `).join('');

    return `
      <div class="service-category">
        <div class="service-category-header">
          <p class="eyebrow">${label}</p>
          <h3>${label}</h3>
        </div>
        <div class="service-list">
          ${cards || '<p class="empty-state">No services listed yet.</p>'}
        </div>
      </div>
    `;
  }).join('');

  catalogRoot.innerHTML = serviceCards;
}

function renderServiceOptions(catalog) {
  const serviceOptions = document.querySelector('.service-options');
  if (!serviceOptions) return;

  const services = [...(catalog?.men || []), ...(catalog?.women || []), ...(catalog?.baby || [])];
  const choices = [...new Set(services.map((service) => service.name).filter(Boolean))];
  serviceOptions.innerHTML = choices.length
    ? choices.map((service) => `
        <label>
          <input type="checkbox" name="service" value="${escapeHtml(service)}" />
          <span>${escapeHtml(service)}</span>
        </label>
      `).join('')
    : '<label><input type="checkbox" name="service" value="Haircut" /><span>Haircut</span></label>';
}

function showStatus(form, message, type = '') {
  const status = form.querySelector('.form-status');    
  status.textContent = message;
  status.className = `form-status ${type}`;
}

async function postForm(url, form) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formToObject(form)) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

async function loadPage() {
  const config = await (await fetch('/api/config')).json();
  renderServiceCatalog(config.services || {});
  renderServiceOptions(config.services || {});
  document.querySelectorAll('[data-shop]').forEach((element) => { element.textContent = config.shop[element.dataset.shop]; });
  document.querySelectorAll('input[name="audience"]').forEach((input) => {
    const enabled = config.settings[input.value];
    input.disabled = !enabled;
    if (!enabled) input.checked = false;
    input.parentElement.style.opacity = enabled ? '1' : '.35';
  });
  const dateInput = document.querySelector('#appointment-date');
  if (dateInput) {
    dateInput.min = new Date().toISOString().slice(0, 10);
    dateInput.addEventListener('change', () => {
      if (dateInput.value && new Date(`${dateInput.value}T00:00:00`).getDay() === 0) {
        dateInput.setCustomValidity('The salon is closed on Sundays. Please choose another date.');
      } else dateInput.setCustomValidity('');
    });
  }
}

document.querySelector('#appointment-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    showStatus(form, 'Sending your request...', '');
    const data = await postForm('/api/appointments', form);
    showStatus(form, data.emailSent ? 'You are on the list. We sent your request to the studio.' : 'Saved locally, but email delivery is not configured yet.', data.emailSent ? 'success' : 'error');
    const privateCard = document.querySelector('#private-card');
    privateCard.hidden = false;
    privateCard.innerHTML = `<div class="card-kicker"><span>Appointment confirmed</span><span class="card-seal">A</span></div><h3>Your chair is waiting.</h3><p class="card-note">Show this appointment card at the shop and arrive 10 minutes early for better service.</p><div class="card-details"><div><span>Guest</span><strong>${escapeHtml(data.appointment.name)}</strong></div><div><span>Services</span><strong>${escapeHtml(data.appointment.service)}</strong></div><div><span>Date</span><strong>${escapeHtml(data.appointment.date)}</strong></div><div><span>Time</span><strong>${escapeHtml(data.appointment.time)}</strong></div></div><div class="card-footer"><span>${escapeHtml(data.appointment.audience)}</span><span>${escapeHtml(data.appointment.phone)}${data.appointment.email ? ` · ${escapeHtml(data.appointment.email)}` : ''}</span></div>`;
    privateCard.classList.remove('card-reveal');
    void privateCard.offsetWidth;
    privateCard.classList.add('card-reveal');
    privateCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    form.reset();
    loadPage();
  } catch (error) { showStatus(form, error.message, 'error'); }
});

document.querySelector('#complaint-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    showStatus(form, 'Sending privately...', '');
    const data = await postForm('/api/complaints', form);
    showStatus(form, data.emailSent ? 'Thank you. Your note has been sent privately.' : 'Saved locally, but email delivery is not configured yet.', data.emailSent ? 'success' : 'error');
    form.reset();
  } catch (error) { showStatus(form, error.message, 'error'); }
});

loadPage().catch(() => {});