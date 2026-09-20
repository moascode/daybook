-- FEAT-029 (docs/backlog/EP-07-tasks-depth/FEAT-029-tasks-habits.md) — Habits.
-- A different thing from tasks: a habit is a repeated commitment tracked by
-- day (habit_entries), not a due-dated instance. linked_kind lets a habit
-- derive `done` from another module instead of an explicit entry — e.g.
-- 'wallet:no-spend' (worker/routes/habits.ts), the cheapest cross-module
-- feature in the plan (design.md).
CREATE TABLE IF NOT EXISTS habits (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  color            TEXT NOT NULL DEFAULT '#10b981',
  icon             TEXT DEFAULT NULL,
  target_per_week  INTEGER NOT NULL DEFAULT 7,
  schedule         TEXT DEFAULT NULL,   -- JSON array of weekdays [0=Sun..6=Sat]; NULL = every day
  linked_kind      TEXT DEFAULT NULL,   -- e.g. 'wallet:no-spend'; NULL = tracked by explicit entries
  archived         INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT DEFAULT (datetime('now')),
  updated_at       TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS habit_entries (
  habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  date     TEXT NOT NULL,
  done     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (habit_id, date)
);
