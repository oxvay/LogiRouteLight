// Database client. Picks PGlite (in-process Postgres) for local dev by default,
// or the real `pg` driver if a DATABASE_URL / PGHOST is set (for production).
//
// Both expose the same surface: pool.query(sql, params) → { rows }, and pool.exec(sql)
// for running multi-statement scripts (schema files).

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const dataDir    = process.env.PGLITE_DIR || path.resolve(__dirname, '..', 'data', 'pglite');

const useRealPg = !!(process.env.DATABASE_URL || process.env.PGHOST);

let pool;
let driverLabel;

if (useRealPg) {
  const { Pool } = (await import('pg')).default;
  const realPool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL })
    : new Pool();
  realPool.on('error', (err) => console.error('[pg] pool error:', err));
  pool = {
    query: (sql, params = []) => realPool.query(sql, params),
    exec:  (sql) => realPool.query(sql),
    end:   () => realPool.end(),
  };
  driverLabel = 'pg (network Postgres)';
} else {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(dataDir);
  await db.waitReady;
  pool = {
    query: (sql, params = []) => db.query(sql, params),
    exec:  (sql) => db.exec(sql),
    end:   () => db.close(),
  };
  driverLabel = `pglite (${dataDir})`;
}

console.log(`[db] driver: ${driverLabel}`);

export { pool };
