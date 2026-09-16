> **Status:** Open · **Filed:** 2026-09-16 · **Epic:** [EP-03](../epics/EP-03-consistency-remainder.md)

# FEAT-014 — Fold `SplitDialog` into the bulk split path

**What.** The consistency plan wanted `SplitDialog.tsx` deleted once
`BulkSplitDialog` covered the single-transaction case.

**Why now.** Two dialogs doing similar work is where behaviour drifts —
and split maths is the part of this app where drift costs real money.

**Out of scope.** Any change to split semantics.

**Notes.** **Question this one before building it.** `BulkSplitDialog` shipped,
but `SplitDialog` also gained the ability to load and edit existing splits,
which may be a genuinely different job from splitting a fresh selection. Confirm
the single-transaction case is fully covered before deleting anything — this is
a refactor with a money-shaped blast radius and no user-visible upside.

**Still needed?** Question it — it may be earning its place
