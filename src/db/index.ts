import { PGlite } from '@electric-sql/pglite'
import { seedCategories } from './seed'

let dbInstance: PGlite | null = null
let initPromise: Promise<PGlite> | null = null

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  parent_id     TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  content       TEXT NOT NULL DEFAULT '',
  note          TEXT DEFAULT '',
  is_completed  INTEGER DEFAULT 0,
  is_collapsed  INTEGER DEFAULT 0,
  sort_order    REAL NOT NULL DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  currency    TEXT NOT NULL DEFAULT 'MYR',
  type        TEXT NOT NULL DEFAULT 'cash',
  color       TEXT DEFAULT '#1D9E75',
  icon        TEXT DEFAULT 'wallet',
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name  TEXT NOT NULL,
  icon  TEXT DEFAULT 'tag',
  color TEXT DEFAULT '#378ADD',
  type  TEXT DEFAULT 'both'
);

CREATE TABLE IF NOT EXISTS transactions (
  id                     TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id             TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  destination_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  date                   TEXT NOT NULL,
  merchant               TEXT DEFAULT '',
  description            TEXT DEFAULT '',
  amount                 REAL NOT NULL,
  type                   TEXT NOT NULL DEFAULT 'expense',
  category_id            TEXT REFERENCES categories(id) ON DELETE SET NULL,
  tag                    TEXT DEFAULT '',
  import_hash            TEXT DEFAULT '',
  created_at             TEXT DEFAULT (datetime('now')),
  updated_at             TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

async function initDB(): Promise<PGlite> {
  if (dbInstance) return dbInstance

  const db = new PGlite('idb://daybook')
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
