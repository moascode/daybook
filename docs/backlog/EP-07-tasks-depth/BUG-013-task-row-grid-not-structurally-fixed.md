> **Status:** Fixed · **Filed:** 2026-09-21 · **Epic:** [EP-07](README.md)

# BUG-013 — `.task`'s fixed-column grid still doesn't fit `TaskListRow`'s variable children

**Expected.** `TaskListRow.tsx` can render any combination of its optional
children (list dot/select, subtask chip, assignee select, recurrence chip,
due-date control, the BUG-011 edit-detail button) without any of them
visually overlapping another, regardless of viewport width.

**Actual.** BUG-010's fix only treats symptoms: it caps the list/assignee
`<select>` widths (`max-w-[92px] truncate`) and hides the new edit-detail
button while the due-date picker is expanded (found and fixed alongside
BUG-011 — the two controls previously overlapped and intercepted clicks).
The root cause is untouched: `.task` (`src/styles/tasks.css`) is still a
grid with a **fixed track count** (6 tracks down to 5/`auto` under
breakpoints), while `TaskListRow` can render up to 8 children depending on
which optional props a page passes. Extra children spill into an implicit
row, and any child wider than its assigned track (e.g. a native
`<input type="date">` in a 108px/28px track) overflows into whatever
renders in the next track — which is exactly what caused BUG-011's overlap,
and can still happen at other breakpoints or other child combinations that
weren't specifically tested (e.g. recurrence chip + subtask chip + due-date
control + the new edit button, all present at once, on a narrow viewport).

**Repro.** Not independently reproducible without a specific combination —
this is a structural risk, not a single confirmed instance beyond the one
BUG-011 already fixed defensively.

**Where I think it lives.** `src/styles/tasks.css`'s `.task` rule, and
`src/modules/tasks/TaskListRow.tsx`'s children. The real fix is likely
wrapping the trailing metadata (recurrence/subtask/due-date/edit-button)
in one flex container that occupies a single grid track — mirrors the
`.trow-actions` pattern already used elsewhere (`TransactionList.tsx`,
`SharedActivity.tsx`) rather than each metadata piece claiming its own
track — so the row always presents a fixed child count to the grid no
matter which optional props a page passes.

**Money, data loss, or cosmetic?** Cosmetic/functional — the one confirmed
instance (BUG-011's edit button vs. the due-date clear button) is fixed by
hiding one control while the other is active, which is acceptable but not
a structural guarantee against the next combination.

**Still needed?** Fixed — `TaskListRow.tsx`'s optional children are now
grouped into two explicit wrapper roles, `.task-name` (list indicator +
title/note) and `.task-meta` (subtask chip, assignee select, recurrence
chip, due-date control, edit-detail button), so `.task`'s grid always sees
a fixed 3-child shape (checkbox / name / meta) regardless of which optional
props a page passes, instead of assigning tracks by DOM order. `.task-meta`
is a `flex-wrap` container, and below a 900px breakpoint (scoped to
`.task:has(.task-meta)` so it doesn't affect `TaskRow.tsx`/`WaitingRow`,
the two other `.task` consumers with no `.task-meta`) it drops onto its own
row entirely, removing the space competition with the name rather than
relying on wrapping alone. BUG-011's `!showDatePicker` hide-the-edit-button
workaround is now unnecessary and removed — the two controls are flex
siblings that structurally cannot overlap. Covered by new e2e regression
tests in `e2e/92-tasks-assigned.spec.ts` (every optional child rendered at
once, including the previously-overlapping pair) and, for the two sibling
components that share `.task` but were never part of this bug, in
`e2e/69-tasks-today.spec.ts` and `e2e/91-tasks-upcoming.spec.ts`.
