// Bring the database to the current schema and seed the default admin if missing.
// Idempotent — safe to run repeatedly.
//
// Driver is picked by db/client.js:
//   - PGlite (local dev, default — writes to ./data/pglite)
//   - real pg if DATABASE_URL or PGHOST is set
//
// Run:  npm run db:migrate

import fs   from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { pool } from '../db/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const repoRoot   = path.resolve(__dirname, '..');
const schemaFile = path.join(repoRoot, 'db', 'schema.sql');
const dbFile     = path.join(repoRoot, 'data', 'db.json');

async function readJsonIfExists(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function applySchema() {
  const sql = await fs.readFile(schemaFile, 'utf8');
  await pool.exec(sql);
  console.log('[migrate] schema applied');
}

async function importUsers(users = []) {
  if (!users.length) { console.log('[migrate] no users to import'); return; }
  for (const u of users) {
    await pool.query(
      `INSERT INTO users (id, login, password_hash, role, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE
         SET login = EXCLUDED.login,
             password_hash = EXCLUDED.password_hash,
             role = EXCLUDED.role`,
      [u.id, u.login, u.passwordHash, u.role, u.createdAt || new Date().toISOString()]
    );
    if (u.role === 'driver') {
      await pool.query(
        `INSERT INTO driver_profiles (user_id) VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING`,
        [u.id]
      );
    }
  }
  console.log(`[migrate] users imported: ${users.length}`);
}

async function importGeocache(geocache = {}) {
  const entries = Object.entries(geocache);
  if (!entries.length) { console.log('[migrate] no geocache entries to import'); return; }
  for (const [key, coords] of entries) {
    if (!coords || typeof coords.lat !== 'number' || typeof coords.lon !== 'number') continue;
    await pool.query(
      `INSERT INTO geocache (cache_key, lat, lon)
       VALUES ($1, $2, $3)
       ON CONFLICT (cache_key) DO NOTHING`,
      [key, coords.lat, coords.lon]
    );
  }
  console.log(`[migrate] geocache imported: ${entries.length}`);
}

async function ensureSeedAdmin() {
  const { rows } = await pool.query(`SELECT 1 FROM users WHERE role = 'admin' LIMIT 1`);
  if (rows.length) return;
  const hash = crypto.createHash('sha256').update('ProDrive').digest('hex');
  await pool.query(
    `INSERT INTO users (id, login, password_hash, role)
     VALUES ('user-admin-root', 'admin', $1, 'admin')
     ON CONFLICT (id) DO NOTHING`,
    [hash]
  );
  console.log('[migrate] seeded default admin (login=admin / password=ProDrive)');
}

async function main() {
  await applySchema();
  const db = await readJsonIfExists(dbFile);
  if (db) {
    await importUsers(db.users);
    await importGeocache(db.geocache);
  } else {
    console.log('[migrate] no data/db.json found — fresh install');
  }
  await ensureSeedAdmin();
  console.log('[migrate] done');
  await pool.end();
}

main().catch(async (err) => {
  console.error('[migrate] failed:', err);
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
