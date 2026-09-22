> **Status:** Open · **Filed:** 2026-09-22 · **Epic:** [EP-07](README.md)

# FEAT-056 — Tasks: composer "Checklist" shortcut

**What.** A `Checklist` composer shortcut, as shown in `proposal-v2/tasks.html`'s
`.composer-acts` row, that creates a parent task and immediately drops the
user into adding its subtasks — a faster path to a multi-item task than
create-then-open-detail-then-add-each-subtask.

**Why now.** Split out of FEAT-054 (Today page design adoption). Unlike
Reminder (FEAT-055), the underlying capability already exists — subtasks are
real (`Task.subtaskTotal`/`subtaskDone`, parent/child via `parentId`,
surfaced today through the outliner and `TaskListRow.tsx`'s `.sub-count`
badge). What's missing is only the fast-entry UI: `TaskDetailModal.tsx`
(Today/All-tasks/Upcoming's shared editor) has no subtask-add affordance at
all today — subtasks are currently only addable via the outliner
(`BulletTree.tsx`/`BulletNode.tsx`). This shortcut needs that gap closed
first, or it would open a modal with nowhere to add the items it just
promised.

**Out of scope.** FEAT-054 ships Today's composer without this shortcut.
Reworking the outliner's own subtask UX (unaffected either way).

**Still needed?** Probably — but sequence it after (or alongside) adding
subtask-add support to `TaskDetailModal.tsx` itself, since that's the actual
blocker, not the composer button.
