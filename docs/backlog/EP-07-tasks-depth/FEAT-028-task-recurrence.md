> **Status:** Shipped · **Filed:** 2026-09-16 · **Epic:** [EP-07](README.md)

# FEAT-028 — Tasks: recurrence

**What.** Recurring tasks, mirroring what Wallet already does for recurring transactions.

**Why now.** The most-requested shape of task — weekly, monthly, every-quarter — cannot be expressed at all today.

**Design.** [design.md](design.md) — the design work is already done; this item tracks *whether* to build it, not how.

**Still needed?** Shipped — daily/weekly/monthly/yearly/custom-weekday recurrence,
optional interval and end (date or count), materialized via
`POST /tasks/recurring/process` (fire-and-forget on boot, mirroring Wallet's
recurring-transactions model). Set from the outliner's "Repeats…" dialog
(`BulletNode.tsx`); read-only chip on other list-style rows
(`TaskListRow.tsx`) — editing recurrence from those rows is tracked as part of
[FEAT-052](FEAT-052-edit-task-from-row.md)'s broader gap.
