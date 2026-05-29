import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedCategories } from './seed.ts'

// ─────────────────────────────────────────────────────────────
// SQLite schema — native dialect (matches CLAUDE.md §6).
// IDs: lower(hex(randomblob(16))) → 32-char lowercase hex (matches the
//   client's generateId()).
// Booleans: INTEGER (0/1) — SQLite has no BOOLEAN.
// Timestamps: datetime('now') → 'YYYY-MM-DD HH:MM:SS' (UTC), the format the
//   app already expects.
// NOTE (Phase 4): per-user scoping (users table + user_id columns) arrives in
//   the auth stage. This scaffold sets up the data tables only.
// ─────────────────────────────────────────────────────────────
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  parent_id     TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  content       TEXT NOT NULL DEFAULT '',
  note          TEXT DEFAULT '',
  is_completed  INTEGER DEFAULT 0,
  is_collapsed  INTEGER DEFAULT 0,
  sort_order    REAL NOT NULL DEFAULT 0,
  due_date      TEXT DEFAULT NULL,
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

-- Tier 2: budget tracking (one row per category; limit is always monthly)
CREATE TABLE IF NOT EXISTS budgets (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  category_id  TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  limit_amount REAL NOT NULL,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now')),
  UNIQUE (category_id)
);

-- Tier 2: recurring transaction rules
CREATE TABLE IF NOT EXISTS recurring_transactions (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount        REAL NOT NULL,
  merchant      TEXT DEFAULT '',
  type          TEXT NOT NULL DEFAULT 'expense',
  category_id   TEXT REFERENCES categories(id) ON DELETE SET NULL,
  frequency     TEXT NOT NULL DEFAULT 'monthly',
  next_due_date TEXT NOT NULL,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

-- Tier 3: savings goals
CREATE TABLE IF NOT EXISTS goals (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name          TEXT NOT NULL,
  target_amount REAL NOT NULL,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

-- Tier 3: task templates
CREATE TABLE IF NOT EXISTS task_templates (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name       TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
`

const __dirname = dirname(fileURLToPath(import.meta.url))

// DAYBOOK_DB_PATH lets tests point at a throwaway file (or ':memory:').
// Default lives under server/data/ (gitignored).
function resolveDbPath(): string {
  const fromEnv = process.env.DAYBOOK_DB_PATH
  if (fromEnv) return fromEnv
  return resolve(__dirname, 'data', 'daybook.db')
}

export type DB = Database.Database

let dbInstance: DB | null = null

export function getDb(): DB {
  if (dbInstance) return dbInstance

  const dbPath = resolveDbPath()
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true })
  }

  const db = new Database(dbPath)
  // WAL improves concurrent read/write on a home-network multi-user server.
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(SCHEMA_SQL)

  // Seed default categories on first run (global for now; becomes per-user in
  // the auth stage).
  const { count } = db.prepare('SELECT count(*) AS count FROM categories').get() as { count: number }
  if (count === 0) {
    seedCategories(db)
  }

  // Default settings.
  const insertSetting = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING',
  )
  insertSetting.run('default_currency', 'MYR')
  insertSetting.run('theme', 'light')
  insertSetting.run('hide_completed', '0')

  dbInstance = db
  return db
}
