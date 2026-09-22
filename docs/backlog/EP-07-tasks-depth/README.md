> **Status:** Open · **Filed:** 2026-09-16 · **Roadmap:** R10–R11

# EP-07 — Tasks depth

**What.** The three Tasks pages the design specifies that do not exist
(Upcoming, Assigned to me, Habits), task recurrence, and analytics on the
Completed page that currently renders as a plain list.

**Design:** [design.md](design.md) — the design work is done; this epic tracks *whether* to build each piece.

**Is this epic still worth doing?** Most of it already shipped — 17 of the
19 items filed under this epic are done (below), and the remaining
structural item (BUG-013) is now fixed too. What's left is one item
deliberately parked.

## Shipped

Verified against the code and archived 2026-09-22. All items have e2e
coverage (`e2e/91-*` through `e2e/99-*`).

| ID | Title | How it shipped |
|---|---|---|
| [FEAT-026](../../archive/ep-07-tasks-depth/FEAT-026-tasks-upcoming-board.md) | Upcoming week board | [PR #219](https://github.com/moascode/daybook/pull/219), 2026-09-18 |
| [FEAT-027](../../archive/ep-07-tasks-depth/FEAT-027-tasks-assigned-to-me.md) | Assigned to me, delegation ledger | [PR #221](https://github.com/moascode/daybook/pull/221), 2026-09-19 |
| [FEAT-028](../../archive/ep-07-tasks-depth/FEAT-028-task-recurrence.md) | Task recurrence | [PR #223](https://github.com/moascode/daybook/pull/223), 2026-09-19 |
| [FEAT-029](../../archive/ep-07-tasks-depth/FEAT-029-tasks-habits.md) | Habits | [PR #224](https://github.com/moascode/daybook/pull/224), 2026-09-20 |
| [FEAT-030](../../archive/ep-07-tasks-depth/FEAT-030-tasks-completed-analytics.md) | Completed analytics | [PR #225](https://github.com/moascode/daybook/pull/225), 2026-09-20 |
| [FEAT-032](../../archive/ep-07-tasks-depth/FEAT-032-tasks-wallet-chips.md) | Wallet chips on task rows (outliner only) | [PR #226](https://github.com/moascode/daybook/pull/226), 2026-09-20 |
| [BUG-005](../../archive/ep-07-tasks-depth/BUG-005-quick-add-task-noop.md) | Quick-add "Task" does nothing | [PR #227](https://github.com/moascode/daybook/pull/227), 2026-09-21 |
| [BUG-006](../../archive/ep-07-tasks-depth/BUG-006-no-due-date-change-in-list-view.md) | No due-date change from a list view | [PR #228](https://github.com/moascode/daybook/pull/228), 2026-09-21 |
| [FEAT-052](../../archive/ep-07-tasks-depth/FEAT-052-edit-task-from-row.md) | Edit a task's text from any list-style view | [PR #228](https://github.com/moascode/daybook/pull/228), 2026-09-21 |
| [FEAT-051](../../archive/ep-07-tasks-depth/FEAT-051-task-list-picker.md) | Assign a task's list (category) from the row | [PR #229](https://github.com/moascode/daybook/pull/229), 2026-09-21 |
| [FEAT-053](../../archive/ep-07-tasks-depth/FEAT-053-create-task-list.md) | A way to create a task list | [PR #229](https://github.com/moascode/daybook/pull/229), 2026-09-21 |
| [BUG-007](../../archive/ep-07-tasks-depth/BUG-007-today-row-not-editable.md) | Today page rows can't be edited at all | [PR #233](https://github.com/moascode/daybook/pull/233), 2026-09-21 |
| [BUG-008](../../archive/ep-07-tasks-depth/BUG-008-today-row-name-truncated.md) | Today rows truncate long names with no way to read them | [PR #233](https://github.com/moascode/daybook/pull/233), 2026-09-21 |
| [BUG-009](../../archive/ep-07-tasks-depth/BUG-009-composer-no-list-or-date.md) | No way to pick a list or date while creating a task | [PR #233](https://github.com/moascode/daybook/pull/233), 2026-09-21 |
| [BUG-010](../../archive/ep-07-tasks-depth/BUG-010-all-tasks-row-layout-squeezes-name.md) | All tasks row layout squeezes/hides the task name | [PR #233](https://github.com/moascode/daybook/pull/233), 2026-09-21 |
| [BUG-011](../../archive/ep-07-tasks-depth/BUG-011-no-way-to-set-priority.md) | No UI anywhere to set or change a task's priority | [PR #233](https://github.com/moascode/daybook/pull/233), 2026-09-21 |
| [BUG-012](../../archive/ep-07-tasks-depth/BUG-012-upcoming-card-no-detail-modal.md) | Upcoming board cards don't open a detail/edit view | [PR #233](https://github.com/moascode/daybook/pull/233), 2026-09-21 |

## Items still open

| ID | Title | Still needed? |
|---|---|---|
| [BUG-013](BUG-013-task-row-grid-not-structurally-fixed.md) | `.task`'s fixed-column grid doesn't fit `TaskListRow`'s variable children | Fixed — [PR #235](https://github.com/moascode/daybook/pull/235), 2026-09-22 |
| [FEAT-031](FEAT-031-tasks-worth-knowing.md) | "Worth knowing" insight engine | Question it — sequence after the Wallet equivalent (FEAT-021) has proven itself with real use |
