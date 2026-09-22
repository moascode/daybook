> **Status:** Open · **Filed:** 2026-09-16 · **Epic:** [EP-07](README.md)

# FEAT-031 — Tasks: "Worth knowing" insight engine

**What.** Surface non-obvious patterns — lists that never finish, tasks that always slip, load imbalance.

**Why now.** Mirrors the Wallet anomaly work. Lower value than the Wallet equivalent; sequence it last.

**Design.** [design.md](design.md) — the design work is already done; this item tracks *whether* to build it, not how.

**Still needed?** **Narrowed and folded into [FEAT-054](FEAT-054-tasks-today-design-adoption.md), 2026-09-22.** The
owner asked for Today's "Worth knowing" rail card now, ahead of FEAT-021
proving out — but scoped to only what's honestly computable from data already
on the Today page (load imbalance across the 7-day strip, count of tasks with
no due date, an evening-heavy-today count), not this item's original design
(which includes claims like "moved 4 times" and completion-rate percentages
that nothing in the data model currently tracks). Treat FEAT-054's rail-card
acceptance criteria as authoritative for what ships; this file's original,
broader insight-engine scope stays open for later modules/pages once real
history exists to back it.
