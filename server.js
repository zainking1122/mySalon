import 'dotenv/config';
import express from 'express';
import nodemailer from 'nodemailer';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const dataDirectory = path.join(__dirname, 'data');
const appointmentsFile = path.join(dataDirectory, 'appointments.json');
const settingsFile = path.join(dataDirectory, 'settings.json');
const servicesFile = path.join(dataDirectory, 'services.json');

let db;
const ownerSessions = new Map();
const sessionDuration = 8 * 60 * 60 * 1000;
const serviceCategories = ['men', 'women', 'baby'];

const shop = {
  name: process.env.SHOP_NAME || 'Abid Salon',
  address: process.env.SHOP_ADDRESS || '18 Willow Lane, Brookfield',
  phone: process.env.SHOP_PHONE || '+1 (555) 014-0288',
  email: process.env.SHOP_EMAIL || 'hello@mossandmane.example'
};

const defaultSettings = {
  men: process.env.ALLOW_MEN !== 'false',
  women: process.env.ALLOW_WOMEN !== 'false',
  custom: process.env.ALLOW_CUSTOM !== 'false'
};

const defaultServices = {
  men: [
    { name: 'Hair cutting', price: '7€' },
    { name: 'Beard', price: '5€' },
    { name: 'Hair color', price: 'From 20€' },
    { name: 'Threading', price: 'From 5€' },
    { name: 'Hair washing', price: '3€' },
    { name: 'Shaving', price: '3€ with machine / 5€ with blade' },
    { name: 'Bald', price: '7€ with machine / 10€ with blade' }
  ],
  women: [
    { name: 'Hair cutting', price: '10€' },
    { name: 'Hair color', price: 'From 20€' },
    { name: 'Threading', price: 'From 5€' },
    { name: 'Hair wash', price: '3€' },
    { name: 'Hair style', price: 'From 8€ - 10€ - 12€' },
    { name: 'Highlights', price: 'From 20€ - 40€ - 60€' },
    { name: 'Therapy botox', price: 'From 25€' },
    { name: 'Brazilian therapy', price: '70€', note: 'Every Tuesday - Wednesday' },
    { name: 'Haircut - hairstyle', price: '18€', note: 'Every Tuesday - Wednesday' },
    { name: 'Dyeing styling', price: '23€', note: 'Every Tuesday - Wednesday' }
  ],
  baby: [
    { name: 'Baby cutting', price: '10€' },
    { name: 'Babylights', price: 'From 30€ - 40€' }
  ]
};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.join(__dirname, 'images')));

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function initializeDatabase() {
  db = await mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'salon',
    port: Number(process.env.DB_PORT || 3306),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  await db.query(`
    CREATE TABLE IF NOT EXISTS app_data (
      \`key\` VARCHAR(255) PRIMARY KEY,
      \`value\` LONGTEXT NOT NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id VARCHAR(255) PRIMARY KEY,
      date VARCHAR(50) NOT NULL,
      time VARCHAR(50) NOT NULL,
      createdAt VARCHAR(100) NOT NULL,
      data LONGTEXT NOT NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS complaints (
      id VARCHAR(255) PRIMARY KEY,
      createdAt VARCHAR(100) NOT NULL,
      data LONGTEXT NOT NULL
    )
  `);

  const [settings] = await db.query('SELECT * FROM app_data WHERE `key` = ?', ['settings']);
  if (settings.length === 0) {
    const initialSettings = await readJson(settingsFile, defaultSettings);
    await db.query('INSERT INTO app_data (`key`, `value`) VALUES (?, ?)', ['settings', JSON.stringify(initialSettings)]);
  }

  const [services] = await db.query('SELECT * FROM app_data WHERE `key` = ?', ['services']);
  if (services.length === 0) {
    const initialServices = await readJson(servicesFile, defaultServices);
    await db.query('INSERT INTO app_data (`key`, `value`) VALUES (?, ?)', ['services', JSON.stringify(initialServices)]);
  }
}

function normalizeServiceCatalog(catalog) {
  const normalized = {};
  for (const category of serviceCategories) {
    const items = Array.isArray(catalog?.[category]) ? catalog[category] : [];
    normalized[category] = items
      .map((service) => ({
        name: clean(service?.name, 80) || 'New service',
        price: clean(service?.price, 80) || 'Custom',
        note: clean(service?.note, 120)
      }))
      .filter((service) => service.name || service.price);
  }
  return normalized;
}

async function readServices() {
  const [rows] = await db.query('SELECT `value` FROM app_data WHERE `key` = ?', ['services']);
  return normalizeServiceCatalog(rows.length ? JSON.parse(rows[0].value) : defaultServices);
}

