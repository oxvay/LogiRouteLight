import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const dataDir    = path.join(__dirname, 'data');
const dbFile     = path.join(dataDir, 'db.json');
const PORT       = Number(process.env.PORT || 3001);
const distDir    = path.join(__dirname, 'dist');

const STATIC_MIME = {
  '.html':  'text/html; charset=utf-8',
  '.js':    'application/javascript; charset=utf-8',
  '.css':   'text/css; charset=utf-8',
  '.json':  'application/json',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.svg':   'image/svg+xml',
  '.ico':   'image/x-icon',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
};

async function serveStatic(req, res, pathname) {
  const safe = path.normalize(pathname).replace(/^(\.\.[\\/])+/, '');
  let filePath = path.join(distDir, safe || 'index.html');
  if (!filePath.startsWith(distDir)) { res.writeHead(403); res.end(); return; }
  try {
    const st = await fs.stat(filePath);
    if (st.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    filePath = path.join(distDir, 'index.html'); // SPA fallback
  }
  const ext  = path.extname(filePath);
  const mime = STATIC_MIME[ext] || 'application/octet-stream';
  const cc   = safe.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  try {
    const st = await fs.stat(filePath);
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': cc, 'Content-Length': st.size });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found');
  }
}

const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30;

// ── Utilities ─────────────────────────────────────────────

const hashPassword = (password) => crypto.createHash('sha256').update(password).digest('hex');
const makeId       = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const monthKey     = (date = new Date()) => date.toISOString().slice(0, 7);

function buildJsonHeaders(origin = '') {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
  };
}

function reply(req, res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, { ...buildJsonHeaders(req.headers.origin || ''), ...extraHeaders });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((acc, pair) => {
    const [key, ...rest] = pair.trim().split('=');
    if (key) acc[key] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function getSessionToken(req) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return parseCookies(req.headers.cookie || '').sessionToken || '';
}

// ── DB ────────────────────────────────────────────────────

async function ensureDb() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(dbFile);
  } catch {
    const seed = {
      users: [{
        id: 'user-admin-root',
        login: 'admin',
        passwordHash: hashPassword('ProDrive'),
        role: 'admin',
        createdAt: new Date().toISOString()
      }],
      sessions: [], routes: [], routeItems: [], monthlyStats: [], geocache: {}
    };
    await fs.writeFile(dbFile, JSON.stringify(seed, null, 2), 'utf8');
  }
}

async function readDb()       { await ensureDb(); const db = JSON.parse(await fs.readFile(dbFile, 'utf8')); if (!db.geocache) db.geocache = {}; return db; }
async function writeDb(db)    { await fs.writeFile(dbFile, JSON.stringify(db, null, 2), 'utf8'); }

async function getCurrentUser(req) {
  const token = getSessionToken(req);
  if (!token) return null;
  const db = await readDb();
  const session = db.sessions.find((s) => s.token === token && new Date(s.expiresAt) > new Date());
  return session ? db.users.find((u) => u.id === session.userId) || null : null;
}

// ── Auth ──────────────────────────────────────────────────

async function handleLogin(req, res) {
  const { login, password } = await readBody(req);
  const db = await readDb();
  const user = db.users.find(
    (u) => u.login === String(login || '').trim() && u.passwordHash === hashPassword(String(password || '').trim())
  );
  if (!user) return reply(req, res, 401, { error: 'Неверный логин или пароль' });

  const token     = makeId('sess');
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  db.sessions = db.sessions.filter((s) => s.userId !== user.id);
  db.sessions.push({ id: makeId('session'), userId: user.id, token, expiresAt });
  await writeDb(db);

  return reply(req, res, 200,
    { user: { id: user.id, login: user.login, role: user.role }, token },
    { 'Set-Cookie': `sessionToken=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE_SEC}` }
  );
}

async function handleLogout(req, res) {
  const token = getSessionToken(req);
  if (token) {
    const db = await readDb();
    db.sessions = db.sessions.filter((s) => s.token !== token);
    await writeDb(db);
  }
  return reply(req, res, 200, { ok: true },
    { 'Set-Cookie': 'sessionToken=; HttpOnly; Path=/; Max-Age=0' });
}

async function handleMe(req, res) {
  const user = await getCurrentUser(req);
  if (!user) return reply(req, res, 401, { error: 'Unauthorized' });
  return reply(req, res, 200, { user: { id: user.id, login: user.login, role: user.role } });
}

// ── Routes ────────────────────────────────────────────────

