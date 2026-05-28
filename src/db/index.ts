import { PGlite } from '@electric-sql/pglite'
import { seedCategories } from './seed'

let dbInstance: PGlite | null = null
let initPromise: Promise<PGlite> | null = null

// PGlite is PostgreSQL — use Postgres functions, not SQLite.
// IDs: replace(gen_random_uuid()::text, '-', '') → 32-char lowercase hex (matches generateId())
// Timestamps: to_char(now(), 'YYYY-MM-DD HH24:MI:SS') → matches the format our app expects
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
  parent_id     TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  content       TEXT NOT NULL DEFAULT '',
  note          TEXT DEFAULT '',
  is_completed  INTEGER DEFAULT 0,
  is_collapsed  INTEGER DEFAULT 0,
  sort_order    DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at    TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at    TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS accounts (
  id          TEXT PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  currency    TEXT NOT NULL DEFAULT 'MYR',
  type        TEXT NOT NULL DEFAULT 'cash',
  color       TEXT DEFAULT '#1D9E75',
  icon        TEXT DEFAULT 'wallet',
  created_at  TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS categories (
  id    TEXT PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
  name  TEXT NOT NULL,
  icon  TEXT DEFAULT 'tag',
  color TEXT DEFAULT '#378ADD',
  type  TEXT DEFAULT 'both'
);

CREATE TABLE IF NOT EXISTS transactions (
  id                     TEXT PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
  account_id             TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  destination_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  date                   TEXT NOT NULL,
  merchant               TEXT DEFAULT '',
  description            TEXT DEFAULT '',
  amount                 DOUBLE PRECISION NOT NULL,
  type                   TEXT NOT NULL DEFAULT 'expense',
  category_id            TEXT REFERENCES categories(id) ON DELETE SET NULL,
  tag                    TEXT DEFAULT '',
  import_hash            TEXT DEFAULT '',
  created_at             TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at             TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Tier 2: budget tracking (one row per category; limit is always monthly)
CREATE TABLE IF NOT EXISTS budgets (
  id           TEXT PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
  category_id  TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  limit_amount DOUBLE PRECISION NOT NULL,
  created_at   TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at   TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE (category_id)
);

-- Tier 2: recurring transaction rules
CREATE TABLE IF NOT EXISTS recurring_transactions (
  id            TEXT PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount        DOUBLE PRECISION NOT NULL,
  merchant      TEXT DEFAULT '',
  type          TEXT NOT NULL DEFAULT 'expense',
  category_id   TEXT REFERENCES categories(id) ON DELETE SET NULL,
  frequency     TEXT NOT NULL DEFAULT 'monthly',
  next_due_date TEXT NOT NULL,
  created_at    TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at    TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- Tier 3: savings goals
CREATE TABLE IF NOT EXISTS goals (
  id            TEXT PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
  name          TEXT NOT NULL,
  target_amount DOUBLE PRECISION NOT NULL,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at    TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at    TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- Tier 3: task templates
CREATE TABLE IF NOT EXISTS task_templates (
  id         TEXT PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
  name       TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);
`

async function initDB(): Promise<PGlite> {
  if (dbInstance) return dbInstance

  // relaxedDurability:false → each write awaits IndexedDB flush so a full
  // page reload immediately after a write sees the data.
  const db = new PGlite('idb://daybook', { relaxedDurability: false })
  await db.waitReady

  // PGlite uses Postgres SQL syntax, but we're using it as a local SQLite-like store.
  // Run schema creation
  await db.exec(SCHEMA_SQL)

  // Seed categories if empty
  const result = await db.query<{ count: string }>('SELECT count(*) as count FROM categories')
  const count = parseInt(result.rows[0]?.count ?? '0', 10)
  if (count === 0) {
    await seedCategories(db)
  }

  // Tier 2 migration: add due_date to existing tasks tables
  await db.exec(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date TEXT DEFAULT NULL;`)

  // Set defaults in settings if not present
  await db.exec(`
    INSERT INTO settings (key, value) VALUES ('default_currency', 'MYR') ON CONFLICT (key) DO NOTHING;
    INSERT INTO settings (key, value) VALUES ('theme', 'light') ON CONFLICT (key) DO NOTHING;
    INSERT INTO settings (key, value) VALUES ('hide_completed', '0') ON CONFLICT (key) DO NOTHING;
  `)

  dbInstance = db
  return db
}

export function getDB(): Promise<PGlite> {
  if (!initPromise) {
    initPromise = initDB()
  }
  return initPromise
}
