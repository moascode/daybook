-- Tasks tracked time (timer + manual edit). Additive only.
-- Mirrored byte-identically in server/migrations/0030_task_tracked_time.sql.
ALTER TABLE tasks ADD COLUMN tracked_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN timer_started_at TEXT DEFAULT NULL; -- UTC datetime('now') form; NULL = not running
