> **Status:** Archived · **Last verified:** 2026-09-22 · **Filed:** 2026-09-16 · **Shipped:** 2026-09-20 (PR #225) · **Epic:** [EP-07](../../backlog/EP-07-tasks-depth/README.md)

# FEAT-030 — Tasks: Completed analytics

**What.** A year heatmap, time-to-finish distribution, and a by-list breakdown on the Completed page.

**Why now.** The Completed page shipped in R5 as a list. The data for all three of these already exists.

**Design.** [design.md](../../backlog/EP-07-tasks-depth/design.md) — the design work is already done; this item tracks *whether* to build it, not how.

**Still needed?** Shipped — a year heatmap, by-list breakdown with average
time-to-finish, and a "graveyard, not a backlog" callout when a list's
average is 3x+ the overall average, on `GET /tasks/completed/analytics`
(worker/routes/tasks.ts) and rendered above the existing day-grouped list on
`/tasks/completed`.
