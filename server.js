import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, 'data');
const dbFile = path.join(dataDir, 'db.json');
const PORT = Number(process.env.PORT || 3001);

const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30;

function buildJsonHeaders(origin = '') {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
  };
}

async function ensureDb() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(dbFile);
  } catch {
    const seed = {
      users: [
        {
          id: 'user-driver',
          login: 'driver',
          passwordHash: hashPassword('driver123'),
          role: 'driver',
          createdAt: new Date().toISOString()
        },
        {
          id: 'user-admin-root',
          login: 'admin',
          passwordHash: hashPassword('admin123'),
          role: 'admin',
          createdAt: new Date().toISOString()
        }
      ],
      sessions: [],
      routes: [],
      routeItems: [],
      monthlyStats: []
    };
    await fs.writeFile(dbFile, JSON.stringify(seed, null, 2), 'utf8');
  }
}

async function readDb() {
  await ensureDb();
  return JSON.parse(await fs.readFile(dbFile, 'utf8'));
}

async function writeDb(db) {
  await fs.writeFile(dbFile, JSON.stringify(db, null, 2), 'utf8');
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((acc, pair) => {
    const [key, ...rest] = pair.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function sendJson(res, statusCode, payload, extraHeaders = {}, origin = '') {
  res.writeHead(statusCode, { ...buildJsonHeaders(origin), ...extraHeaders });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function getSessionToken(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return cookies.sessionToken || '';
}

async function getCurrentUser(req) {
  const token = getSessionToken(req);
  if (!token) return null;
  const db = await readDb();
  const session = db.sessions.find((item) => item.token === token && new Date(item.expiresAt) > new Date());
  if (!session) return null;
  return db.users.find((user) => user.id === session.userId) || null;
}

function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

// ── Auth ──────────────────────────────────────────────────

async function handleLogin(req, res) {
  const { login, password } = await readBody(req);
  const db = await readDb();
  const normalizedLogin    = String(login    || '').trim();
  const normalizedPassword = String(password || '').trim();
  const user = db.users.find(
    (item) => item.login === normalizedLogin && item.passwordHash === hashPassword(normalizedPassword)
  );
  if (!user) return sendJson(res, 401, { error: 'Неверный логин или пароль' }, {}, req.headers.origin || '');

  const token    = makeId('sess');
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  db.sessions = db.sessions.filter((item) => item.userId !== user.id);
  db.sessions.push({ id: makeId('session'), userId: user.id, token, expiresAt });
  await writeDb(db);

  return sendJson(
    res, 200,
    { user: { id: user.id, login: user.login, role: user.role }, token },
    { 'Set-Cookie': `sessionToken=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE_SEC}` },
    req.headers.origin || ''
  );
}

async function handleLogout(req, res) {
  const token = getSessionToken(req);
  if (token) {
    const db = await readDb();
    db.sessions = db.sessions.filter((s) => s.token !== token);
    await writeDb(db);
  }
  return sendJson(
    res, 200, { ok: true },
    { 'Set-Cookie': 'sessionToken=; HttpOnly; Path=/; Max-Age=0' },
    req.headers.origin || ''
  );
}

// ── Routes ────────────────────────────────────────────────

async function handleRoutes(req, res, user) {
  const db  = await readDb();
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET') {
    const date  = url.searchParams.get('date');
    const month = url.searchParams.get('month');
    const routes = db.routes.filter(
      (r) =>
        r.userId === user.id &&
        (!date  || r.routeDate === date) &&
        (!month || r.routeDate.startsWith(month))
    );
    return sendJson(res, 200, { routes }, {}, req.headers.origin || '');
  }

  if (req.method === 'POST') {
    const body      = await readBody(req);
    const routeId   = makeId('route');
    const routeDate = body.routeDate || new Date().toISOString().slice(0, 10);
    const route = {
      id: routeId,
      userId: user.id,
      routeDate,
      sourceFileName: body.sourceFileName || '',
      status: body.status || 'active',
      createdAt: new Date().toISOString()
    };
    db.routes.push(route);
    for (const item of body.items || []) {
      db.routeItems.push({ id: makeId('item'), routeId, ...item });
    }
    const key  = `${user.id}:${monthKey(new Date(routeDate))}`;
    const stat = db.monthlyStats.find((s) => s.key === key) || {
      id: makeId('stat'), key, userId: user.id,
      month: monthKey(new Date(routeDate)), completedRoutesCount: 0
    };
    if (!db.monthlyStats.find((s) => s.key === key)) db.monthlyStats.push(stat);
    await writeDb(db);
    return sendJson(res, 201, { route }, {}, req.headers.origin || '');
  }

  return sendJson(res, 405, { error: 'Method Not Allowed' }, {}, req.headers.origin || '');
}

async function handleStats(req, res, user) {
  const db   = await readDb();
  const month = monthKey();
  const stat  = db.monthlyStats.find((s) => s.userId === user.id && s.month === month) || { completedRoutesCount: 0 };
  return sendJson(res, 200, { month, completedRoutesCount: stat.completedRoutesCount }, {}, req.headers.origin || '');
}

async function handleMe(req, res) {
  const user = await getCurrentUser(req);
  if (!user) return sendJson(res, 401, { error: 'Unauthorized' }, {}, req.headers.origin || '');
  return sendJson(res, 200, { user: { id: user.id, login: user.login, role: user.role } }, {}, req.headers.origin || '');
}

// ── Admin ─────────────────────────────────────────────────

function requireAdmin(user) { return user && user.role === 'admin'; }

async function handleAdminUsers(req, res, adminUser) {
  if (!requireAdmin(adminUser)) return sendJson(res, 403, { error: 'Forbidden' }, {}, req.headers.origin || '');
  const db = await readDb();

  if (req.method === 'GET') {
    const users = db.users.map((u) => ({
      id: u.id, login: u.login, role: u.role, createdAt: u.createdAt,
      routeCount: db.routes.filter((r) => r.userId === u.id).length
    }));
    return sendJson(res, 200, { users }, {}, req.headers.origin || '');
  }

  if (req.method === 'POST') {
    const { login, password, role } = await readBody(req);
    if (!login || !password) return sendJson(res, 400, { error: 'Логин и пароль обязательны' }, {}, req.headers.origin || '');
    const trimmed = String(login).trim();
    if (db.users.find((u) => u.login === trimmed)) return sendJson(res, 409, { error: 'Логин уже занят' }, {}, req.headers.origin || '');
    const newUser = {
      id: makeId('user'), login: trimmed,
      passwordHash: hashPassword(String(password)),
      role: role === 'admin' ? 'admin' : 'driver',
      createdAt: new Date().toISOString()
    };
    db.users.push(newUser);
    await writeDb(db);
    return sendJson(res, 201, { user: { id: newUser.id, login: newUser.login, role: newUser.role } }, {}, req.headers.origin || '');
  }

  return sendJson(res, 405, { error: 'Method Not Allowed' }, {}, req.headers.origin || '');
}

async function handleAdminUserById(req, res, adminUser, userId) {
  if (!requireAdmin(adminUser)) return sendJson(res, 403, { error: 'Forbidden' }, {}, req.headers.origin || '');
  const db     = await readDb();
  const target = db.users.find((u) => u.id === userId);
  if (!target) return sendJson(res, 404, { error: 'Пользователь не найден' }, {}, req.headers.origin || '');

  if (req.method === 'DELETE') {
    if (userId === adminUser.id) return sendJson(res, 400, { error: 'Нельзя удалить себя' }, {}, req.headers.origin || '');
    db.users      = db.users.filter((u) => u.id !== userId);
    db.sessions   = db.sessions.filter((s) => s.userId !== userId);
    const routeIds = db.routes.filter((r) => r.userId === userId).map((r) => r.id);
    db.routes      = db.routes.filter((r) => r.userId !== userId);
    db.routeItems  = db.routeItems.filter((ri) => !routeIds.includes(ri.routeId));
    db.monthlyStats = db.monthlyStats.filter((s) => s.userId !== userId);
    await writeDb(db);
    return sendJson(res, 200, { ok: true }, {}, req.headers.origin || '');
  }

  return sendJson(res, 405, { error: 'Method Not Allowed' }, {}, req.headers.origin || '');
}

async function handleAdminUserClear(req, res, adminUser, userId) {
  if (!requireAdmin(adminUser)) return sendJson(res, 403, { error: 'Forbidden' }, {}, req.headers.origin || '');
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' }, {}, req.headers.origin || '');
  const db     = await readDb();
  const target = db.users.find((u) => u.id === userId);
  if (!target) return sendJson(res, 404, { error: 'Пользователь не найден' }, {}, req.headers.origin || '');
  const routeIds  = db.routes.filter((r) => r.userId === userId).map((r) => r.id);
  db.routes       = db.routes.filter((r) => r.userId !== userId);
  db.routeItems   = db.routeItems.filter((ri) => !routeIds.includes(ri.routeId));
  db.monthlyStats = db.monthlyStats.filter((s) => s.userId !== userId);
  db.sessions     = db.sessions.filter((s) => s.userId !== userId);
  await writeDb(db);
  return sendJson(res, 200, { ok: true }, {}, req.headers.origin || '');
}

// ── Router ────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, buildJsonHeaders(req.headers.origin || ''));
    return res.end();
  }
  try {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'POST' && url.pathname === '/api/login')  return handleLogin(req, res);
    if (req.method === 'POST' && url.pathname === '/api/logout') return handleLogout(req, res);
    if (url.pathname === '/api/me') return handleMe(req, res);

    const user = await getCurrentUser(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' }, {}, req.headers.origin || '');

    if (url.pathname === '/api/routes')        return handleRoutes(req, res, user);
    if (url.pathname === '/api/stats/monthly') return handleStats(req, res, user);

    const itemsMatch = url.pathname.match(/^\/api\/routes\/([^/]+)\/items$/);
    if (itemsMatch && req.method === 'GET') {
      const db      = await readDb();
      const routeId = itemsMatch[1];
      const route   = db.routes.find((r) => r.id === routeId && r.userId === user.id);
      if (!route) return sendJson(res, 404, { error: 'Route not found' }, {}, req.headers.origin || '');
      const items = db.routeItems.filter((it) => it.routeId === routeId);
      return sendJson(res, 200, { items }, {}, req.headers.origin || '');
    }

    if (url.pathname === '/api/admin/users') return handleAdminUsers(req, res, user);

    const adminUserMatch  = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (adminUserMatch)  return handleAdminUserById(req, res, user, adminUserMatch[1]);

    const adminClearMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/clear$/);
    if (adminClearMatch) return handleAdminUserClear(req, res, user, adminClearMatch[1]);

    return sendJson(res, 404, { error: 'Not Found' }, {}, req.headers.origin || '');
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: 'Internal Server Error' }, {}, req.headers.origin || '');
  }
});

await ensureDb();
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`[api] port ${PORT} already in use — skipping`);
  } else {
    console.error('[api] server error:', err);
    process.exit(1);
  }
});
server.listen(PORT, () => console.log(`API server running on http://localhost:${PORT}`));
