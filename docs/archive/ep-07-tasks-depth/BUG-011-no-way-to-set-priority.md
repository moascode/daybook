> **Status:** Archived · **Last verified:** 2026-09-22 · **Filed:** 2026-09-21 · **Shipped:** 2026-09-21 (PR #233) · **Epic:** [EP-07](../../backlog/EP-07-tasks-depth/README.md)

# BUG-011 — No UI anywhere to set or change a task's priority

**Expected.** Since All tasks already has a "filter by priority" control
(`TasksAllPage.tsx`, `PRIORITY_OPTIONS` / `data-testid="all-tasks-filter-priority"`),
there should be some way to actually set a task's priority — the filter is
otherwise filtering on a value the user can never assign.

**Actual.** Grepping the whole `src/` tree for `priority` turns up: the
`Task`/`TaskPriority` type, the filter dropdown and its query-side use in
`TasksAllPage.tsx`, the `updateTask`'s payload type (`useTasks.ts` accepts
`priority` in its options object), and read-only uses in `TaskRow.tsx`/
`TaskListRow.tsx` (border colour on the complete-checkbox: `pri-high`/
`pri-med`). There is no priority `<select>`/picker anywhere, no
`updateTaskPriority` helper called from any row, and no priority control in
the outliner's `BulletNode.tsx` either. The backend plumbing exists
(`updateTask` can carry `priority`); nothing in the UI calls it.

**Repro.**
1. Go to All tasks, open the priority filter, pick "High".
2. Try to find a way to actually mark any task as High priority.
3. There is none.

**Where I think it lives.** No single file — a UI gap. The natural place is
`TaskListRow.tsx`'s complete-checkbox affordance (already colour-coded by
priority) plus whatever composer/edit surface BUG-007/BUG-009 add.

**Money, data loss, or cosmetic?** Functional gap — a filter with nothing
that can set the value it filters on.

**Still needed?** Fixed — `useTasks.ts` gained `updateTaskPriority(id,
priority)` (same guard-free direct-PATCH pattern as `updateTaskDueDate`/
`assignTask`), and `TaskDetailModal.tsx` exposes a priority `<select>`
wired to it. Reachable from Today (row click) and All tasks (new
`Pencil` icon button on `TaskListRow`, additive — existing inline editors
untouched).
