> **Status:** Open · **Filed:** 2026-09-20 · **Epic:** [EP-07](README.md)

# FEAT-052 — Edit a task's text from any list-style view

**What.** A way to change a task's content after creation from anywhere a
task renders outside the outliner — List detail, All tasks, Completed,
Upcoming, Assigned to me — all of which render `TaskListRow.tsx`. Confirmed
by reading the component: `task.content` is rendered as a plain `<p
className="task-title">`, with no click-to-edit, no edit affordance, no
`contentEditable`, nothing. The only place a task's text can be changed today
is the outliner's `BulletEditor` (a `contentEditable` div reachable only from
`/tasks` or a zoomed-in list root).

**Why now.** Owner reported: "once a task is added, it can't be edited from
task list view." Confirmed — `TaskListRow` has zero write path for `content`,
only for completion (checkbox), due date is a separate already-tracked gap
([BUG-006](BUG-006-no-due-date-change-in-list-view.md)), and assignee (via
FEAT-027's new picker). Text itself is stuck.

**Out of scope.** Rebuilding `TaskListRow` as a rich editor like
`BulletEditor` — a simple click-to-edit (turn the `<p>` into an `<input>` or
`contentEditable` span on click/double-click, save via
`updateTask(id, { content })` on blur/Enter, matching the outliner's existing
debounced-save pattern) is enough; this item is not asking for subtask
creation or note-editing from these views.

**Still needed?** Yes — every non-outliner Tasks view (List detail, All
tasks, Completed, Upcoming, Assigned to me) is affected identically, since
they all share `TaskListRow`.
