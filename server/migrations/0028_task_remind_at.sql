-- FEAT-055 (docs/archive/ep-07-tasks-depth/FEAT-055-tasks-composer-reminder-shortcut.md) —
-- a time-based nudge on any task, distinct from a due date: missing it never
-- makes the task overdue. 'YYYY-MM-DDTHH:MM' in business time
-- (Asia/Kuala_Lumpur), compared lexically against the business clock by the
-- reminder cron and the in-app notifications. NULL = no reminder.
ALTER TABLE tasks ADD COLUMN remind_at TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_remind_at ON tasks(remind_at);
