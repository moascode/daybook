> **Status:** Open — superseded by [FEAT-068](FEAT-068-recurring-design-adoption.md) · **Filed:** 2026-09-16 · **Last verified:** 2026-10-06 · **Epic:** [EP-06](README.md)

# FEAT-021 — Recurring: "Worth a look" anomalies

**What.** Detect price rises, dormant subscriptions, and same-day collisions across recurring rules.

**Why now.** This is the feature that pays for the module — an unnoticed price rise is a permanent leak.

**Design.** [design.md](design.md) — the design work is already done; this item tracks *whether* to build it, not how.

**Still needed?** No — superseded. [FEAT-068](FEAT-068-recurring-design-adoption.md) (revised 2026-10-06 to exact mock parity) builds this whole item — "Worth a look": price rises (matched charges + recorded edits), same-day collisions, and a costliest-subscription nudge in place of the dormant check (no usage data exists) — with the stated rules and owner decisions recorded there. Close this when FEAT-068 ships.
