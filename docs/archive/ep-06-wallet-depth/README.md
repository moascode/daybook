> **Status:** Archived · **Last verified:** 2026-10-10

# EP-06 — Wallet depth (partial archive)

Items from the still-open [EP-06](../../backlog/EP-06-wallet-depth/README.md)
epic, archived here because they've shipped. **Read for reasoning,
never as instructions** — EP-06 itself is not closed; several items remain open
in the backlog.

## What shipped

| Item | What it was | How it shipped |
|---|---|---|
| [FEAT-015](FEAT-015-accounts-composition.md) | Accounts: composition breakdown and sparklines | [PR #166/#168](https://github.com/moascode/daybook/pull/168), 2026-09-06 — `BalanceSummary.tsx`, `AccountCard.tsx`, `insights.ts` |
| [FEAT-016](FEAT-016-accounts-networth-chart.md) | Accounts: credit utilisation and 12-month net-worth chart | Same PR — `AccountCard.tsx`, `NetWorthHistoryChart.tsx` |
| [FEAT-017](FEAT-017-budgets-summary-band.md) | Budgets: summary band and pace marker | [PR #213](https://github.com/moascode/daybook/pull/213), 2026-09-19 — `BudgetsPage.tsx`, `BudgetPace.tsx` |
| [FEAT-018](FEAT-018-budgets-suggestions.md) | Budgets: suggestions engine | [PR #214](https://github.com/moascode/daybook/pull/214)/[#215](https://github.com/moascode/daybook/pull/215)/[#216](https://github.com/moascode/daybook/pull/216), 2026-09-19 |
| [FEAT-019](FEAT-019-goals-trajectory.md) | Goals: rings, funding rate, honest ETA | Shipped 2026-10-06 as part of [FEAT-067](FEAT-067-goals-design-adoption.md), [PR #247](https://github.com/moascode/daybook/pull/247) |
| [FEAT-020](FEAT-020-recurring-calendar.md) | Recurring: month calendar and annual cost | Shipped 2026-10-07 as part of [FEAT-068](FEAT-068-recurring-design-adoption.md), [PR #248](https://github.com/moascode/daybook/pull/248) |
| [FEAT-021](FEAT-021-recurring-anomalies.md) | Recurring: "Worth a look" anomalies | Shipped 2026-10-07 as part of [FEAT-068](FEAT-068-recurring-design-adoption.md), [PR #248](https://github.com/moascode/daybook/pull/248) |
| [FEAT-022](FEAT-022-reports-what-changed.md) | Reports: paired columns, savings gap, "What changed" | Shipped 2026-10-07 as part of [FEAT-070](FEAT-070-reports-design-adoption.md), [PR #249](https://github.com/moascode/daybook/pull/249) |
| [FEAT-023](FEAT-023-reports-category-trends.md) | Reports: category sparkline trends | Shipped 2026-10-07 as part of [FEAT-070](FEAT-070-reports-design-adoption.md), [PR #249](https://github.com/moascode/daybook/pull/249) |
| [FEAT-066](FEAT-066-budgets-design-adoption.md) | Budgets: exact mock parity | [PR #246](https://github.com/moascode/daybook/pull/246), 2026-10-06 |
| [FEAT-067](FEAT-067-goals-design-adoption.md) | Goals: exact mock parity, incl. FEAT-019 | [PR #247](https://github.com/moascode/daybook/pull/247), 2026-10-06 |
| [FEAT-068](FEAT-068-recurring-design-adoption.md) | Recurring: exact mock parity, incl. FEAT-020/021 | [PR #248](https://github.com/moascode/daybook/pull/248), 2026-10-07 |
| [FEAT-070](FEAT-070-reports-design-adoption.md) | Reports: exact mock parity, incl. FEAT-022/023 | [PR #249](https://github.com/moascode/daybook/pull/249), 2026-10-07 |
| [FEAT-063](FEAT-063-transactions-category-avatar.md) | Transactions: category-coloured row avatar | [PR #251](https://github.com/moascode/daybook/pull/251), 2026-10-07 — `categoryIcon.tsx`, `TransactionList.tsx` |
| [FEAT-064](FEAT-064-dashboard-settle-up-header.md) | Dashboard: page-header "Settle up" quick action | [PR #252](https://github.com/moascode/daybook/pull/252), 2026-10-09 — `Dashboard.tsx` |
| [FEAT-065](FEAT-065-accounts-composer.md) | Accounts: mount the transaction composer | [PR #252](https://github.com/moascode/daybook/pull/252), 2026-10-09 — `PageComposer.tsx`, `AccountsPage.tsx` |
| [FEAT-069](FEAT-069-shared-composer-and-activity-icons.md) | Shared: mount the transaction composer; category-coloured activity icons | Icons [PR #251](https://github.com/moascode/daybook/pull/251), 2026-10-07; composer [PR #252](https://github.com/moascode/daybook/pull/252), 2026-10-09 — `SharedActivity.tsx`, `SharedPage.tsx` |

FEAT-015/016 were filed to the backlog 2026-09-16 as "unstarted", ten days
after they had already landed — the exact stale-conversion trap
[`docs/backlog/README.md`](../../backlog/README.md) warns about elsewhere.
Verified against the code and archived 2026-09-18, with the one real gap
found — no e2e spec covered this rendering specifically — closed by
`e2e/87-wallet-accounts-depth.spec.ts`. FEAT-017 is ordinary shipped work,
archived 2026-09-19 once its PR merged.
