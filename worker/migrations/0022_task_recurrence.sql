-- FEAT-028 (docs/backlog/EP-07-tasks-depth/FEAT-028-task-recurrence.md) —
-- recurring tasks. Only one row per series is ever "active"
-- (recurrence IS NOT NULL). POST /tasks/recurring/process (worker/routes/tasks.ts)
-- materializes the next occurrence of a completed recurring task and clears
-- recurrence/recurrence_data on the row it just completed, mirroring Wallet's
-- recurring_transactions materialize-on-due model (design.md).
ALTER TABLE tasks ADD COLUMN recurrence TEXT DEFAULT NULL;             -- daily|weekly|monthly|yearly|custom
ALTER TABLE tasks ADD COLUMN recurrence_data TEXT DEFAULT NULL;        -- JSON: interval, weekdays, end, occurrences
ALTER TABLE tasks ADD COLUMN recurrence_parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;