async function handleRoutes(req, res, user) {
  const db  = await readDb();
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET') {
    const date  = url.searchParams.get('date');
    const month = url.searchParams.get('month');
    const routes = db.routes.filter(
      (r) => r.userId === user.id && (!date || r.routeDate === date) && (!month || r.routeDate.startsWith(month))
    );
    return reply(req, res, 200, { routes });
  }

  if (req.method === 'POST') {
    const body      = await readBody(req);
    const routeId   = makeId('route');
    const routeDate = body.routeDate || new Date().toISOString().slice(0, 10);
    const route = {
      id: routeId, userId: user.id, routeDate,
      sourceFileName: body.sourceFileName || '',
      status: body.status || 'active',
      createdAt: new Date().toISOString()
    };
    db.routes.push(route);
    for (const item of body.items || []) {
      db.routeItems.push({ id: makeId('item'), routeId, ...item });
    }
    const month = monthKey(new Date(routeDate));
    const key   = `${user.id}:${month}`;
    if (!db.monthlyStats.find((s) => s.key === key)) {
      db.monthlyStats.push({ id: makeId('stat'), key, userId: user.id, month, completedRoutesCount: 0 });
    }
    await writeDb(db);
    return reply(req, res, 201, { route });
  }

  return reply(req, res, 405, { error: 'Method Not Allowed' });
}

async function handleRouteItems(req, res, user, routeId) {
  if (req.method !== 'GET') return reply(req, res, 405, { error: 'Method Not Allowed' });
  const db = await readDb();
  const route = db.routes.find((r) => r.id === routeId && r.userId === user.id);
  if (!route) return reply(req, res, 404, { error: 'Route not found' });
  return reply(req, res, 200, { items: db.routeItems.filter((it) => it.routeId === routeId) });
}

async function handleStats(req, res, user) {
  const db    = await readDb();
  const month = monthKey();
  const stat  = db.monthlyStats.find((s) => s.userId === user.id && s.month === month) || { completedRoutesCount: 0 };
  return reply(req, res, 200, { month, completedRoutesCount: stat.completedRoutesCount });
}

// ── Geocoding proxy ───────────────────────────────────────
// Server-side geocoding: bypasses browser CORS/mobile-network blocks,
// sets the User-Agent header Nominatim requires, and persists results
// in db.json so points stay on the map across reloads and devices.

const geoCacheKey = (q) => String(q || '').replace(/\s+/g, ' ').trim().toLowerCase();

async function fetchJsonTimeout(url, headers = {}, ms = 8000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
  finally { clearTimeout(timer); }
}

// Nominatim ToS: 1 req/sec. Queue through a single promise chain.
let nominatimQueue = Promise.resolve();
function geocodeNominatim(q) {
  const next = nominatimQueue.then(async () => {
    await new Promise(r => setTimeout(r, 1100));
    const url = 'https://nominatim.openstreetmap.org/search?' +
      new URLSearchParams({ q, format: 'json', limit: '1', countrycodes: 'ru', 'accept-language': 'ru' });
    const data = await fetchJsonTimeout(url, {
      'User-Agent': 'LogiRouteLight/1.0 (contact: admin@logiroute.local)',
      'Accept-Language': 'ru'
    }, 8000);
    if (!data?.[0]) return null;
    return { lat: +data[0].lat, lon: +data[0].lon };
  });
  nominatimQueue = next.catch(() => null);
  return next;
}

async function geocodePhoton(q) {
  const url = 'https://photon.komoot.io/api/?' +
    new URLSearchParams({ q, limit: '1', lang: 'ru' });
  const data = await fetchJsonTimeout(url, {}, 6000);
  const feat = data?.features?.find(f => f.properties?.countrycode === 'RU') ?? data?.features?.[0];
  if (!feat) return null;
  const [lon, lat] = feat.geometry.coordinates;
  return { lat, lon };
}

async function handleGeocode(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const q   = (url.searchParams.get('q') || '').trim();
  if (!q) return reply(req, res, 400, { error: 'Missing q' });

  const key = geoCacheKey(q);
  const db  = await readDb();
  if (db.geocache[key]) return reply(req, res, 200, { coords: db.geocache[key], cached: true });

  let coords = await geocodePhoton(q);
  if (!coords) coords = await geocodeNominatim(q);

  if (coords) {
    const db2 = await readDb();
    db2.geocache[key] = coords;
    await writeDb(db2);
  }
  return reply(req, res, 200, { coords: coords || null, cached: false });
}

// ── Admin ─────────────────────────────────────────────────

const requireAdmin = (user) => user?.role === 'admin';

