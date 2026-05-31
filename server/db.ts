import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ─────────────────────────────────────────────────────────────
// SQLite schema — native dialect (matches CLAUDE.md §6).
// IDs: lower(hex(randomblob(16))) → 32-char lowercase hex (matches the
//   client's generateId()).
// Booleans: INTEGER (0/1) — SQLite has no BOOLEAN.
// Timestamps: datetime('now') → 'YYYY-MM-DD HH:MM:SS' (UTC), the format the
//   app already expects.
// Phase 4 auth stage: every data row carries user_id; categories + settings are
//   per-user (seeded on signup). Sessions persist in the sessions table.
// ─────────────────────────────────────────────────────────────

// Auth tables — created first because data tables reference users(id).
const AUTH_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  sid    TEXT PRIMARY KEY,
  sess   TEXT NOT NULL,
  expire INTEGER NOT NULL
);
`

// Data tables. Every row is scoped to a user via user_id (ON DELETE CASCADE).
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  currency    TEXT NOT NULL DEFAULT 'MYR',
  type        TEXT NOT NULL DEFAULT 'cash',
  color       TEXT DEFAULT '#1D9E75',
  icon        TEXT DEFAULT 'wallet',
  opening_balance REAL NOT NULL DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id      TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  icon    TEXT DEFAULT 'tag',
  color   TEXT DEFAULT '#378ADD',
  type    TEXT DEFAULT 'both'
);

CREATE TABLE IF NOT EXISTS transactions (
  id                     TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id                TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- Tier 2: budget tracking (one row per category; limit is always monthly)
CREATE TABLE IF NOT EXISTS budgets (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id  TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  limit_amount REAL NOT NULL,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now')),
  UNIQUE (user_id, category_id)
);

-- Tier 2: recurring transaction rules
CREATE TABLE IF NOT EXISTS recurring_transactions (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  target_amount REAL NOT NULL,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

-- Tier 3: task templates
CREATE TABLE IF NOT EXISTS task_templates (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
`

const DATA_TABLES = [
  'task_templates', 'goals', 'recurring_transactions', 'budgets',
  'transactions', 'categories', 'accounts', 'tasks', 'settings',
]

// Bump when the data-table DDL above changes (pre-v1: triggers a drop+recreate
// of the data tables on next boot). Auth tables (users/sessions) are unaffected.
const SCHEMA_VERSION = 2

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

  db.exec(AUTH_SQL)

  // Schema-version guard. Pre-v1 there is no real data to preserve, so any change
  // to the data-table DDL (the auth migration, the budgets uniqueness fix, and
  // future tweaks) is applied by dropping and recreating the data tables rather
  // than an in-place ALTER. Bump SCHEMA_VERSION whenever the data-table DDL
  // below changes. (Once v1 carries real data, replace this with real
  // migrations instead of bumping.)
  const currentVersion = db.pragma('user_version', { simple: true }) as number
  if (currentVersion !== SCHEMA_VERSION) {
    db.pragma('foreign_keys = OFF')
    for (const table of DATA_TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`)
    db.pragma('foreign_keys = ON')
    db.pragma(`user_version = ${SCHEMA_VERSION}`)
  }

  db.exec(SCHEMA_SQL)

  dbInstance = db
  return db
}
