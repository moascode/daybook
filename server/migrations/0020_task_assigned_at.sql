-- FEAT-027 (docs/backlog/EP-07-tasks-depth/FEAT-027-tasks-assigned-to-me.md) —
-- when a task's assignee was last set, so turnaround time (assignment →
-- completion) can be measured instead of approximated from created_at, which
-- measures task age, not delegation speed. NULL for every task assigned
-- before this column existed and for every never-assigned task; the
-- turnaround calculation must exclude NULLs rather than treating them as 0.
ALTER TABLE tasks ADD COLUMN assigned_at TEXT DEFAULT NULL;