async function handleAdminUsers(req, res, adminUser) {
  if (!requireAdmin(adminUser)) return reply(req, res, 403, { error: 'Forbidden' });
  const db = await readDb();

  if (req.method === 'GET') {
    const users = db.users.map((u) => ({
      id: u.id, login: u.login, role: u.role, createdAt: u.createdAt,
      routeCount: db.routes.filter((r) => r.userId === u.id).length
    }));
    return reply(req, res, 200, { users });
  }

  if (req.method === 'POST') {
    const { login, password, role } = await readBody(req);
    if (!login || !password) return reply(req, res, 400, { error: 'Логин и пароль обязательны' });
    const trimmed = String(login).trim();
    if (db.users.find((u) => u.login === trimmed)) return reply(req, res, 409, { error: 'Логин уже занят' });
    const newUser = {
      id: makeId('user'), login: trimmed,
      passwordHash: hashPassword(String(password)),
      role: role === 'admin' ? 'admin' : 'driver',
      createdAt: new Date().toISOString()
    };
    db.users.push(newUser);
    await writeDb(db);
    return reply(req, res, 201, { user: { id: newUser.id, login: newUser.login, role: newUser.role } });
  }

  return reply(req, res, 405, { error: 'Method Not Allowed' });
}

async function handleAdminUserById(req, res, adminUser, userId) {
  if (!requireAdmin(adminUser)) return reply(req, res, 403, { error: 'Forbidden' });
  const db     = await readDb();
  const target = db.users.find((u) => u.id === userId);
  if (!target) return reply(req, res, 404, { error: 'Пользователь не найден' });

  if (req.method === 'DELETE') {
    if (userId === adminUser.id) return reply(req, res, 400, { error: 'Нельзя удалить себя' });
    const routeIds = db.routes.filter((r) => r.userId === userId).map((r) => r.id);
    db.users        = db.users.filter((u) => u.id !== userId);
    db.sessions     = db.sessions.filter((s) => s.userId !== userId);
    db.routes       = db.routes.filter((r) => r.userId !== userId);
    db.routeItems   = db.routeItems.filter((ri) => !routeIds.includes(ri.routeId));
    db.monthlyStats = db.monthlyStats.filter((s) => s.userId !== userId);
    await writeDb(db);
    return reply(req, res, 200, { ok: true });
  }

  return reply(req, res, 405, { error: 'Method Not Allowed' });
}

async function handleAdminUserClear(req, res, adminUser, userId) {
  if (!requireAdmin(adminUser)) return reply(req, res, 403, { error: 'Forbidden' });
  if (req.method !== 'POST')    return reply(req, res, 405, { error: 'Method Not Allowed' });
  const db     = await readDb();
  const target = db.users.find((u) => u.id === userId);
  if (!target) return reply(req, res, 404, { error: 'Пользователь не найден' });
  const routeIds = db.routes.filter((r) => r.userId === userId).map((r) => r.id);
  db.routes       = db.routes.filter((r) => r.userId !== userId);
  db.routeItems   = db.routeItems.filter((ri) => !routeIds.includes(ri.routeId));
  db.monthlyStats = db.monthlyStats.filter((s) => s.userId !== userId);
  db.sessions     = db.sessions.filter((s) => s.userId !== userId);
  await writeDb(db);
  return reply(req, res, 200, { ok: true });
}

// ── Router ────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, buildJsonHeaders(req.headers.origin || ''));
    return res.end();
  }
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;

    // Static files — no auth required
    if (!path.startsWith('/api/')) {
      if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, path);
      return reply(req, res, 405, { error: 'Method Not Allowed' });
    }

    // API routes
    if (req.method === 'POST' && path === '/api/login')  return handleLogin(req, res);
    if (req.method === 'POST' && path === '/api/logout') return handleLogout(req, res);
    if (path === '/api/me') return handleMe(req, res);

    const user = await getCurrentUser(req);
    if (!user) return reply(req, res, 401, { error: 'Unauthorized' });

    if (req.method === 'GET' && path === '/api/geocode') return handleGeocode(req, res);
    if (path === '/api/routes')        return handleRoutes(req, res, user);
    if (path === '/api/stats/monthly') return handleStats(req, res, user);
    if (path === '/api/admin/users')   return handleAdminUsers(req, res, user);

    const itemsMatch = path.match(/^\/api\/routes\/([^/]+)\/items$/);
    if (itemsMatch) return handleRouteItems(req, res, user, itemsMatch[1]);

    const adminClearMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/clear$/);
    if (adminClearMatch) return handleAdminUserClear(req, res, user, adminClearMatch[1]);

    const adminUserMatch  = path.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (adminUserMatch)   return handleAdminUserById(req, res, user, adminUserMatch[1]);

    return reply(req, res, 404, { error: 'Not Found' });
  } catch (error) {
    console.error(error);
    return reply(req, res, 500, { error: 'Internal Server Error' });
  }
});

await ensureDb();
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.log(`[api] port ${PORT} already in use — skipping`);
  else { console.error('[api] server error:', err); process.exit(1); }
});
server.listen(PORT, () => console.log(`API server running on http://localhost:${PORT}`));
