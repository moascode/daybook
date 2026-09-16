> **Status:** Open · **Filed:** 2026-09-16 · **Source:** [feature-consistency-plan.md](../../archive/feature-consistency-plan.md), [deferred-items-plan.md](../../archive/deferred-items-plan.md)

# EP-03 — Consistency remainder

**What.** The small amount of genuinely unbuilt work left across two large
consistency plans.

**Read this before scheduling anything from those two documents.** Between them
they propose roughly 45 items across 11 waves. **Verified 2026-09-16: almost all
of it shipped.** The plans were never updated, so they still read as full
backlogs. They are not.

| Wave | Verified status |
|---|---|
| Consistency W1 correctness, W3 sharing IA, W4 filter bar, W5 cross-path rules, W7 interaction | ✅ shipped |
| Consistency W2 split model | ✅ shipped except `SplitDialog.tsx`, which the plan wanted folded in |
| Consistency W6 dead code & data flow | ❌ **unbuilt** — the only whole wave left |
| Consistency W8 copy & settings | ✅ mostly; `formatDisplayDate` never centralised |
| Deferred F1 (CD-03, CD-08, CD-09, CD-15, U-13) | ✅ shipped — `NetWorthBanner.tsx`, `ConfirmDeleteModal`, `useCrudModal` all landed |
| Deferred F2 (U-10 filter chips) | ✅ shipped — `WalletPage.tsx` |
| Deferred F3 (B-15 budget effective amounts) | ✅ shipped — `EFFECTIVE_AMOUNT_SQL` in `worker/routes/wallet.ts` |

**Is this epic still worth doing?** It is four small cleanups with no user-facing
effect. Worth doing opportunistically, not worth a dedicated track. The real
value of this epic is the table above — it stops the next session from
rediscovering 45 shipped items the hard way.

## Items

| ID | Title | Still needed? |
|---|---|---|
| [FEAT-011](../items/FEAT-011-non-mutating-fetch.md) | Non-mutating `fetchTransactions` variant | Yes |
| [FEAT-012](../items/FEAT-012-batch-delete-transactions.md) | Batch `DELETE /transactions` endpoint | Yes |
| [FEAT-013](../items/FEAT-013-centralise-date-formatting.md) | Centralise `formatDisplayDate` | Yes — 15+ inline copies |
| [FEAT-014](../items/FEAT-014-fold-split-dialog.md) | Fold `SplitDialog` into the bulk path | Question it — it may be earning its place |
