> **Status:** Fixed · **Filed:** 2026-09-21 · **Epic:** [EP-07](README.md)

# BUG-010 — All tasks row layout squeezes/hides the task name

**Expected.** The task name is the most prominent, least-likely-to-be-hidden
column across every Tasks list view (Today, All tasks, Upcoming's "Waiting
for a date", etc.) — a consistent layout where the name reads first and
plainly, and optional metadata (list, due date, assignee, recurrence,
subtasks) doesn't crowd it out.

**Actual.** `.task` (`src/styles/tasks.css`) is a CSS grid with fixed pixel
column widths (`20px 1fr 128px 108px 28px 32px`, `104px`/`auto` variants
under breakpoints) sized for `TaskRow.tsx`'s fixed set of children. But
`TaskListRow.tsx` (used on All tasks) renders a variable number of
children depending on props — list dot *or* a `<select>` list picker
(FEAT-051, unconstrained width beyond `shrink-0`), an optional subtask chip,
an optional assignee `<select>`, an optional recurrence chip, and a due-date
control — none of which line up with the row's own fixed grid template. The
list `<select>` in particular has no max-width, so a longer list name can
claim more of the row than the template's fixed column budgeted for it,
squeezing the `1fr` name column that sits right next to it.

**Repro.**
1. Go to All tasks.
2. Look at a row for a task in a list with a longish list name.
3. The task name column is visibly narrower than it should be relative to
   the metadata around it, and long task names ellipsis much earlier than
   the available row width would suggest.

**Where I think it lives.** `src/styles/tasks.css` `.task` grid template,
and `src/modules/tasks/TaskListRow.tsx`'s unconstrained `<select>` widths.
Confirmed the grid/row mismatch by reading both; the exact visual overlap
wasn't measured pixel-for-pixel.

**Money, data loss, or cosmetic?** Cosmetic, but a widely-reported
readability problem — the task name is the one thing every row exists to
show.

**Still needed?** Fixed — capped the list-picker and assignee-picker
`<select>` widths in `TaskListRow.tsx` (`truncate max-w-[92px]`) so a long
list/assignee name truncates inside its own control instead of stretching
it and squeezing the `1fr` name column beside it. `tasks.css`'s grid itself
was untouched — the name column already had `min-w-0`; the squeeze was
purely the unconstrained siblings.
