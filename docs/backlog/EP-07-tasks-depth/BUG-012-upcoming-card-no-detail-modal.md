> **Status:** Fixed · **Filed:** 2026-09-21 · **Epic:** [EP-07](README.md)

# BUG-012 — Upcoming board cards don't open a detail/edit view on click

**Expected.** Clicking a task card on the Upcoming week board opens a
details view (ideally an edit-mode modal) — the calendar-like day-column
layout has too little room per card to show or edit a task inline, so a
click-through is the only reasonable way to see the rest of it.

**Actual.** `UpcomingCard` (inside `TasksUpcomingPage.tsx`) is a
`useDraggable` div with a complete checkbox and a truncated name
(`truncate text-sm`) — it has no `onClick` at all beyond the drag
listeners and the checkbox's own handler. There's no modal, no navigation,
nothing that surfaces a card's full detail (note, list, assignee,
recurrence, priority) from the board.

**Repro.**
1. Go to `/tasks/upcoming`.
2. Click a task card in any day column.
3. Nothing opens — the click either does nothing or is absorbed by the
   drag-and-drop listeners.

**Where I think it lives.** `src/modules/tasks/TasksUpcomingPage.tsx`, the
`UpcomingCard` subcomponent. Confirmed by reading the file — its only
interactive elements are the drag handlers (spread onto the whole card) and
the checkbox's `onClick`.

**Money, data loss, or cosmetic?** Functional gap — the board is
effectively read-only/drag-only once a task is on it.

**Still needed?** Fixed — `UpcomingCard`'s name span (and `WaitingRow`'s,
for the "Waiting for a date" section) now opens `TaskDetailModal` on click;
confirmed `@dnd-kit/core`'s `PointerSensor` listeners never register
`onClick`, so this coexists safely with drag.
