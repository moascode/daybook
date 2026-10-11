> **Status:** Fixed · **Filed:** 2026-09-16 · **Epic:** [EP-04](README.md) · **Severity:** medium

# BUG-003 — Transaction-list day headers may double-count splits

**Expected.** A day header's income/expense totals count a split transaction at
the user's effective share, matching what the dashboard shows.

**Actual.** Unverified — and the same bug class has already shipped once. PR
#106 fixed exactly this across the whole dashboard (tiles used
`countableAmount` while charts and lists used raw `t.amount`, so a split RM100
expense read RM50 in a tile and RM100 in the chart beneath it) but **did not
touch `TransactionList.tsx`.**

**Repro (to confirm the bug exists).**
1. Split an expense with a group member 50/50.
2. Open the transaction list for that day.
3. Compare the day header's expense total against the dashboard for the same day.
   They should agree; if the header shows the gross, they won't.

**Why it matters.** Two figures for the same day, on two screens, in a money
app. Carried as known-unaudited in `CLAUDE.md` §8 and flagged in its own traps
section.

**Where it lives.** `src/modules/wallet/TransactionList.tsx` day-header
aggregation. The fix, if confirmed, is to route through `countableAmount` like
the dashboard now does.

**Out of scope.** Re-auditing the dashboard — PR #106 covered it.

**Still needed?** Fixed — `TransactionList.tsx`'s `groupByDay()` was already
routing day totals through `countableAmount()` as of 42c1a1c (v2.0.0), before
this item was filed; the fix shipped, the audit just hadn't caught up. This PR
adds the missing regression coverage (`e2e/107-day-header-split-totals.spec.ts`)
rather than touching the logic.

The repro above ("header should show half right after splitting") contradicts
decision §9.1: an unsettled split leaves the FULL amount on the payer, so there
is nothing to disagree with the dashboard about at that point — both read the
same gross-equals-effective figure. The new spec instead pins the two shapes
that actually exercise `countableAmount()`'s branches: an unsettled split
(still full, documenting §9.1) and a split settled on a LATER date than the
expense. Settling on the SAME day the expense was booked cannot distinguish
the bug from the fix — the settlement's balance-only income leg and the
expense's reduced effective amount cancel out to the identical net either way
(`settledAmount - grossAmount`, whether you get there via `effectiveAmount`
minus a zeroed balance-only leg, or via raw `t.amount` minus an uncredited one).
Only a different-day settlement exposes the divergence, which is what the
added spec builds. Verified to fail against `t.amount` (the pre-fix read) and
pass against `countableAmount(t)`.
