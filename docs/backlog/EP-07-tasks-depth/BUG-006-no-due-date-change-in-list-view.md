> **Status:** Open · **Filed:** 2026-09-20 · **Epic:** [EP-07](README.md)

# BUG-006 — No way to change a task's due date from a list view

**Expected.** A user looking at a task list (e.g. `/tasks/lists/:listId`,
rendered via `TaskListRow`) can change a task's due date from that row,
without navigating elsewhere.

**Actual.** `TaskListRow.tsx` and `TasksListDetailPage.tsx` display a task's
due date where one is set (via the list-colour dot / badges pattern) but have
no control — no `DatePicker`, no inline edit — that calls
`updateTask(id, { dueDate })`. The only existing per-task due-date edit paths
found are: the outliner's bullet editor (unconfirmed whether it exposes one),
`TasksAllPage.tsx`'s bulk "Schedule these" (sets *all* undated tasks to
today, not a single task to a chosen date), and the new Upcoming board's
per-row `DatePicker` in its "Waiting for a date" section
(`TasksUpcomingPage.tsx`, FEAT-026) — none of which help from a list view.

**Repro.**
1. Go to `/tasks/lists/:listId` for any list with tasks in it.
2. Try to change a task's due date from that row.
3. No control exists to do so.

**Where I think it lives.** `src/modules/tasks/TaskListRow.tsx` and/or
`src/modules/tasks/TasksListDetailPage.tsx` — confirmed by reading both files;
neither imports `DatePicker` or calls `updateTask` with `dueDate`.

**Money, data loss, or cosmetic?** Cosmetic/functional gap — no data at risk,
but a real workflow hole (has to leave the list to reschedule a task in it).

**Still needed?** Yes.
