> **Status:** Shipped · **Filed:** 2026-09-20 · **Epic:** [EP-07](README.md)

# FEAT-053 — A way to create a task list

**What.** A "+ New list" affordance somewhere in the Tasks module (the
sidebar's "Lists" group is the obvious place — `ModuleSidebar.tsx` renders
one `NavLink` per `task_lists` row plus a fixed "Unsorted" entry, with no
create control anywhere near it). `POST /task-lists`
(`worker/routes/tasks.ts:370`) already exists and works; nothing in the
client ever calls it. `TasksListDetailPage.tsx` can rename and recolour a
list that already exists, but there is no path to create the first one.

**Why now.** Owner asked: "I don't know how to add a list — is it in the
pipeline? I just see Unsorted." Confirmed by reading the code — there is
no create-list UI anywhere in `src/`, only the read/rename/recolour path on
an existing list and the read-only sidebar list.

**Out of scope.** List deletion/archiving (`task_lists.archived` exists in
the schema per `worker/routes/tasks.ts`'s `GET /task-lists`, but whether
there's a UI for it is a separate question, not investigated here — file
separately if also missing).

**Still needed?** Shipped — a "+" next to the sidebar's "Lists" label
(`ModuleSidebar.tsx`) opens `NewListModal.tsx` (name + colour, the same
preset palette `TasksListDetailPage.tsx`'s rail already uses), calls the
existing `POST /task-lists`, and navigates straight to the new list.
Shipped together with [FEAT-051](FEAT-051-task-list-picker.md) in the same
PR, per this item's own note that they're two halves of one gap.
