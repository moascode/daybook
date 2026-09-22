> **Status:** Archived · **Last verified:** 2026-09-22 · **Filed:** 2026-09-21 · **Shipped:** 2026-09-21 (PR #233) · **Epic:** [EP-07](../../backlog/EP-07-tasks-depth/README.md)

# BUG-007 — Today page rows can't be edited at all

**Expected.** A task row on the Today page (`/tasks` or wherever
`TasksTodayPage` lands) lets the user edit the task's name, list, and due
date from the row — the same click-to-edit affordances `TaskListRow.tsx`
already has for All tasks (FEAT-052 content edit, FEAT-051 list picker,
BUG-006 due-date picker).

**Actual.** `TasksTodayPage.tsx` renders every group (Overdue/Today/Done
today) with `TaskRow.tsx`, not `TaskListRow.tsx`. `TaskRow.tsx` only wires a
complete/incomplete toggle (`onToggleComplete`) — it has no click handler on
`task-title`, no list chip/picker, and no due-date control. So on Today,
nothing about a task can be changed except marking it done: not its name,
not its list, not its date.

**Repro.**
1. Go to the Today page.
2. Click a task's name, list area, or due date.
3. Nothing happens — the only interactive element in the row is the
   complete checkbox.

**Where I think it lives.** `src/modules/tasks/TaskRow.tsx` (no edit
affordances at all) and `src/modules/tasks/TasksTodayPage.tsx` (chooses
`TaskRow` over `TaskListRow`). Confirmed by reading both files.

**Money, data loss, or cosmetic?** Functional gap — Today is the module's
landing page and currently the least editable view in it.

**Still needed?** Fixed — `TaskRow.tsx`'s title is now clickable
(keyboard-accessible too) and opens the new shared `TaskDetailModal.tsx`,
which edits name, list, due date, priority, note and (where applicable)
assignee, auto-saving each field on change/blur.
