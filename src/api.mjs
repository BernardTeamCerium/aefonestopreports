// Portal API — one implementation shared by the Netlify Function and the local dev server.
// `store` is a tiny adapter: { get(key) -> object|null, set(key, object) }.
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import sample from '../data/db.sample.json' with { type: 'json' };

const COOKIE = 'osm_session';
const SESSION_HOURS = 12;

const emptySettings = () => ({ clientName: 'Allied Elite Financial', agencyName: 'One Stop Marketing Solutions' });

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}

/* ---------- stateless signed session cookie ---------- */
// Uses SESSION_SECRET if provided; otherwise generates one and keeps it in storage,
// so the site works with only the two password variables set.
async function getSecret(env, store) {
  const fromEnv = (env.SESSION_SECRET || '').trim();
  if (fromEnv.length >= 16) return fromEnv;
  const saved = await store.get('session-secret');
  if (saved && typeof saved.value === 'string' && saved.value.length >= 32) return saved.value;
  const value = crypto.randomBytes(32).toString('hex');
  await store.set('session-secret', { value });
  return value;
}
const b64 = s => Buffer.from(s).toString('base64url');
const sign = (data, key) => crypto.createHmac('sha256', key).update(data).digest('base64url');

function makeCookie(user, key, secure) {
  const payload = b64(JSON.stringify({ u: user.username, r: user.role, n: user.name, v: user.version || 1, exp: Date.now() + SESSION_HOURS * 3600e3 }));
  const token = `${payload}.${sign(payload, key)}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}${secure ? '; Secure' : ''}`;
}
const clearCookie = secure => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;

async function readSession(request, env, store, key) {
  const m = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload, key);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let s;
  try { s = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
  if (!s.exp || s.exp < Date.now()) return null;
  // Changing a password bumps the user's version, which signs out old sessions.
  const user = (await getUsers(env, store)).find(u => u.username === s.u);
  if (!user || (user.version || 1) !== s.v) return null;
  return { username: user.username, role: user.role, name: user.name };
}

/* ---------- users & data ---------- */
class ConfigError extends Error {}

async function getUsers(env, store) {
  const users = await store.get('users');
  if (Array.isArray(users) && users.length) return users;
  const adminPw = (env.ADMIN_PASSWORD || '').trim(), clientPw = (env.CLIENT_PASSWORD || '').trim();
  if (!adminPw || !clientPw) throw new ConfigError('ADMIN_PASSWORD and CLIENT_PASSWORD must be set for the first sign-in.');
  const seeded = [
    { username: env.ADMIN_USERNAME || 'onestop', role: 'admin', name: 'One Stop Marketing', hash: bcrypt.hashSync(adminPw, 10), version: 1 },
    { username: env.CLIENT_USERNAME || 'alliedelite', role: 'client', name: 'Allied Elite Financial', hash: bcrypt.hashSync(clientPw, 10), version: 1 },
  ];
  await store.set('users', seeded);
  return seeded;
}

async function getData(store) {
  const db = await store.get('db');
  if (db && Array.isArray(db.agents)) return db;
  const seeded = structuredClone(sample);
  await store.set('db', seeded);
  return seeded;
}

/* ---------- simple per-instance login throttle ---------- */
const attempts = new Map();
function throttled(ip) {
  const rec = attempts.get(ip);
  return rec && Date.now() - rec.first < 15 * 60e3 && rec.count >= 8;
}
function recordFailure(ip) {
  const rec = attempts.get(ip);
  if (!rec || Date.now() - rec.first > 15 * 60e3) attempts.set(ip, { first: Date.now(), count: 1 });
  else rec.count++;
}

/* ---------- router ---------- */
export async function handle(request, { store, env, ip = 'local' }) {
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/(\.netlify\/functions\/)?api\/?/, '');
  const method = request.method;
  const secure = url.protocol === 'https:';
  const body = async () => { try { return await request.json(); } catch { return {}; } };

  try {
    const key = await getSecret(env, store);

    if (route === 'login' && method === 'POST') {
      if (throttled(ip)) return json({ error: 'Too many attempts. Try again in a few minutes.' }, 429);
      const { username, password } = await body();
      const users = await getUsers(env, store);
      const user = users.find(u => u.username.toLowerCase() === String(username || '').trim().toLowerCase());
      if (!user || !bcrypt.compareSync(String(password || ''), user.hash)) {
        recordFailure(ip);
        return json({ error: 'Invalid username or password' }, 401);
      }
      attempts.delete(ip);
      const pub = { username: user.username, role: user.role, name: user.name };
      return json({ user: pub }, 200, { 'Set-Cookie': makeCookie(user, key, secure) });
    }

    if (route === 'logout' && method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(secure) });

    const user = await readSession(request, env, store, key);
    if (!user) return json({ error: 'Not signed in' }, 401);
    const isAdmin = user.role === 'admin';
    const adminOnly = () => json({ error: 'Admin only' }, 403);

    if (route === 'me' && method === 'GET') return json({ user });

    if (route === 'data' && method === 'GET') return json(await getData(store));

    if (route === 'data' && method === 'PUT') {
      if (!isAdmin) return adminOnly();
      const b = await body();
      if (!b || !Array.isArray(b.agents) || !Array.isArray(b.managers)) return json({ error: 'Expected { settings, agents: [], managers: [] }' }, 400);
      const db = { settings: { ...emptySettings(), ...(b.settings || {}) }, agents: b.agents, managers: b.managers };
      await store.set('db', db);
      return json(db);
    }

    if (route === 'users' && method === 'GET') {
      if (!isAdmin) return adminOnly();
      return json((await getUsers(env, store)).map(({ hash, version, ...u }) => u));
    }

    if (route === 'users/password' && method === 'POST') {
      if (!isAdmin) return adminOnly();
      const { username, password } = await body();
      if (!password || String(password).length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);
      const users = await getUsers(env, store);
      const target = users.find(u => u.username === username);
      if (!target) return json({ error: 'User not found' }, 404);
      target.hash = bcrypt.hashSync(String(password), 10);
      target.version = (target.version || 1) + 1;
      await store.set('users', users);
      // Keep the admin signed in if they changed their own password.
      const headers = target.username === user.username ? { 'Set-Cookie': makeCookie(target, key, secure) } : {};
      return json({ ok: true }, 200, headers);
    }

    return json({ error: 'Not found' }, 404);
  } catch (err) {
    if (err instanceof ConfigError) return json({ error: `Portal setup incomplete: ${err.message}` }, 500);
    console.error(err);
    return json({ error: 'Server error' }, 500);
  }
}