async function readSettings() {
  const [rows] = await db.query('SELECT `value` FROM app_data WHERE `key` = ?', ['settings']);
  return rows.length ? JSON.parse(rows[0].value) : defaultSettings;
}

async function purgeExpiredAppointments() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  await db.query('DELETE FROM appointments WHERE createdAt < ?', [cutoff]);
  const [rows] = await db.query('SELECT data FROM appointments ORDER BY createdAt DESC');
  return rows.map(({ data }) => JSON.parse(data));
}

function clean(value, maxLength = 120) {
  return String(value || '').trim().slice(0, maxLength);
}

function parseTimeToMinutes(value) {
  const time = clean(value, 20).toUpperCase().replace(/\s+/g, ' ');
  const match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59) return null;
  if (match[3]) {
    if (hours < 1 || hours > 12) return null;
    if (match[3] === 'PM' && hours !== 12) hours += 12;
    if (match[3] === 'AM' && hours === 12) hours = 0;
  } else if (hours > 23) return null;
  return hours * 60 + minutes;
}

function serviceList(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.map((service) => clean(service, 60)).filter(Boolean).slice(0, 6);
}

function appointmentWindow(appointment) {
  const start = parseTimeToMinutes(appointment.time);
  if (start === null) return null;
  const count = serviceList(appointment.service).length || 1;
  return { start, end: start + count * 10 };
}

function bookingDayStatus(date) {
  const match = clean(date, 20).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return 'Choose a valid appointment date.';
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date) return 'Choose a valid appointment date.';
  if (day.getUTCDay() === 0) return 'The salon is closed on Sundays. Please choose another date.';
  return '';
}

function validateContact(form) {
  const name = clean(form.name);
  const phone = clean(form.phone, 40);
  const email = clean(form.email, 120);
  if (!name || !phone) return { error: 'Name and phone number are required.' };
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return { error: 'Please enter a valid email address.' };
  return { name, phone, email };
}

function ownerPasswordIsValid(password) {
  return clean(password, 200) === (process.env.OWNER_PASSWORD || 'change-this-password');
}

function getSessionToken(req) {
  const cookies = clean(req.headers.cookie, 1000).split(';').map((cookie) => cookie.trim());
  return cookies.find((cookie) => cookie.startsWith('owner_session='))?.split('=')[1];
}

function requireOwner(req, res, next) {
  const token = getSessionToken(req);
  const expiresAt = token && ownerSessions.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    if (token) ownerSessions.delete(token);
    return res.status(401).json({ error: 'Owner sign-in required.' });
  }
  next();
}

async function sendEmail(subject, text) {
  const smtpPass = String(process.env.SMTP_PASS || '').replace(/\s/g, '');
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !smtpPass || smtpPass === 'add-your-16-character-gmail-app-password') {
    console.warn('SMTP is not configured properly.');
    return false;
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: smtpPass }
  });
  try {
    await transporter.sendMail({ from: process.env.SMTP_USER, to: process.env.OWNER_EMAIL || shop.email, subject, text });
    return true;
  } catch (error) {
    console.error(`Email delivery failed: ${error.message}`);
    return false;
  }
}

app.get('/api/config', async (_req, res) => {
  res.json({ shop, settings: await readSettings(), services: await readServices() });
});

app.get('/api/services', async (_req, res) => {
  res.json(await readServices());
});

