> **Status:** Archived · **Last verified:** 2026-09-22 · **Filed:** 2026-09-21 · **Shipped:** 2026-09-21 (PR #233) · **Epic:** [EP-07](../../backlog/EP-07-tasks-depth/README.md)

# BUG-008 — Today rows truncate long task names with no way to read the rest

**Expected.** A long task name on the Today page is either not clipped, or
has some way to read the full text (title attribute, tooltip, wrap, or the
edit-mode input from BUG-007 doubling as a way to see it in full).

**Actual.** `.task-title` (`src/styles/tasks.css`) is
`overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` inside a
`.task` grid whose columns are fixed widths except the name column (`1fr`).
`TaskRow.tsx`'s `<p className="task-title">` has no `title` attribute and,
per BUG-007, isn't clickable — so once a name is long enough to ellipsis,
there is no way to see the rest of it on this page.

**Repro.**
1. Add a task on the Today page with a long name (longer than the row's
   available width).
2. The name ellipses.
3. Hover or click it — nothing reveals the full text.

**Where I think it lives.** `src/modules/tasks/TaskRow.tsx` /
`src/styles/tasks.css` `.task-title`. Confirmed by reading both.

**Money, data loss, or cosmetic?** Cosmetic, but blocks actually reading
your own task list — compounds with BUG-007 since clicking to edit (which
would also reveal the full text) does nothing on this page.

**Still needed?** Fixed — the title now carries a `title` attribute (native
tooltip on hover) and, via BUG-007's fix, opens `TaskDetailModal` on click,
which shows the full untruncated name in an editable input.
