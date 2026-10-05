const form = document.querySelector('#card-lookup');
const referenceInput = document.querySelector('#appointment-reference');
const status = document.querySelector('.form-status');
const cardRoot = document.querySelector('#personal-card');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#039;',
    '"': '&quot;'
  }[character]));
}

function showStatus(message, type = '') {
  status.textContent = message;
  status.className = `form-status ${type}`;
}

function formatReference(reference) {
  const compactReference = reference.replace(/[-\s]/g, '').toUpperCase();
  return compactReference.length === 10
    ? `${compactReference.slice(0, 5)}-${compactReference.slice(5)}`
    : reference;
}

async function loadCard(reference) {
  const response = await fetch(`/api/appointments/${encodeURIComponent(reference)}/card`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Unable to load your appointment card.');

  const appointment = data.appointment;
  cardRoot.innerHTML = `
    <div class="card-kicker"><span>Appointment confirmed</span><span class="card-seal">A</span></div>
    <h2>Your chair is waiting.</h2>
    <p class="card-note">Show this card at the shop and arrive 10 minutes early for better service.</p>
    <div class="card-details">
      <div><span>Guest</span><strong>${escapeHtml(appointment.name)}</strong></div>
      <div><span>Services</span><strong>${escapeHtml(appointment.service)}</strong></div>
      <div><span>Date</span><strong>${escapeHtml(appointment.date)}</strong></div>
      <div><span>Time</span><strong>${escapeHtml(appointment.time)}</strong></div>
    </div>
    <div class="card-footer">
      <span>${escapeHtml(appointment.audience)}</span>
      <span>Reference: ${escapeHtml(formatReference(appointment.id))}</span>
    </div>`;
  cardRoot.hidden = false;
  showStatus('');
  history.replaceState(null, '', `/my-card?id=${encodeURIComponent(appointment.id)}`);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const reference = referenceInput.value.trim();
  if (!reference) return;

  cardRoot.hidden = true;
  showStatus('Looking up your appointment...');
  try {
    await loadCard(reference);
  } catch (error) {
    showStatus(error.message, 'error');
  }
});

const referenceFromUrl = new URLSearchParams(window.location.search).get('id');
if (referenceFromUrl) {
  referenceInput.value = referenceFromUrl;
  form.requestSubmit();
}
