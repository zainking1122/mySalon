const storageKey = 'salon-appointment-card-ids';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const status = document.querySelector('#card-page-status');
const cardsRoot = document.querySelector('#appointment-cards');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#039;',
    '"': '&quot;'
  }[character]));
}

function renderCard(appointment) {
  return `
    <article class="private-card">
      <div class="card-kicker"><span>Appointment confirmation</span><span class="card-seal">A</span></div>
      <h3>Your chair is waiting.</h3>
      <p class="card-note">Show this appointment card at the shop and arrive 10 minutes early for better service.</p>
      <div class="card-details">
        <div><span>Guest</span><strong>${escapeHtml(appointment.name)}</strong></div>
        <div><span>Services</span><strong>${escapeHtml(appointment.service)}</strong></div>
        <div><span>Date</span><strong>${escapeHtml(appointment.date)}</strong></div>
        <div><span>Time</span><strong>${escapeHtml(appointment.time)}</strong></div>
      </div>
      <div class="card-footer">
        <span>${escapeHtml(appointment.audience)}</span>
        <span>${escapeHtml(appointment.phone)}${appointment.email ? ` · ${escapeHtml(appointment.email)}` : ''}</span>
      </div>
    </article>
  `;
}

async function loadAppointmentCards() {
  let ids;
  try {
    ids = JSON.parse(localStorage.getItem(storageKey) || '[]');
  } catch (error) {
    throw new Error('Your saved appointment list could not be read. Please return to the browser where you booked.');
  }

  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !uuidPattern.test(id))) {
    throw new Error('Your saved appointment list is invalid. Please return to the browser where you booked.');
  }

  if (!ids.length) {
    status.textContent = 'No appointment cards are saved in this browser yet.';
    return;
  }

  const results = await Promise.all(ids.map(async (id) => {
    const response = await fetch(`/api/appointments/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (response.status === 404) return { unavailable: true };
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load an appointment card.');
    return { appointment: data.appointment };
  }));

  const appointments = results.filter((result) => result.appointment).map((result) => result.appointment);
  cardsRoot.innerHTML = appointments.map(renderCard).join('');

  const unavailableCount = results.filter((result) => result.unavailable).length;
  if (appointments.length && unavailableCount) {
    status.textContent = 'Some older cards are no longer available.';
  } else if (appointments.length) {
    status.textContent = '';
  } else {
    status.textContent = 'No active appointment cards were found. Older appointments may have expired.';
  }
}

loadAppointmentCards().catch((error) => {
  status.textContent = error.message;
  status.classList.add('error');
});
