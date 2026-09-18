> **Status:** Archived · **Filed:** 2026-09-16 · **Shipped:** 2026-09-06 · **Epic:** [EP-06](../../backlog/EP-06-wallet-depth/README.md)

# FEAT-015 — Accounts: composition breakdown and sparklines

**What.** A composition breakdown of where net worth sits, plus a sparkline on
each account card.

**Already shipped when filed.** This item was filed 2026-09-16 as "unstarted",
but the work had already landed 10 days earlier in
[PR #166/#168](https://github.com/moascode/daybook/pull/168) ("rebuild Accounts
as a literal port of the design mockup"), 2026-09-06 — the same stale-conversion
trap [`docs/backlog/README.md`](../../backlog/README.md) warns about elsewhere.
Verified live on `main` (2026-09-18):

- `computeComposition()` in `src/modules/wallet/accounts/insights.ts`, rendered
  by `BalanceSummary.tsx` on the Accounts page.
- `sparklinePath()` (same file), rendered by `AccountCard.tsx` on every account
  card.

**One real variance from the design brief.** The brief describes a "30-day
sparkline"; the shipped sparkline is **12 monthly points** (via
`computeMonthlyNetWorth`), not 30 daily balances. This is deliberate, not an
oversight — the code comment in `AccountCard.tsx` notes it uses "real
reconstructed balances" (there is no daily balance snapshot table, so a true
30-day line would need one) rather than a decorative daily curve. Not treated
as a gap worth reopening.

**Gap closed 2026-09-18.** No e2e spec covered composition/sparkline rendering
specifically (only generic balance-total tests existed). Added
`e2e/87-wallet-accounts-depth.spec.ts` to lock in the behaviour.
