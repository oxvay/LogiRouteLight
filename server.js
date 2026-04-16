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
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'http://localhost:5173',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
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
          id: 'user-admin',
          login: 'driver',
          passwordHash: hashPassword('driver123'),
          role: 'driver',
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
    if (url.pathname === '/api/me') return handleMe(req, res);

    const user = await getCurrentUser(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' }, {}, req.headers.origin || '');

    if (url.pathname === '/api/routes') return handleRoutes(req, res, user);
    if (url.pathname === '/api/stats/monthly') return handleStats(req, res, user);

    return sendJson(res, 404, { error: 'Not Found' }, {}, req.headers.origin || '');
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: 'Internal Server Error' }, {}, req.headers.origin || '');
  }
});

await ensureDb();
server.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});
