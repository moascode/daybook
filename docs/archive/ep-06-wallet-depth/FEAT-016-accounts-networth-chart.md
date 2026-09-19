> **Status:** Archived · **Last verified:** 2026-09-18 · **Filed:** 2026-09-16 · **Shipped:** 2026-09-06 · **Epic:** [EP-06](../../backlog/EP-06-wallet-depth/README.md)

# FEAT-016 — Accounts: credit utilisation and 12-month net-worth chart

**What.** Credit-card utilisation on card accounts, and a 12-month net-worth
trend chart.

**Already shipped when filed.** Same story as [FEAT-015](FEAT-015-accounts-composition.md)
in the same folder: filed 2026-09-16 as "unstarted", already live since
[PR #166/#168](https://github.com/moascode/daybook/pull/168), 2026-09-06.
Verified live on `main` (2026-09-18):

- Credit utilisation bar (`AccountCard.tsx`) — shown for `type === 'card'`
  accounts with a `creditLimit` set, falling back to the sparkline otherwise.
- `NetWorthHistoryChart.tsx`, fed by `computeMonthlyNetWorth()` in
  `src/modules/wallet/accounts/insights.ts` — a real 12-month reconstruction
  from the transaction ledger, not a placeholder.

**Gap closed 2026-09-18.** No e2e spec covered utilisation or the net-worth
chart specifically. Added `e2e/87-wallet-accounts-depth.spec.ts` to lock in the
behaviour.
