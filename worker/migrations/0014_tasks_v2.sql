-- 0013_tasks_v2.sql
-- R4 (docs/v2/release-plan.md, docs/v2/tasks/01-data-model.md): minimum schema
-- for the designed task row. Additive only. D-3 (keep outliner) and D-15
-- (task sharing) both resolved 2026-08-21 — see docs/v2/open-decisions.md.

CREATE TABLE IF NOT EXISTS task_lists (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#2F6FEB',
  icon       TEXT DEFAULT 'list',
  sort_order REAL NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

ALTER TABLE tasks ADD COLUMN list_id      TEXT REFERENCES task_lists(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN priority     TEXT NOT NULL DEFAULT 'none';  -- none|low|med|high
ALTER TABLE tasks ADD COLUMN due_time     TEXT DEFAULT NULL;             -- HH:MM, null = all day
ALTER TABLE tasks ADD COLUMN completed_at TEXT DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN assignee_id  TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_user_due  ON tasks(user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_list      ON tasks(list_id);
CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(user_id, completed_at);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee  ON tasks(assignee_id);

-- Mirrors account_shares exactly (D-15): ownership stays with task_lists.user_id,
-- the share grants visibility plus optional write on the list's tasks.
CREATE TABLE IF NOT EXISTS task_list_shares (
  list_id   TEXT NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
  group_id  TEXT NOT NULL REFERENCES groups(id)     ON DELETE CASCADE,
  can_write INTEGER NOT NULL DEFAULT 0,
  shared_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (list_id, group_id)
);
CREATE INDEX IF NOT EXISTS idx_task_list_shares_group ON task_list_shares(group_id);

-- Backfill: already-completed tasks get completed_at = updated_at, the closest
-- honest value available (docs/v2/tasks/01-data-model.md §3).
UPDATE tasks SET completed_at = updated_at WHERE is_completed = 1 AND completed_at IS NULL;
