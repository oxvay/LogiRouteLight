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
const allowedOrigins = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);

function buildJsonHeaders(origin = '') {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  };
}

async function ensureDb() {
  await fs.mkdir(dataDir, { recursive: true });
  let shouldWrite = false;
  let db;
  try {
    const raw = await fs.readFile(dbFile, 'utf8');
    db = JSON.parse(raw);
  } catch {
    db = { users: [], sessions: [], routes: [], routeItems: [], monthlyStats: [] };
    shouldWrite = true;
  }
  
  if (!db.users.find(u => u.login === 'admin')) {
    db.users.push({
      id: makeId('user'),
      login: 'admin',
      passwordHash: hashPassword('admin123'),
      role: 'admin',
      createdAt: new Date().toISOString()
    });
    shouldWrite = true;
  }
  if (!db.users.find(u => u.login === 'driver')) {
    // Preserve old id style for testing backwards compat if file was deleted
    db.users.push({
      id: 'user-admin',
      login: 'driver',
      passwordHash: hashPassword('driver123'),
      role: 'driver',
      createdAt: new Date().toISOString()
    });
    shouldWrite = true;
  }

  if (shouldWrite) {
    await fs.writeFile(dbFile, JSON.stringify(db, null, 2), 'utf8');
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

async function handleLogin(req, res) {
  const { login, password } = await readBody(req);
  const db = await readDb();
  const normalizedLogin = String(login || '').trim();
  const normalizedPassword = String(password || '').trim();
  const user = db.users.find((item) => item.login === normalizedLogin && item.passwordHash === hashPassword(normalizedPassword));
  if (!user) {
    return sendJson(res, 401, { error: 'Неверный логин или пароль' }, {}, req.headers.origin || '');
  }

  const token = makeId('sess');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();
  db.sessions = db.sessions.filter((item) => item.userId !== user.id);
  db.sessions.push({ id: makeId('session'), userId: user.id, token, expiresAt });
  await writeDb(db);

  return sendJson(
    res,
    200,
    { user: { id: user.id, login: user.login, role: user.role }, token },
    { 'Set-Cookie': `sessionToken=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${60 * 60 * 12}` },
    req.headers.origin || ''
  );
}

async function handleLogoutAPI(req, res) {
  const token = getSessionToken(req);
  if (token) {
    const db = await readDb();
    db.sessions = db.sessions.filter(s => s.token !== token);
    await writeDb(db);
  }
  return sendJson(
    res,
    200,
    { success: true },
    { 'Set-Cookie': 'sessionToken=; HttpOnly; Path=/; Max-Age=0' },
    req.headers.origin || ''
  );
}

async function handleRoutes(req, res, user) {
  const db = await readDb();
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET') {
    const date = url.searchParams.get('date');
    const routes = db.routes.filter((route) => route.userId === user.id && (!date || route.routeDate === date));
    return sendJson(res, 200, { routes }, {}, req.headers.origin || '');
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    const routeId = makeId('route');
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

    const key = `${user.id}:${monthKey(new Date(routeDate))}`;
    const stat = db.monthlyStats.find((item) => item.key === key) || {
      id: makeId('stat'),
      key,
      userId: user.id,
      month: monthKey(new Date(routeDate)),
      completedRoutesCount: 0
    };
    if (!db.monthlyStats.find((item) => item.key === key)) db.monthlyStats.push(stat);
    await writeDb(db);

    return sendJson(res, 201, { route }, {}, req.headers.origin || '');
  }

  return sendJson(res, 405, { error: 'Method Not Allowed' }, {}, req.headers.origin || '');
}

async function handleStats(req, res, user) {
  const db = await readDb();
  const month = monthKey();
  const stat = db.monthlyStats.find((item) => item.userId === user.id && item.month === month) || { completedRoutesCount: 0 };
  return sendJson(res, 200, { month, completedRoutesCount: stat.completedRoutesCount }, {}, req.headers.origin || '');
}

async function handleAdminUsers(req, res) {
  const db = await readDb();
  if (req.method === 'GET') {
    const users = db.users.map(u => ({ id: u.id, login: u.login, role: u.role, createdAt: u.createdAt }));
    return sendJson(res, 200, { users }, {}, req.headers.origin || '');
  }
  if (req.method === 'POST') {
    const body = await readBody(req);
    const login = (body.login || '').trim();
    const password = (body.password || '').trim();
    if (!login || !password) return sendJson(res, 400, { error: 'Login and password are required' }, {}, req.headers.origin || '');
    if (db.users.find(u => u.login === login)) return sendJson(res, 400, { error: 'Login already taken' }, {}, req.headers.origin || '');
    
    const newUser = {
      id: makeId('user'),
      login,
      passwordHash: hashPassword(password),
      role: 'driver',
      createdAt: new Date().toISOString()
    };
    db.users.push(newUser);
    await writeDb(db);
    return sendJson(res, 201, { user: { id: newUser.id, login: newUser.login, role: newUser.role } }, {}, req.headers.origin || '');
  }
  return sendJson(res, 405, { error: 'Method Not Allowed' }, {}, req.headers.origin || '');
}

async function handleMe(req, res) {
  const user = await getCurrentUser(req);
  if (!user) return sendJson(res, 401, { error: 'Unauthorized' }, {}, req.headers.origin || '');
  return sendJson(res, 200, { user: { id: user.id, login: user.login, role: user.role } }, {}, req.headers.origin || '');
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, buildJsonHeaders(req.headers.origin || ''));
    return res.end();
  }

  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/api/login') return handleLogin(req, res);
    if (req.method === 'POST' && url.pathname === '/api/logout') return handleLogoutAPI(req, res);
    if (url.pathname === '/api/me') return handleMe(req, res);

    const user = await getCurrentUser(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' }, {}, req.headers.origin || '');

    if (url.pathname.startsWith('/api/admin')) {
      if (user.role !== 'admin') return sendJson(res, 403, { error: 'Forbidden' }, {}, req.headers.origin || '');
      
      const userMatch = url.pathname.match(/^\/api\/admin\/users\/(.+)$/);
      if (userMatch && req.method === 'DELETE') {
        const targetUserId = userMatch[1];
        if (targetUserId === user.id) return sendJson(res, 400, { error: 'Нельзя удалить самого себя' }, {}, req.headers.origin || '');
        
        const db = await readDb();
        db.users = db.users.filter(u => u.id !== targetUserId);
        db.sessions = db.sessions.filter(s => s.userId !== targetUserId);
        db.monthlyStats = db.monthlyStats.filter(s => s.userId !== targetUserId);
        
        const routesToDelete = db.routes.filter(r => r.userId === targetUserId).map(r => r.id);
        if (routesToDelete.length) {
          db.routes = db.routes.filter(r => r.userId !== targetUserId);
          db.routeItems = db.routeItems.filter(i => !routesToDelete.includes(i.routeId));
        }
        
        await writeDb(db);
        return sendJson(res, 200, { success: true }, {}, req.headers.origin || '');
      }

      if (url.pathname === '/api/admin/users') return handleAdminUsers(req, res);
    }

    if (url.pathname === '/api/routes') return handleRoutes(req, res, user);
    if (url.pathname === '/api/stats/monthly') return handleStats(req, res, user);

    const itemsMatch = url.pathname.match(/^\/api\/routes\/([^/]+)\/items$/);
    if (itemsMatch && req.method === 'GET') {
      const db = await readDb();
      const routeId = itemsMatch[1];
      const route = db.routes.find(r => r.id === routeId && r.userId === user.id);
      if (!route) return sendJson(res, 404, { error: 'Route not found' }, {}, req.headers.origin || '');
      const items = db.routeItems.filter(it => it.routeId === routeId);
      return sendJson(res, 200, { items }, {}, req.headers.origin || '');
    }

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
server.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});
