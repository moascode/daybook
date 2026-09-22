> **Status:** Archived · **Last verified:** 2026-09-22 · **Filed:** 2026-09-16 · **Shipped:** 2026-09-20 (PR #224) · **Epic:** [EP-07](../../backlog/EP-07-tasks-depth/README.md)

# FEAT-029 — Tasks: Habits

**What.** Rings, a 28-day grid, streaks and a weekday chart for habitual tasks.

**Why now.** Habits are a different thing from tasks and currently have to be faked as repeated one-offs.

**Design.** [design.md](../../backlog/EP-07-tasks-depth/design.md) — the design work is already done; this item tracks *whether* to build it, not how.

**Still needed?** Shipped — `/tasks/habits`: current/best streak, a 28-day grid
(kept/missed/not-due), a per-weekday rate chart with a "weakest day" callout,
and the Wallet-linked "no spend day" habit (`linked_kind`), which derives
`done` from the day having no expense transaction rather than an explicit
entry.