app.post('/api/owner/login', (req, res) => {
  if (!ownerPasswordIsValid(req.body.password)) return res.status(401).json({ error: 'Owner password is incorrect.' });
  const token = crypto.randomBytes(32).toString('hex');
  ownerSessions.set(token, Date.now() + sessionDuration);
  res.setHeader('Set-Cookie', `owner_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionDuration / 1000}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  res.json({ ok: true });
});

app.post('/api/owner/logout', (req, res) => {
  const token = getSessionToken(req);
  if (token) ownerSessions.delete(token);
  res.setHeader('Set-Cookie', 'owner_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/owner/appointments', requireOwner, async (_req, res) => {
  const appointments = await purgeExpiredAppointments();
  res.json(appointments);
});

app.get('/api/appointments/:id', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const id = clean(req.params.id, 40);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(404).json({ error: 'Appointment card not found.' });
  }

  const [rows] = await db.query('SELECT data FROM appointments WHERE id = ? LIMIT 1', [id]);
  if (!rows.length) return res.status(404).json({ error: 'Appointment card not found.' });

  res.json({ appointment: JSON.parse(rows[0].data) });
});

app.post('/api/appointments', async (req, res) => {
  const form = validateContact(req.body);
  const date = clean(req.body.date, 20);
  const time = clean(req.body.time, 20);
  const services = serviceList(req.body.service);
  const service = services.join(', ');
  const audience = clean(req.body.audience, 20).toLowerCase();
  const settings = await readSettings();
  const requestedWindow = appointmentWindow({ time, service });

  if (form.error || !date || !time || !services.length || !requestedWindow || !['men', 'women', 'custom'].includes(audience)) {
    return res.status(400).json({ error: form.error || 'Choose at least one service and enter a time like 10:30 AM.' });
  }

  const dayError = bookingDayStatus(date);
  if (dayError) return res.status(400).json({ error: dayError });
  if (requestedWindow.start < 9 * 60 || requestedWindow.end > 21 * 60) {
    return res.status(400).json({ error: 'Appointments are available Monday to Saturday, from 9:00 AM to 9:00 PM.' });
  }
  if (!settings[audience]) return res.status(403).json({ error: 'Appointments for this category are currently closed.' });

  await purgeExpiredAppointments();
  const [rows] = await db.query('SELECT data FROM appointments WHERE date = ?', [date]);
  const appointments = rows.map(({ data }) => JSON.parse(data));

  const conflict = appointments.find((appointment) => {
    const existingWindow = appointmentWindow(appointment);
    return existingWindow && requestedWindow.start < existingWindow.end && requestedWindow.end > existingWindow.start;
  });

  if (conflict) {
    return res.status(409).json({ error: `That time is unavailable because another appointment runs from ${conflict.time}. Please choose a later time.` });
  }

  const appointment = { id: crypto.randomUUID(), ...form, date, time, service, audience, createdAt: new Date() };
  const storedAppointment = { ...appointment, createdAt: appointment.createdAt.toISOString() };

  await db.query('INSERT INTO appointments (id, date, time, createdAt, data) VALUES (?, ?, ?, ?, ?)', [
    appointment.id,
    date,
    time,
    storedAppointment.createdAt,
    JSON.stringify(storedAppointment)
  ]);

  const emailSent = await sendEmail(
    `New appointment request from ${appointment.name}`,
    `Name: ${appointment.name}\nPhone: ${appointment.phone}\nEmail: ${appointment.email || 'Not provided'}\nCategory: ${appointment.audience}\nService: ${appointment.service}\nDate: ${appointment.date}\nTime: ${appointment.time}`
  );

  res.status(201).json({ appointment, emailSent });
});

app.post('/api/complaints', async (req, res) => {
  const form = validateContact(req.body);
  const date = clean(req.body.date, 20);
  const time = clean(req.body.time, 20);
  const message = clean(req.body.message, 1000);

  if (form.error || !date || !time || !message) {
    return res.status(400).json({ error: form.error || 'Please complete every complaint field.' });
  }

  const complaint = { id: crypto.randomUUID(), ...form, visitDate: date, visitTime: time, message, createdAt: new Date().toISOString() };

  await db.query('INSERT INTO complaints (id, createdAt, data) VALUES (?, ?, ?)', [
    complaint.id,
    complaint.createdAt,
    JSON.stringify(complaint)
  ]);

  const emailSent = await sendEmail(
    `Customer complaint from ${form.name}`,
    `Name: ${form.name}\nPhone: ${form.phone}\nEmail: ${form.email || 'Not provided'}\nVisit date: ${date}\nVisit time: ${time}\n\n${message}`
  );

  res.status(201).json({ message: 'Complaint received.', emailSent });
});

app.post('/api/owner/settings', requireOwner, async (req, res) => {
  const settings = { men: Boolean(req.body.men), women: Boolean(req.body.women), custom: Boolean(req.body.custom) };
  await db.query('INSERT INTO app_data (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)', [
    'settings',
    JSON.stringify(settings)
  ]);
  res.json({ settings });
});

app.post('/api/owner/services', requireOwner, async (req, res) => {
  const currentCatalog = await readServices();
  const catalog = normalizeServiceCatalog({ ...currentCatalog, ...(req.body || {}) });
  await db.query('INSERT INTO app_data (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)', [
    'services',
    JSON.stringify(catalog)
  ]);
  res.json(catalog);
});

app.get('/owner', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'owner.html')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

async function startServer() {
  await initializeDatabase();

  app.listen(port, '0.0.0.0', () => {
    purgeExpiredAppointments().catch((error) => console.error(`Appointment cleanup failed: ${error.message}`));
    setInterval(() => {
      purgeExpiredAppointments().catch((error) => console.error(`Appointment cleanup failed: ${error.message}`));
    }, 60 * 60 * 1000).unref();

    console.log(`${shop.name} is running at http://0.0.0.0:${port}`);
  });
}

startServer().catch((error) => {
  console.error(`Server startup failed: ${error.message}`);
  process.exitCode = 1;
});