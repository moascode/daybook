> **Status:** Open · **Filed:** 2026-09-16 · **Epic:** [EP-02](../epics/EP-02-wallet-ux-remainder.md)

# FEAT-010 — Finish the dead-code sweep (C6)

**What.** Remove the unused exports and superseded helpers left from Phase 5c.

**Why now.** Low value on its own. Worth doing opportunistically alongside
another change in the same files rather than as a dedicated PR.

**Out of scope.** Anything behavioural.

**Notes.** Recorded as partial in 2026-07; **verify how much is already gone
before scheduling** — several refactors have passed through these files since,
and this may be close to done. Consider `Dropped` if so.
