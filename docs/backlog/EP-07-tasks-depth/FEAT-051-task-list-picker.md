> **Status:** Shipped · **Filed:** 2026-09-20 · **Epic:** [EP-07](README.md)

# FEAT-051 — Assign a task's list (category) from the task row

**What.** A way to put a task into a list — freely named, freely coloured,
whatever the user wants to call it ("Work", "Personal", "Grocery") — from the
row itself, in the outliner and everywhere else a task renders. Today
`task_lists` (name + colour) and `tasks.list_id` already exist and are
*displayed* (the coloured dot on `TaskListRow`, list badges on Upcoming/
Completed/All), but nothing anywhere lets a user actually set or change a
task's `list_id`. Every task is created `list_id = NULL` and stays that way —
the "Lists" sidebar group is populated only by lists created from
`TasksListDetailPage`, and there is no picker on a row to move a task into one.

**Why now.** Owner asked for "a flexible category — work, personal, grocery,
whatever I want to put it as" and said they don't see this in the app today.
Confirmed by reading the code: `task_lists`/`list_id` is exactly this
mechanism (free-form user-created name + colour, not a fixed enum), it already
shipped its schema and its display — it is only the *assignment* UI that was
never built. This is the same shape of gap EP-07's README already calls out
generally ("assigneeId, priorities, lists and due times shipped... and
currently have almost nothing surfacing them").

**Out of scope.** A second, independent tagging dimension on top of lists
(multiple simultaneous categories per task) — the owner confirmed a single
list/category per task is what they're after; if that changes, it is a new
item, not a rework of this one. Also out of scope: building the "Lists"
creation UI itself (already exists at `/tasks/lists/:listId`) — this item is
only the picker that sets `list_id` on a task from wherever a task renders.

**Still needed?** Shipped — a picker everywhere a task renders: `TaskListRow.tsx`
(a `<select>` next to the list dot, on TasksAllPage/TasksListDetailPage/
TasksCompletedPage/TasksAssignedPage) and the outliner's own "Move to list…"
dialog (`BulletNode.tsx`). `TaskListRow`'s picker uses a new guard-free
`updateTaskList` (`useTasks.ts`, mirroring `assignTask`/`updateTaskContent`/
`updateTaskDueDate`) since its callers bypass the outliner's Zustand store;
the outliner's own dialog uses the guarded `updateTask` (now with `listId`
added to its allowlist) since outliner tasks are always store-resident.
