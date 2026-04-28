-- LogiRoute CRM — Postgres schema
-- Idempotent: safe to run multiple times.
-- Run via:  npm run db:migrate
-- Or:       psql -d logiroute -f db/schema.sql

CREATE TABLE IF NOT EXISTS users (
  id            TEXT        PRIMARY KEY,
  login         TEXT        UNIQUE NOT NULL,
  password_hash TEXT        NOT NULL,
  role          TEXT        NOT NULL CHECK (role IN ('admin','supervisor','manager','driver')),
  full_name     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-driver settings. Single fixed unloading time per stop, used for ETA later.
CREATE TABLE IF NOT EXISTS driver_profiles (
  user_id                 TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  unloading_time_minutes  INT  NOT NULL DEFAULT 5,
  notes                   TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT        PRIMARY KEY,
  user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT        UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);

-- A delivery point. Created by manager/supervisor, optionally assigned to a driver.
-- route_date is NULL for "inbox" orders that have been added but not yet
-- scheduled to a day / driver.
CREATE TABLE IF NOT EXISTS orders (
  id                  TEXT        PRIMARY KEY,
  route_date          DATE,
  address             TEXT        NOT NULL,
  description         TEXT,
  scheduled_time      TIME,
  status              TEXT        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','assigned','in_progress','delivered','failed','cancelled')),
  assigned_driver_id  TEXT        REFERENCES users(id) ON DELETE SET NULL,
  created_by          TEXT        REFERENCES users(id) ON DELETE SET NULL,
  sequence_index      INT,                     -- driver-side ordering within the day
  buyer               TEXT,
  comment             TEXT,
  weight_kg           NUMERIC(10,2),
  external_order_no   TEXT,                    -- optional: client's order number
  geocoded_lat        DOUBLE PRECISION,
  geocoded_lon        DOUBLE PRECISION,
  delivered_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_route_date ON orders(route_date);
CREATE INDEX IF NOT EXISTS idx_orders_assigned   ON orders(assigned_driver_id, route_date);
CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(status);

-- Audit trail of every status change. Used for reporting (delays, completion times).
CREATE TABLE IF NOT EXISTS order_status_log (
  id          BIGSERIAL   PRIMARY KEY,
  order_id    TEXT        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  old_status  TEXT,
  new_status  TEXT        NOT NULL,
  changed_by  TEXT        REFERENCES users(id) ON DELETE SET NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_status_log_order ON order_status_log(order_id);

CREATE TABLE IF NOT EXISTS geocache (
  cache_key  TEXT             PRIMARY KEY,
  lat        DOUBLE PRECISION NOT NULL,
  lon        DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ      NOT NULL DEFAULT now()
);

-- A library of recurring delivery destinations. Catalog entries persist;
-- assigning one creates a fresh row in `orders` (a copy snapshotted at that moment).
CREATE TABLE IF NOT EXISTS catalog_objects (
  id            TEXT        PRIMARY KEY,
  address       TEXT        NOT NULL,
  description   TEXT,
  default_time  TIME,
  buyer         TEXT,
  weight_kg     NUMERIC(10,2),
  external_no   TEXT,
  comment       TEXT,
  notes         TEXT,
  created_by    TEXT        REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalog_address ON catalog_objects(address);

-- Idempotent migrations applied after the CREATE TABLEs above.
-- These are no-ops on a fresh DB and bring older DBs up-to-date.
ALTER TABLE orders ALTER COLUMN route_date DROP NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS catalog_object_id TEXT REFERENCES catalog_objects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_catalog ON orders(catalog_object_id);

-- Remove orphaned inbox-style orders (an earlier prototype). Catalog entries
-- live in catalog_objects now; orders always have a date.
DELETE FROM orders WHERE route_date IS NULL;
