> **Status:** Open · **Filed:** 2026-09-16 · **Epic:** [EP-08](README.md)

# FEAT-033 — Trips: schema and `trip_id` threading

**What.** A `trips` table plus `trip_id` on transactions and tasks (`ON DELETE SET NULL`).

**Why now.** Nothing else in Trips can start without it. Additive migration only.

**Design.** [design.md](design.md) — the design work is already done; this item tracks *whether* to build it, not how.

**Still needed?** Yes — R12, the foundation
