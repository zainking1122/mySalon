import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';

const port = 3457;
const baseUrl = `http://localhost:${port}`;

async function waitForServer() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/config`);
      if (response.ok) return;
    } catch {
      // Server still starting.
    }
    await delay(200);
  }
  throw new Error('Server did not start in time.');
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill('SIGTERM');
  });
}

test('default service catalog is exposed for men, women and baby categories', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'salon-test-'));

  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), OWNER_PASSWORD: 'testpass', DATABASE_PATH: path.join(directory, 'salon.sqlite') },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer();
    const response = await fetch(`${baseUrl}/api/services`);
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(data).sort(), ['baby', 'men', 'women']);
    assert.ok(data.men.some((service) => service.name === 'Hair cutting' && service.price === '7€'));
    assert.ok(data.women.some((service) => service.name === 'Hair cutting' && service.price === '10€'));
    assert.ok(data.baby.some((service) => service.name === 'Baby cutting' && service.price === '7€'));
  } finally {
    await stopServer(child);
    await rm(directory, { recursive: true, force: true });
  }
});

test('owner can update the service catalog from the dashboard', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'salon-test-'));

  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), OWNER_PASSWORD: 'testpass', DATABASE_PATH: path.join(directory, 'salon.sqlite') },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer();

    const loginResponse = await fetch(`${baseUrl}/api/owner/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testpass' })
    });
    const loginData = await loginResponse.json();
    assert.equal(loginResponse.status, 200, loginData.error || 'Login failed');
    const cookie = loginResponse.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie, 'Owner session cookie was not set.');

    const updateResponse = await fetch(`${baseUrl}/api/owner/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        men: [{ name: 'Hair cutting', price: '8€' }],
        women: [{ name: 'Hair style', price: '12€' }],
        baby: [{ name: 'Baby cutting', price: '12€' }]
      })
    });
    const updateData = await updateResponse.json();

    assert.equal(updateResponse.status, 200, updateData.error || 'Update failed');
    assert.equal(updateData.men[0].price, '8€');

    const listResponse = await fetch(`${baseUrl}/api/services`);
    const updated = await listResponse.json();
    assert.equal(updated.men[0].price, '8€');
    assert.equal(updated.women[0].price, '12€');
    assert.equal(updated.baby[0].price, '12€');
  } finally {
    await stopServer(child);
    await rm(directory, { recursive: true, force: true });
  }
});

test('appointments, complaints and owner settings persist in SQLite after restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'salon-test-'));
  const databasePath = path.join(directory, 'salon.sqlite');
  const start = () => spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), OWNER_PASSWORD: 'testpass', DATABASE_PATH: databasePath },
    stdio: ['ignore', 'ignore', 'inherit']
  });
  let child = start();

  try {
    await waitForServer();
    const loginResponse = await fetch(`${baseUrl}/api/owner/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testpass' })
    });
    const cookie = loginResponse.headers.get('set-cookie')?.split(';')[0];
    assert.equal(loginResponse.status, 200);
    assert.ok(cookie);

    const settingsResponse = await fetch(`${baseUrl}/api/owner/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ men: false, women: true, custom: false })
    });
    assert.equal(settingsResponse.status, 200);

    const bookingDate = new Date();
    bookingDate.setUTCDate(bookingDate.getUTCDate() + 40);
    while (bookingDate.getUTCDay() === 0) bookingDate.setUTCDate(bookingDate.getUTCDate() + 1);
    const date = bookingDate.toISOString().slice(0, 10);
    const appointmentResponse = await fetch(`${baseUrl}/api/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Client', phone: '555-0100', date, time: '11:00 AM', service: 'Hair cutting', audience: 'women' })
    });
    const appointmentData = await appointmentResponse.json();
    assert.equal(appointmentResponse.status, 201, appointmentData.error);
    assert.match(appointmentData.appointment.id, /^[2-9A-HJ-NP-Z]{10}$/);

    const formattedReference = `${appointmentData.appointment.id.slice(0, 5)}-${appointmentData.appointment.id.slice(5)}`;
    const personalCardResponse = await fetch(`${baseUrl}/api/appointments/${formattedReference}/card`);
    const personalCardData = await personalCardResponse.json();
    assert.equal(personalCardResponse.status, 200);
    assert.deepEqual(personalCardData.appointment, {
      id: appointmentData.appointment.id,
      name: 'Test Client',
      date,
      time: '11:00 AM',
      service: 'Hair cutting',
      audience: 'women'
    });
    assert.equal(personalCardResponse.headers.get('cache-control'), 'private, no-store');

    const missingCardResponse = await fetch(`${baseUrl}/api/appointments/${crypto.randomUUID()}/card`);
    assert.equal(missingCardResponse.status, 404);

    const complaintResponse = await fetch(`${baseUrl}/api/complaints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Client', phone: '555-0100', date, time: '11:00 AM', message: 'Test complaint' })
    });
    assert.equal(complaintResponse.status, 201);

    await stopServer(child);
    child = start();
    await waitForServer();

    const configResponse = await fetch(`${baseUrl}/api/config`);
    const config = await configResponse.json();
    assert.deepEqual(config.settings, { men: false, women: true, custom: false });

    const reloginResponse = await fetch(`${baseUrl}/api/owner/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testpass' })
    });
    const reloginCookie = reloginResponse.headers.get('set-cookie')?.split(';')[0];
    const appointmentsResponse = await fetch(`${baseUrl}/api/owner/appointments`, { headers: { Cookie: reloginCookie } });
    const appointments = await appointmentsResponse.json();
    assert.ok(appointments.some((appointment) => appointment.id === appointmentData.appointment.id));

    const database = new DatabaseSync(databasePath);
    const complaint = database.prepare('SELECT data FROM complaints').get();
    database.close();
    assert.equal(JSON.parse(complaint.data).message, 'Test complaint');
  } finally {
    await stopServer(child);
    await rm(directory, { recursive: true, force: true });
  }
});
