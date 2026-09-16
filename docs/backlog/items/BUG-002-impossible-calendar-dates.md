> **Status:** Open · **Filed:** 2026-09-16 · **Epic:** — · **Severity:** medium

# BUG-002 — ISO date validation accepts impossible calendar dates

**Expected.** `2026-02-30` and `2026-04-31` are rejected as invalid dates.

**Actual.** Both are accepted. `Date.parse` rolls them over to 2 March and
1 May rather than returning `NaN`, so `transactionInputError` and `isoDateError`
both pass them. Only an out-of-range *month* is caught.

**Repro.**
1. Create a transaction with date `2026-02-30`.
2. It saves. Reload — it appears under 2 March.

**Why it matters.** Low frequency, but it silently relocates a transaction to a
different day, which quietly corrupts any daily or monthly figure. Present in
**both** backends; pre-existing, not introduced by the Workers port.

**Where it lives.** `transactionInputError` and `isoDateError`. The fix is to
round-trip: parse, then re-format, and reject if the result differs from the
input.

**Out of scope.** Any other validation rework.
