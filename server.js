'use strict';

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SAMPLE_FILE = path.join(__dirname, 'data', 'db.sample.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, 'session-secret');

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- persistence helpers ----------
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function emptyDb() {
  return { settings: { clientName: 'Allied Elite Financial', agencyName: 'One Stop Marketing' }, agents: [], managers: [] };
}

if (!fs.existsSync(DB_FILE)) {
  writeJSON(DB_FILE, readJSON(SAMPLE_FILE, emptyDb()));
}

function loadDb() { return readJSON(DB_FILE, emptyDb()); }
function saveDb(db) { writeJSON(DB_FILE, db); }

// ---------- users ----------
// Two roles: "admin" (One Stop Marketing staff, can edit) and "client" (Allied Elite Financial, read-only).
function ensureUsers() {
  let users = readJSON(USERS_FILE, null);
  if (users && Array.isArray(users) && users.length) return users;
  const gen = () => crypto.randomBytes(9).toString('base64url');
  const adminPw = process.env.ADMIN_PASSWORD || gen();
  const clientPw = process.env.CLIENT_PASSWORD || gen();
  users = [
    { username: process.env.ADMIN_USERNAME || 'onestop', role: 'admin', name: 'One Stop Marketing', hash: bcrypt.hashSync(adminPw, 10) },
    { username: process.env.CLIENT_USERNAME || 'alliedelite', role: 'client', name: 'Allied Elite Financial', hash: bcrypt.hashSync(clientPw, 10) },
  ];
  writeJSON(USERS_FILE, users);
  console.log('\n=== Initial logins created (saved hashed in data/users.json) ===');
  console.log(`  Admin  -> username: ${users[0].username}  password: ${adminPw}`);
  console.log(`  Client -> username: ${users[1].username}  password: ${clientPw}`);
  console.log('  Change these from the Manage Data > Logins section after signing in.\n');
  return users;
}
ensureUsers();

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, s);
  return s;
}

// ---------- app ----------
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

app.use(express.json({ limit: '2mb' }));
app.use(session({
  name: 'osm.sid',
  secret: sessionSecret(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 1000 * 60 * 60 * 12,
  },
}));

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  next();
});

// Simple in-memory login throttle: 8 failures per IP per 15 minutes.
const attempts = new Map();
function throttled(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > 15 * 60 * 1000) return false;
  return rec.count >= 8;
}
function recordFailure(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > 15 * 60 * 1000) attempts.set(ip, { first: now, count: 1 });
  else rec.count++;
}

const requireAuth = (req, res, next) => (req.session.user ? next() : res.status(401).json({ error: 'Not signed in' }));
const requireAdmin = (req, res, next) =>
  req.session.user && req.session.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only' });

// ---------- auth routes ----------
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (throttled(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  const { username, password } = req.body || {};
  const users = readJSON(USERS_FILE, []);
  const user = users.find(u => u.username.toLowerCase() === String(username || '').trim().toLowerCase());
  if (!user || !bcrypt.compareSync(String(password || ''), user.hash)) {
    recordFailure(ip);
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  attempts.delete(ip);
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.user = { username: user.username, role: user.role, name: user.name };
    res.json({ user: req.session.user });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('osm.sid');
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not signed in' });
  res.json({ user: req.session.user });
});

// ---------- data routes ----------
app.get('/api/data', requireAuth, (req, res) => res.json(loadDb()));

// Replace the whole dataset (admin editor saves this way).
app.put('/api/data', requireAdmin, (req, res) => {
  const body = req.body;
  if (!body || !Array.isArray(body.agents) || !Array.isArray(body.managers)) {
    return res.status(400).json({ error: 'Expected { settings, agents: [], managers: [] }' });
  }
  const db = {
    settings: Object.assign(emptyDb().settings, body.settings || {}),
    agents: body.agents,
    managers: body.managers,
  };
  saveDb(db);
  res.json(db);
});

app.get('/api/users', requireAdmin, (req, res) => {
  res.json(readJSON(USERS_FILE, []).map(({ hash, ...u }) => u));
});

app.post('/api/users/password', requireAdmin, (req, res) => {
  const { username, password } = req.body || {};
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const users = readJSON(USERS_FILE, []);
  const user = users.find(u => u.username === username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.hash = bcrypt.hashSync(String(password), 10);
  writeJSON(USERS_FILE, users);
  res.json({ ok: true });
});

// ---------- static ----------
app.get('/vendor/chart.umd.js', (req, res) =>
  res.sendFile(path.join(__dirname, 'node_modules', 'chart.js', 'dist', 'chart.umd.js')));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`One Stop Marketing portal running on http://localhost:${PORT}`));
