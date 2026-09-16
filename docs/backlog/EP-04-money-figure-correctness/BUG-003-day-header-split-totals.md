> **Status:** Open · **Filed:** 2026-09-16 · **Epic:** [EP-04](README.md) · **Severity:** medium

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

**Still needed?** **Yes** — first step is confirming it is real
