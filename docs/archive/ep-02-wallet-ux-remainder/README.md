> **Status:** Archived · **Last verified:** 2026-09-18

# EP-02 — Wallet UX remainder (archive)

The five items left over from Phase 5c, filed 2026-09-16 and closed the same
week. **Everything here describes work that shipped, or was superseded.**
Read it for reasoning, never as instructions.

## What shipped

| Item | What it was | How it shipped |
|---|---|---|
| [FEAT-006](FEAT-006-responsive-grids.md) | Responsive grid breakpoints (B7) | **Dropped** — superseded by the `layout.css` custom grid system before this epic was even filed; nothing to build |
| [FEAT-007](FEAT-007-touch-targets.md) | 40px minimum touch targets (B11) | [PR #209](https://github.com/moascode/daybook/pull/209) — `Button` `size="icon"` variant, ~20 migrated call sites, `e2e/21-mobile-responsive.spec.ts` |
| [FEAT-008](FEAT-008-recurring-card-badges.md) | Type/category badges on recurring cards (B10) | Already shipped in `2a8ec2a` (2026-08-24), before this epic was filed; `e2e/14-wallet-recurring.spec.ts` |
| [FEAT-009](FEAT-009-error-toast-coverage.md) | Finish error-toast coverage (C3) | [PR #210](https://github.com/moascode/daybook/pull/210) — `addToast` on 8 previously-silent catches, `e2e/32-wallet-error-toasts.spec.ts` |
| [FEAT-010](FEAT-010-dead-code-sweep.md) | Finish the dead-code sweep (C6) | [PR #211](https://github.com/moascode/daybook/pull/211) — removed `getMonthlySpending`, `useSplits`, `claimsInState` |

The full verification-then-implementation trail — what was checked against the
code, what the plan was, and what an independent review caught before each PR
went up (including a real money-correctness bug in PR #210's `BulkSplitDialog`)
— is in [design.md](design.md).

This closes out [`phase-5c-wallet-ux.md`](../phase-5c-wallet-ux.md)'s last five
open items (B7, B10, B11, C3, C6) — see that doc's own entry in
[`../README.md`](../README.md) for the full B/C list.
