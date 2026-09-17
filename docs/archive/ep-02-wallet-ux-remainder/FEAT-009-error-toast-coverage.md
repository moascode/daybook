> **Status:** Archived · **Last verified:** 2026-09-18

**Shipped** in [PR #210](https://github.com/moascode/daybook/pull/210) —
`addToast` on 8 previously-silent catches plus `e2e/32-wallet-error-toasts.spec.ts`.
Independent review caught a real money-correctness bug in `BulkSplitDialog`
before it went up (stale transaction data could stay Save-able after a failed
reload) — fixed in the same PR. Full trail in [design.md](design.md).

# FEAT-009 — Finish error-toast coverage (C3)

**What.** Every CRUD path reports its failures. Coverage exists but is partial.

**Why now.** This is CLAUDE.md §2 rule 10 — "never fail silently" — which the
project treats as overriding, and a partially-covered rule is a rule people
assume is handled. A failed save that shows nothing is indistinguishable from a
successful one until reload.

**Out of scope.** Redesigning the toast system; `toast.store.ts` already exists.

**Notes.** Verified 2026-09-16 as partial. Start by listing every `catch` in
`src/hooks/` and `src/modules/wallet/` that does not surface, then work the list.

**Still needed?** Yes — it is rule 10
