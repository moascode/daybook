> **Status:** Open · **Filed:** 2026-09-16 · **Epic:** [EP-03](README.md)

# FEAT-011 — Non-mutating `fetchTransactions` variant

**What.** A read-only transaction fetch that returns rows without writing them
into the Wallet store, for Dashboard, Reports and Budgets.

**Why now.** Those three pages currently call `loadTransactions`, which mutates
shared store state as a side effect of reading. That couples unrelated pages:
opening Reports can change what the transaction list shows.

**Out of scope.** Introducing a query library — `@tanstack/react-query` is
explicitly not installed and needs approval.

**Notes.** Verified 2026-09-16 as unbuilt. Also remove `getFilteredSummary`
(`src/hooks/useWallet.ts`), which the same wave marked dead and which is still
exported.

**Still needed?** Yes
