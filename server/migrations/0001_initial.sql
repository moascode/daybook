-- 0001_initial.sql
-- Complete baseline schema for Daybook v1.
-- Auth tables first (data tables reference users.id).

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

CREATE TABLE IF NOT EXISTS schema_migrations (
  name       TEXT PRIMARY KEY,
  applied_at TEXT DEFAULT (datetime('now'))
);

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
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT DEFAULT '',
  currency        TEXT NOT NULL DEFAULT 'MYR',
  type            TEXT NOT NULL DEFAULT 'cash',
  color           TEXT DEFAULT '#1D9E75',
  icon            TEXT DEFAULT 'wallet',
  opening_balance REAL NOT NULL DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now'))
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

CREATE TABLE IF NOT EXISTS budgets (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id  TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  limit_amount REAL NOT NULL,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now')),
  UNIQUE (user_id, category_id)
);

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

CREATE TABLE IF NOT EXISTS goals (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  target_amount REAL NOT NULL,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_templates (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
