> **Status:** Open · **Filed:** 2026-09-16 · **Roadmap:** R10–R11

# EP-07 — Tasks depth

**What.** The three Tasks pages the design specifies that do not exist
(Upcoming, Assigned to me, Habits), task recurrence, and analytics on the
Completed page that currently renders as a plain list.

**Design:** [design.md](design.md) — the design work is done; this epic tracks *whether* to build each piece.

**Is this epic still worth doing?** Yes, with one strong argument in its favour:
**R4 already paid the schema cost.** `assigneeId`, priorities, lists and due
times shipped in the Tasks schema bump and currently have almost nothing
surfacing them, so part of this epic is finishing something already half-paid
for rather than starting something new.

The weakest item is [FEAT-031](FEAT-031-tasks-worth-knowing.md) — it
mirrors the Wallet insight engine and should wait until the Wallet one has
proven itself with real use.

## Items

| ID | Title | Still needed? |
|---|---|---|
| [FEAT-026](FEAT-026-tasks-upcoming-board.md) | Upcoming week board | Shipped — PR #219 |
| [FEAT-027](FEAT-027-tasks-assigned-to-me.md) | Assigned to me, delegation ledger | Shipped — PR #221 |
| [FEAT-028](FEAT-028-task-recurrence.md) | Task recurrence | Shipped |
| [FEAT-029](FEAT-029-tasks-habits.md) | Habits | Shipped |
| [FEAT-030](FEAT-030-tasks-completed-analytics.md) | Completed analytics | Shipped |
| [FEAT-031](FEAT-031-tasks-worth-knowing.md) | "Worth knowing" insight engine | Question it — sequence after FEAT-021 |
| [FEAT-032](FEAT-032-tasks-wallet-chips.md) | Wallet chips on task rows | Shipped (outliner only) |
| [FEAT-051](FEAT-051-task-list-picker.md) | Assign a task's list (category) from the row | Yes — no schema change, UI-only gap |
| [BUG-005](BUG-005-quick-add-task-noop.md) | Quick-add "Task" does nothing | Fixed |
| [BUG-006](BUG-006-no-due-date-change-in-list-view.md) | No due-date change from a list view | Yes |
| [FEAT-052](FEAT-052-edit-task-from-row.md) | Edit a task's text from any list-style view | Yes — every non-outliner view is affected |
| [FEAT-053](FEAT-053-create-task-list.md) | A way to create a task list | Yes — the other half of FEAT-051's gap |
