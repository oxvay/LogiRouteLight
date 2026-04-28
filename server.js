import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { pool } from './db/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PORT       = Number(process.env.PORT || 3001);
const distDir    = path.join(__dirname, 'dist');

// ── Static ────────────────────────────────────────────────
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

// ── Constants ─────────────────────────────────────────────
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30;

// ── Utilities ─────────────────────────────────────────────
const hashPassword = (p) => crypto.createHash('sha256').update(p).digest('hex');
const makeId       = (prefix) => `${prefix}_${crypto.randomUUID()}`;

function buildJsonHeaders(origin = '') {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS'
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

async function getCurrentUser(req) {
  const token = getSessionToken(req);
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.login, u.role, u.full_name AS "fullName"
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now()
      LIMIT 1`,
    [token]
  );
  return rows[0] || null;
}

const isOps      = (u) => !!u && (u.role === 'manager' || u.role === 'supervisor' || u.role === 'admin');
const isElevated = (u) => !!u && (u.role === 'supervisor' || u.role === 'admin');

// ── Auth ──────────────────────────────────────────────────
async function handleLogin(req, res) {
  const { login, password } = await readBody(req);
  const { rows } = await pool.query(
    `SELECT id, login, password_hash AS "passwordHash", role, full_name AS "fullName"
       FROM users
      WHERE login = $1
      LIMIT 1`,
    [String(login || '').trim()]
  );
  const user = rows[0];
  if (!user || user.passwordHash !== hashPassword(String(password || '').trim())) {
    return reply(req, res, 401, { error: 'Неверный логин или пароль' });
  }
  const token     = makeId('sess');
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [user.id]);
  await pool.query(
    `INSERT INTO sessions (id, user_id, token, expires_at) VALUES ($1, $2, $3, $4)`,
    [makeId('session'), user.id, token, expiresAt]
  );
  return reply(req, res, 200,
    { user: { id: user.id, login: user.login, role: user.role, fullName: user.fullName }, token },
    { 'Set-Cookie': `sessionToken=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE_SEC}` }
  );
}
async function handleLogout(req, res) {
  const token = getSessionToken(req);
  if (token) await pool.query(`DELETE FROM sessions WHERE token = $1`, [token]);
  return reply(req, res, 200, { ok: true },
    { 'Set-Cookie': 'sessionToken=; HttpOnly; Path=/; Max-Age=0' });
}
async function handleMe(req, res) {
  const user = await getCurrentUser(req);
  if (!user) return reply(req, res, 401, { error: 'Unauthorized' });
  return reply(req, res, 200, { user });
}

// ── Orders ────────────────────────────────────────────────
const ORDER_COLS = `
  id,
  to_char(route_date, 'YYYY-MM-DD') AS "routeDate",
  address, description,
  to_char(scheduled_time, 'HH24:MI') AS "scheduledTime",
  status, assigned_driver_id AS "assignedDriverId", created_by AS "createdBy",
  sequence_index AS "sequenceIndex", buyer, comment, weight_kg AS "weightKg",
  external_order_no AS "externalOrderNo",
  geocoded_lat AS "geocodedLat", geocoded_lon AS "geocodedLon",
  delivered_at AS "deliveredAt",
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

async function handleOrders(req, res, user) {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET') {
    const date       = url.searchParams.get('date');
    const month      = url.searchParams.get('month');
    const driverId   = url.searchParams.get('driverId');
    const unassigned = url.searchParams.get('unassigned') === 'true';
    const inbox      = url.searchParams.get('inbox') === 'true';

    const where = [];
    const args  = [];
    if (inbox) {
      // Inbox = no scheduled date, no driver yet.
      where.push(`route_date IS NULL AND assigned_driver_id IS NULL`);
    } else {
      if (date)  { args.push(date);  where.push(`route_date = $${args.length}`); }
      if (month) { args.push(month); where.push(`to_char(route_date, 'YYYY-MM') = $${args.length}`); }
    }

    // Drivers can only see their own assigned orders; ops can filter freely.
    if (user.role === 'driver') {
      args.push(user.id); where.push(`assigned_driver_id = $${args.length}`);
    } else if (driverId) {
      args.push(driverId); where.push(`assigned_driver_id = $${args.length}`);
    } else if (unassigned) {
      where.push(`assigned_driver_id IS NULL`);
    }

    const sql = `SELECT ${ORDER_COLS} FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY route_date, sequence_index NULLS LAST, scheduled_time NULLS LAST, created_at`;
    const { rows } = await pool.query(sql, args);
    return reply(req, res, 200, { orders: rows });
  }

  if (req.method === 'POST') {
    if (!isOps(user)) return reply(req, res, 403, { error: 'Forbidden' });
    const body = await readBody(req);
    const id   = makeId('ord');
    // routeDate may be null → goes to the inbox.
    const routeDate = body.routeDate === undefined ? new Date().toISOString().slice(0, 10) : body.routeDate;
    const status    = body.assignedDriverId ? 'assigned' : 'pending';
    await pool.query(
      `INSERT INTO orders
       (id, route_date, address, description, scheduled_time, status,
        assigned_driver_id, created_by, sequence_index, buyer, comment,
        weight_kg, external_order_no, geocoded_lat, geocoded_lon)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [id, routeDate, String(body.address || '').trim(), body.description || null,
       body.scheduledTime || null, status,
       body.assignedDriverId || null, user.id, body.sequenceIndex ?? null,
       body.buyer || null, body.comment || null,
       body.weightKg ?? null, body.externalOrderNo || null,
       body.geocodedLat ?? null, body.geocodedLon ?? null]
    );
    await pool.query(
      `INSERT INTO order_status_log (order_id, old_status, new_status, changed_by)
       VALUES ($1, NULL, $2, $3)`,
      [id, status, user.id]
    );
    const { rows } = await pool.query(`SELECT ${ORDER_COLS} FROM orders WHERE id = $1`, [id]);
    return reply(req, res, 201, { order: rows[0] });
  }

  return reply(req, res, 405, { error: 'Method Not Allowed' });
}

const DRIVER_ALLOWED_TRANSITIONS = {
  assigned:    ['in_progress', 'delivered', 'failed'],
  in_progress: ['delivered', 'failed'],
  delivered:   ['in_progress'], // allow undo
  failed:      ['in_progress'],
};

async function handleOrderById(req, res, user, orderId) {
  const { rows: existingRows } = await pool.query(
    `SELECT ${ORDER_COLS} FROM orders WHERE id = $1`, [orderId]
  );
  const existing = existingRows[0];
  if (!existing) return reply(req, res, 404, { error: 'Order not found' });

  if (req.method === 'PATCH') {
    const body = await readBody(req);

    // Drivers can only mutate status on their own orders, within allowed transitions.
    if (user.role === 'driver') {
      if (existing.assignedDriverId !== user.id) return reply(req, res, 403, { error: 'Forbidden' });
      const next = body.status;
      const allowed = DRIVER_ALLOWED_TRANSITIONS[existing.status] || [];
      if (!next || !allowed.includes(next)) return reply(req, res, 400, { error: 'Invalid transition' });
      await applyStatus(orderId, existing.status, next, user.id);
      const { rows } = await pool.query(`SELECT ${ORDER_COLS} FROM orders WHERE id = $1`, [orderId]);
      return reply(req, res, 200, { order: rows[0] });
    }

    if (!isOps(user)) return reply(req, res, 403, { error: 'Forbidden' });

    // Ops can edit anything. Build dynamic SET clause.
    const sets = [];
    const args = [];
    const map  = {
      address: 'address', description: 'description', scheduledTime: 'scheduled_time',
      assignedDriverId: 'assigned_driver_id', sequenceIndex: 'sequence_index',
      buyer: 'buyer', comment: 'comment', weightKg: 'weight_kg',
      externalOrderNo: 'external_order_no',
      geocodedLat: 'geocoded_lat', geocodedLon: 'geocoded_lon',
      routeDate: 'route_date',
    };
    for (const [k, col] of Object.entries(map)) {
      if (k in body) { args.push(body[k] === '' ? null : body[k]); sets.push(`${col} = $${args.length}`); }
    }

    // Auto-promote pending → assigned when a driver is set, and demote to pending when cleared.
    let nextStatus = body.status;
    if (!nextStatus && 'assignedDriverId' in body) {
      if (body.assignedDriverId && existing.status === 'pending') nextStatus = 'assigned';
      else if (!body.assignedDriverId && existing.status === 'assigned') nextStatus = 'pending';
    }
    if (nextStatus && nextStatus !== existing.status) {
      args.push(nextStatus); sets.push(`status = $${args.length}`);
      if (nextStatus === 'delivered') sets.push(`delivered_at = now()`);
      else if (existing.status === 'delivered') sets.push(`delivered_at = NULL`);
    }

    if (sets.length) {
      sets.push(`updated_at = now()`);
      args.push(orderId);
      await pool.query(`UPDATE orders SET ${sets.join(', ')} WHERE id = $${args.length}`, args);
    }
    if (nextStatus && nextStatus !== existing.status) {
      await pool.query(
        `INSERT INTO order_status_log (order_id, old_status, new_status, changed_by)
         VALUES ($1, $2, $3, $4)`,
        [orderId, existing.status, nextStatus, user.id]
      );
    }
    const { rows } = await pool.query(`SELECT ${ORDER_COLS} FROM orders WHERE id = $1`, [orderId]);
    return reply(req, res, 200, { order: rows[0] });
  }

  if (req.method === 'DELETE') {
    if (!isOps(user)) return reply(req, res, 403, { error: 'Forbidden' });
    await pool.query(`DELETE FROM orders WHERE id = $1`, [orderId]);
    return reply(req, res, 200, { ok: true });
  }

  return reply(req, res, 405, { error: 'Method Not Allowed' });
}

async function applyStatus(orderId, oldStatus, newStatus, userId) {
  const setDelivered = newStatus === 'delivered'
    ? `, delivered_at = now()`
    : (oldStatus === 'delivered' ? `, delivered_at = NULL` : '');
  await pool.query(
    `UPDATE orders SET status = $1, updated_at = now()${setDelivered} WHERE id = $2`,
    [newStatus, orderId]
  );
  await pool.query(
    `INSERT INTO order_status_log (order_id, old_status, new_status, changed_by)
     VALUES ($1, $2, $3, $4)`,
    [orderId, oldStatus, newStatus, userId]
  );
}

// ── Catalog (objects / recurring delivery points) ─────────
const CATALOG_COLS = `
  id, address, description,
  to_char(default_time, 'HH24:MI') AS "defaultTime",
  buyer, weight_kg AS "weightKg", external_no AS "externalNo",
  comment, notes,
  created_by AS "createdBy",
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

async function handleCatalog(req, res, user) {
  if (!isOps(user)) return reply(req, res, 403, { error: 'Forbidden' });

  if (req.method === 'GET') {
    const { rows } = await pool.query(
      `SELECT ${CATALOG_COLS} FROM catalog_objects ORDER BY address`
    );
    return reply(req, res, 200, { catalog: rows });
  }

  if (req.method === 'POST') {
    const body    = await readBody(req);
    const address = String(body.address || '').trim();
    if (!address) return reply(req, res, 400, { error: 'Адрес обязателен' });
    const id = makeId('cat');
    await pool.query(
      `INSERT INTO catalog_objects
       (id, address, description, default_time, buyer, weight_kg, external_no, comment, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, address, body.description || null, body.defaultTime || null,
       body.buyer || null, body.weightKg ?? null, body.externalNo || null,
       body.comment || null, body.notes || null, user.id]
    );
    const { rows } = await pool.query(`SELECT ${CATALOG_COLS} FROM catalog_objects WHERE id = $1`, [id]);
    return reply(req, res, 201, { object: rows[0] });
  }

  return reply(req, res, 405, { error: 'Method Not Allowed' });
}

async function handleCatalogById(req, res, user, id) {
  if (!isOps(user)) return reply(req, res, 403, { error: 'Forbidden' });
  const { rows: existing } = await pool.query(`SELECT id FROM catalog_objects WHERE id = $1`, [id]);
  if (!existing.length) return reply(req, res, 404, { error: 'Не найдено' });

  if (req.method === 'PATCH') {
    const body = await readBody(req);
    const sets = [];
    const args = [];
    const map  = {
      address: 'address', description: 'description', defaultTime: 'default_time',
      buyer: 'buyer', weightKg: 'weight_kg', externalNo: 'external_no',
      comment: 'comment', notes: 'notes'
    };
    for (const [k, col] of Object.entries(map)) {
      if (k in body) { args.push(body[k] === '' ? null : body[k]); sets.push(`${col} = $${args.length}`); }
    }
    if (!sets.length) return reply(req, res, 400, { error: 'Нет изменений' });
    sets.push(`updated_at = now()`);
    args.push(id);
    await pool.query(`UPDATE catalog_objects SET ${sets.join(', ')} WHERE id = $${args.length}`, args);
    const { rows } = await pool.query(`SELECT ${CATALOG_COLS} FROM catalog_objects WHERE id = $1`, [id]);
    return reply(req, res, 200, { object: rows[0] });
  }

  if (req.method === 'DELETE') {
    await pool.query(`DELETE FROM catalog_objects WHERE id = $1`, [id]);
    return reply(req, res, 200, { ok: true });
  }

  return reply(req, res, 405, { error: 'Method Not Allowed' });
}

// Create a fresh order from a catalog entry. The catalog entry itself stays put.
async function handleCatalogAssign(req, res, user, catalogId) {
  if (!isOps(user)) return reply(req, res, 403, { error: 'Forbidden' });
  if (req.method !== 'POST') return reply(req, res, 405, { error: 'Method Not Allowed' });

  const { rows: cats } = await pool.query(
    `SELECT id, address, description,
            to_char(default_time, 'HH24:MI') AS default_time,
            buyer, weight_kg, external_no, comment
       FROM catalog_objects WHERE id = $1`,
    [catalogId]
  );
  const cat = cats[0];
  if (!cat) return reply(req, res, 404, { error: 'Объект каталога не найден' });

  const body      = await readBody(req);
  const routeDate = body.routeDate || new Date().toISOString().slice(0, 10);
  const driverId  = body.assignedDriverId || null;
  const orderId   = makeId('ord');
  const status    = driverId ? 'assigned' : 'pending';
  const time      = body.scheduledTime !== undefined ? body.scheduledTime : cat.default_time;

  await pool.query(
    `INSERT INTO orders
     (id, route_date, address, description, scheduled_time, status,
      assigned_driver_id, created_by, buyer, comment, weight_kg, external_order_no,
      catalog_object_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [orderId, routeDate,
     body.address         ?? cat.address,
     body.description     ?? cat.description,
     time || null,
     status, driverId, user.id,
     body.buyer           ?? cat.buyer,
     body.comment         ?? cat.comment,
     body.weightKg        ?? cat.weight_kg,
     body.externalOrderNo ?? cat.external_no,
     cat.id]
  );

  await pool.query(
    `INSERT INTO order_status_log (order_id, old_status, new_status, changed_by)
     VALUES ($1, NULL, $2, $3)`,
    [orderId, status, user.id]
  );

  const { rows } = await pool.query(`SELECT ${ORDER_COLS} FROM orders WHERE id = $1`, [orderId]);
  return reply(req, res, 201, { order: rows[0] });
}

// ── Drivers list (for assignment dropdown) ────────────────
async function handleDrivers(req, res, user) {
  if (!isOps(user)) return reply(req, res, 403, { error: 'Forbidden' });
  const { rows } = await pool.query(
    `SELECT u.id, u.login, u.full_name AS "fullName",
            COALESCE(p.unloading_time_minutes, 5) AS "unloadingTimeMinutes"
       FROM users u
       LEFT JOIN driver_profiles p ON p.user_id = u.id
      WHERE u.role = 'driver'
      ORDER BY u.login`
  );
  return reply(req, res, 200, { drivers: rows });
}

// ── Stats ─────────────────────────────────────────────────
async function handleStatsDaily(req, res, user) {
  if (!isOps(user)) return reply(req, res, 403, { error: 'Forbidden' });
  const url  = new URL(req.url, 'http://localhost');
  const date = url.searchParams.get('date');
  if (!date) return reply(req, res, 400, { error: 'Missing date' });

  const { rows: status } = await pool.query(
    `SELECT status, COUNT(*)::int AS count
       FROM orders WHERE route_date = $1 GROUP BY status`,
    [date]
  );
  const byStatus = { pending: 0, assigned: 0, in_progress: 0, delivered: 0, failed: 0, cancelled: 0 };
  for (const r of status) byStatus[r.status] = r.count;
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);

  const { rows: byDriver } = await pool.query(
    `SELECT u.id AS "driverId", u.login, u.full_name AS "fullName",
            COUNT(o.id)::int AS total,
            COUNT(o.id) FILTER (WHERE o.status = 'delivered')::int AS delivered
       FROM users u
       LEFT JOIN orders o ON o.assigned_driver_id = u.id AND o.route_date = $1
      WHERE u.role = 'driver'
      GROUP BY u.id, u.login, u.full_name
      ORDER BY total DESC, u.login`,
    [date]
  );

  return reply(req, res, 200, { date, total, byStatus, byDriver });
}

async function handleStatsMonthly(req, res, user) {
  if (!isOps(user)) return reply(req, res, 403, { error: 'Forbidden' });
  const url   = new URL(req.url, 'http://localhost');
  const month = url.searchParams.get('month');
  if (!month) return reply(req, res, 400, { error: 'Missing month' });

  const { rows: perDay } = await pool.query(
    `SELECT to_char(route_date, 'YYYY-MM-DD') AS date,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered
       FROM orders
      WHERE to_char(route_date, 'YYYY-MM') = $1
      GROUP BY route_date
      ORDER BY route_date`,
    [month]
  );

  const { rows: perDriver } = await pool.query(
    `SELECT u.id AS "driverId", u.login, u.full_name AS "fullName",
            COUNT(o.id)::int AS total,
            COUNT(o.id) FILTER (WHERE o.status = 'delivered')::int AS delivered
       FROM users u
       LEFT JOIN orders o ON o.assigned_driver_id = u.id
                          AND to_char(o.route_date, 'YYYY-MM') = $1
      WHERE u.role = 'driver'
      GROUP BY u.id, u.login, u.full_name
      ORDER BY total DESC, u.login`,
    [month]
  );

  const total     = perDay.reduce((a, r) => a + r.total, 0);
  const delivered = perDay.reduce((a, r) => a + r.delivered, 0);
  return reply(req, res, 200, { month, total, delivered, perDay, perDriver });
}

// ── Excel export ──────────────────────────────────────────
function rangeBounds(rangeKind, dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  if (rangeKind === 'day') {
    return { from: dateStr, to: dateStr };
  }
  if (rangeKind === 'week') {
    // ISO week: Monday-start, Sunday-end
    const dow = d.getDay() === 0 ? 7 : d.getDay(); // Mon=1..Sun=7
    const monday = new Date(d); monday.setDate(d.getDate() - (dow - 1));
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    return { from: fmtDate(monday), to: fmtDate(sunday) };
  }
  if (rangeKind === 'month') {
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const last  = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { from: fmtDate(first), to: fmtDate(last) };
  }
  return null;
}
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const STATUS_RU = {
  pending: 'Ожидает', assigned: 'Назначен', in_progress: 'В пути',
  delivered: 'Доставлено', failed: 'Не доставлено', cancelled: 'Отменён'
};

async function handleExportOrders(req, res, user) {
  if (!isOps(user)) return reply(req, res, 403, { error: 'Forbidden' });
  const url      = new URL(req.url, 'http://localhost');
  const range    = url.searchParams.get('range') || 'day';
  const date     = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
  const driverId = url.searchParams.get('driverId') || null;

  const bounds = rangeBounds(range, date);
  if (!bounds) return reply(req, res, 400, { error: 'Invalid range/date' });

  const args  = [bounds.from, bounds.to];
  let where   = `route_date BETWEEN $1 AND $2`;
  if (driverId) { args.push(driverId); where += ` AND o.assigned_driver_id = $${args.length}`; }

  const { rows } = await pool.query(
    `SELECT o.route_date,
            to_char(o.scheduled_time, 'HH24:MI') AS scheduled_time,
            o.address, o.description, o.buyer, o.weight_kg,
            o.external_order_no, o.status, o.delivered_at, o.comment,
            d.login AS driver_login, d.full_name AS driver_name
       FROM orders o
       LEFT JOIN users d ON d.id = o.assigned_driver_id
      WHERE ${where}
      ORDER BY o.route_date, o.assigned_driver_id NULLS LAST, o.sequence_index NULLS LAST, o.scheduled_time NULLS LAST`,
    args
  );

  const header = ['Дата', 'Время', 'Адрес', 'Описание', 'Покупатель',
                  'Вес (кг)', 'Накладная', 'Водитель', 'Статус', 'Доставлено в', 'Комментарий'];
  const aoa = [header];
  for (const r of rows) {
    aoa.push([
      r.route_date instanceof Date ? fmtDate(r.route_date) : r.route_date,
      r.scheduled_time || '',
      r.address || '',
      r.description || '',
      r.buyer || '',
      r.weight_kg ?? '',
      r.external_order_no || '',
      r.driver_name || r.driver_login || '',
      STATUS_RU[r.status] || r.status,
      r.delivered_at ? new Date(r.delivered_at).toLocaleString('ru-RU') : '',
      r.comment || ''
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 11 }, { wch: 7 }, { wch: 50 }, { wch: 30 }, { wch: 25 },
    { wch: 9 },  { wch: 12 }, { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 30 }
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Заказы');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const fileName = `orders-${range}-${date}.xlsx`;
  res.writeHead(200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': req.headers.origin || '*',
    'Access-Control-Allow-Credentials': 'true',
  });
  res.end(buf);
}

// ── Geocoding proxy ───────────────────────────────────────
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

let nominatimQueue = Promise.resolve();
function geocodeNominatim(q) {
  const next = nominatimQueue.then(async () => {
    await new Promise(r => setTimeout(r, 1100));
    const url = 'https://nominatim.openstreetmap.org/search?' +
      new URLSearchParams({ q, format: 'json', limit: '1', countrycodes: 'ru', 'accept-language': 'ru' });
    const data = await fetchJsonTimeout(url, {
      'User-Agent': 'LogiRouteCRM/1.0 (contact: admin@logiroute.local)',
      'Accept-Language': 'ru'
    }, 8000);
    if (!data?.[0]) return null;
    return { lat: +data[0].lat, lon: +data[0].lon };
  });
  nominatimQueue = next.catch(() => null);
  return next;
}

async function geocodePhoton(q) {
  const url = 'https://photon.komoot.io/api/?' + new URLSearchParams({ q, limit: '1' });
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
  const { rows } = await pool.query(`SELECT lat, lon FROM geocache WHERE cache_key = $1`, [key]);
  if (rows[0]) return reply(req, res, 200, { coords: { lat: +rows[0].lat, lon: +rows[0].lon }, cached: true });

  let coords = await geocodePhoton(q);
  if (!coords) coords = await geocodeNominatim(q);

  if (coords) {
    await pool.query(
      `INSERT INTO geocache (cache_key, lat, lon) VALUES ($1, $2, $3)
       ON CONFLICT (cache_key) DO NOTHING`,
      [key, coords.lat, coords.lon]
    );
  }
  return reply(req, res, 200, { coords: coords || null, cached: false });
}

// ── Admin: users ──────────────────────────────────────────
async function handleAdminUsers(req, res, user) {
  if (!isElevated(user)) return reply(req, res, 403, { error: 'Forbidden' });

  if (req.method === 'GET') {
    const { rows } = await pool.query(
      `SELECT u.id, u.login, u.role, u.full_name AS "fullName",
              u.created_at AS "createdAt",
              (SELECT COUNT(*)::int FROM orders WHERE assigned_driver_id = u.id) AS "orderCount"
         FROM users u
        ORDER BY u.created_at`
    );
    return reply(req, res, 200, { users: rows });
  }

  if (req.method === 'POST') {
    const { login, password, role, fullName } = await readBody(req);
    if (!login || !password) return reply(req, res, 400, { error: 'Логин и пароль обязательны' });
    const trimmed = String(login).trim();
    const allowedRoles = ['driver', 'manager', 'supervisor', 'admin'];
    const finalRole = allowedRoles.includes(role) ? role : 'driver';

    const { rows: existing } = await pool.query(`SELECT 1 FROM users WHERE login = $1`, [trimmed]);
    if (existing.length) return reply(req, res, 409, { error: 'Логин уже занят' });

    const id = makeId('user');
    await pool.query(
      `INSERT INTO users (id, login, password_hash, role, full_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, trimmed, hashPassword(String(password)), finalRole, fullName || null]
    );
    if (finalRole === 'driver') {
      await pool.query(
        `INSERT INTO driver_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
        [id]
      );
    }
    return reply(req, res, 201, { user: { id, login: trimmed, role: finalRole, fullName: fullName || null } });
  }

  return reply(req, res, 405, { error: 'Method Not Allowed' });
}

async function handleAdminUserById(req, res, user, userId) {
  if (!isElevated(user)) return reply(req, res, 403, { error: 'Forbidden' });
  const { rows } = await pool.query(`SELECT id FROM users WHERE id = $1`, [userId]);
  if (!rows.length) return reply(req, res, 404, { error: 'Пользователь не найден' });

  if (req.method === 'DELETE') {
    if (userId === user.id) return reply(req, res, 400, { error: 'Нельзя удалить себя' });
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    return reply(req, res, 200, { ok: true });
  }

  if (req.method === 'PATCH') {
    const body = await readBody(req);
    const sets = [];
    const args = [];
    if ('login' in body)    { args.push(String(body.login).trim()); sets.push(`login = $${args.length}`); }
    if ('fullName' in body) { args.push(body.fullName || null); sets.push(`full_name = $${args.length}`); }
    if ('role' in body && ['driver','manager','supervisor','admin'].includes(body.role)) {
      args.push(body.role); sets.push(`role = $${args.length}`);
    }
    if ('password' in body && body.password) {
      args.push(hashPassword(String(body.password))); sets.push(`password_hash = $${args.length}`);
    }
    if (!sets.length) return reply(req, res, 400, { error: 'Нет изменений' });
    args.push(userId);
    await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${args.length}`, args);
    return reply(req, res, 200, { ok: true });
  }

  return reply(req, res, 405, { error: 'Method Not Allowed' });
}

async function handleAdminUserClear(req, res, user, userId) {
  if (!isElevated(user)) return reply(req, res, 403, { error: 'Forbidden' });
  if (req.method !== 'POST') return reply(req, res, 405, { error: 'Method Not Allowed' });
  await pool.query(`DELETE FROM orders WHERE assigned_driver_id = $1`, [userId]);
  await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
  return reply(req, res, 200, { ok: true });
}

// ── Driver profile ────────────────────────────────────────
async function handleDriverProfile(req, res, user, driverId) {
  // Driver may read their own profile; ops may read/write any.
  if (req.method === 'GET') {
    if (user.role === 'driver' && user.id !== driverId) return reply(req, res, 403, { error: 'Forbidden' });
    if (user.role !== 'driver' && !isOps(user))         return reply(req, res, 403, { error: 'Forbidden' });
    const { rows } = await pool.query(
      `SELECT user_id AS "userId", unloading_time_minutes AS "unloadingTimeMinutes", notes
         FROM driver_profiles WHERE user_id = $1`,
      [driverId]
    );
    return reply(req, res, 200, { profile: rows[0] || { userId: driverId, unloadingTimeMinutes: 5, notes: null } });
  }

  if (req.method === 'PATCH') {
    if (!isElevated(user)) return reply(req, res, 403, { error: 'Forbidden' });
    const body = await readBody(req);
    await pool.query(
      `INSERT INTO driver_profiles (user_id, unloading_time_minutes, notes)
       VALUES ($1, COALESCE($2, 5), $3)
       ON CONFLICT (user_id) DO UPDATE
         SET unloading_time_minutes = COALESCE(EXCLUDED.unloading_time_minutes, driver_profiles.unloading_time_minutes),
             notes = EXCLUDED.notes`,
      [driverId, body.unloadingTimeMinutes ?? null, body.notes || null]
    );
    return reply(req, res, 200, { ok: true });
  }

  return reply(req, res, 405, { error: 'Method Not Allowed' });
}

// ── Router ────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, buildJsonHeaders(req.headers.origin || ''));
    return res.end();
  }
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (!pathname.startsWith('/api/')) {
      if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
      return reply(req, res, 405, { error: 'Method Not Allowed' });
    }

    if (req.method === 'POST' && pathname === '/api/login')  return handleLogin(req, res);
    if (req.method === 'POST' && pathname === '/api/logout') return handleLogout(req, res);
    if (pathname === '/api/me') return handleMe(req, res);
    if (req.method === 'GET' && pathname === '/api/geocode') return handleGeocode(req, res);

    const user = await getCurrentUser(req);
    if (!user) return reply(req, res, 401, { error: 'Unauthorized' });

    if (pathname === '/api/orders')           return handleOrders(req, res, user);
    if (pathname === '/api/catalog')          return handleCatalog(req, res, user);
    if (pathname === '/api/drivers')          return handleDrivers(req, res, user);
    if (pathname === '/api/stats/daily')      return handleStatsDaily(req, res, user);
    if (pathname === '/api/stats/monthly')    return handleStatsMonthly(req, res, user);
    if (pathname === '/api/export/orders')    return handleExportOrders(req, res, user);
    if (pathname === '/api/admin/users')      return handleAdminUsers(req, res, user);

    const catalogAssignMatch = pathname.match(/^\/api\/catalog\/([^/]+)\/assign$/);
    if (catalogAssignMatch) return handleCatalogAssign(req, res, user, catalogAssignMatch[1]);

    const catalogIdMatch = pathname.match(/^\/api\/catalog\/([^/]+)$/);
    if (catalogIdMatch) return handleCatalogById(req, res, user, catalogIdMatch[1]);

    const orderMatch = pathname.match(/^\/api\/orders\/([^/]+)$/);
    if (orderMatch) return handleOrderById(req, res, user, orderMatch[1]);

    const adminClearMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/clear$/);
    if (adminClearMatch) return handleAdminUserClear(req, res, user, adminClearMatch[1]);

    const adminUserMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (adminUserMatch) return handleAdminUserById(req, res, user, adminUserMatch[1]);

    const profileMatch = pathname.match(/^\/api\/driver-profile\/([^/]+)$/);
    if (profileMatch) return handleDriverProfile(req, res, user, profileMatch[1]);

    return reply(req, res, 404, { error: 'Not Found' });
  } catch (error) {
    console.error(error);
    return reply(req, res, 500, { error: 'Internal Server Error' });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.log(`[api] port ${PORT} already in use — skipping`);
  else { console.error('[api] server error:', err); process.exit(1); }
});
server.listen(PORT, () => console.log(`API server running on http://localhost:${PORT}`));

// Release the PGlite lock cleanly on shutdown so the next start doesn't trip
// over a stale postmaster.pid.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[api] received ${signal}, closing…`);
  server.close();
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(0);
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
