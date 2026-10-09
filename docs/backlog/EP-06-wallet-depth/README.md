> **Status:** Open · **Filed:** 2026-09-16 · **Last verified:** 2026-10-10 · **Roadmap:** R8–R9

# EP-06 — Wallet depth

**What.** The analytical depth the redesign specified for Wallet's five
secondary pages: Accounts, Budgets, Goals, Recurring, Reports and Shared. The
pages exist and are on the new design (R3); what is missing is what they compute.

**Design:** [design.md](design.md) — the design work is done; this epic tracks *whether* to build each piece.
The design work is done — these items track *whether* to build each piece.

**Is this epic still worth doing?** Yes, and it is the highest-value epic in the
backlog. Wallet is the module both users actually use daily, the data is already
in D1, and every item is a read over existing rows — no schema changes, no
one-way doors.

**Sequencing note.** [FEAT-021](../../archive/ep-06-wallet-depth/FEAT-021-recurring-anomalies.md)
(recurring anomalies, built as part of [FEAT-068](../../archive/ep-06-wallet-depth/FEAT-068-recurring-design-adoption.md)) and [FEAT-018](../../archive/ep-06-wallet-depth/FEAT-018-budgets-suggestions.md)
(budget suggestions) were the two that changed behaviour rather than just
displaying it — both have now shipped, along with the rest of this epic's
design-adoption wave (see Shipped below).

## Shipped

Filed 2026-09-16 as "unstarted"; both had already landed 2026-09-06 in
[PR #166/#168](https://github.com/moascode/daybook/pull/168), before this
backlog conversion happened — the exact stale-conversion trap the top-level
[`docs/backlog/README.md`](../README.md) warns about. Verified against the
code and archived 2026-09-18, with the one e2e gap (no spec covered the
rendering specifically) closed by `e2e/87-wallet-accounts-depth.spec.ts`.

| ID | Title | How it shipped |
|---|---|---|
| [FEAT-015](../../archive/ep-06-wallet-depth/FEAT-015-accounts-composition.md) | Accounts: composition breakdown and sparklines | `BalanceSummary.tsx`, `AccountCard.tsx`, `insights.ts` |
| [FEAT-016](../../archive/ep-06-wallet-depth/FEAT-016-accounts-networth-chart.md) | Accounts: credit utilisation, 12-month net worth | `AccountCard.tsx`, `NetWorthHistoryChart.tsx` |
| [FEAT-017](../../archive/ep-06-wallet-depth/FEAT-017-budgets-summary-band.md) | Budgets: summary band and pace marker | [PR #213](https://github.com/moascode/daybook/pull/213), 2026-09-19 |
| [FEAT-018](../../archive/ep-06-wallet-depth/FEAT-018-budgets-suggestions.md) | Budgets: suggestions engine | [PR #214](https://github.com/moascode/daybook/pull/214)/[#215](https://github.com/moascode/daybook/pull/215)/[#216](https://github.com/moascode/daybook/pull/216) — doc corrected 2026-10-04, was stale |
| [FEAT-019](../../archive/ep-06-wallet-depth/FEAT-019-goals-trajectory.md) | Goals: rings, funding rate, honest ETA | Shipped 2026-10-06 as part of [FEAT-067](../../archive/ep-06-wallet-depth/FEAT-067-goals-design-adoption.md), [PR #247](https://github.com/moascode/daybook/pull/247) |
| [FEAT-020](../../archive/ep-06-wallet-depth/FEAT-020-recurring-calendar.md) | Recurring: month calendar and annual cost | Shipped 2026-10-07 as part of [FEAT-068](../../archive/ep-06-wallet-depth/FEAT-068-recurring-design-adoption.md), [PR #248](https://github.com/moascode/daybook/pull/248) |
| [FEAT-021](../../archive/ep-06-wallet-depth/FEAT-021-recurring-anomalies.md) | Recurring: "Worth a look" anomalies | Shipped 2026-10-07 as part of [FEAT-068](../../archive/ep-06-wallet-depth/FEAT-068-recurring-design-adoption.md), [PR #248](https://github.com/moascode/daybook/pull/248) |
| [FEAT-022](../../archive/ep-06-wallet-depth/FEAT-022-reports-what-changed.md) | Reports: paired columns, savings gap, What changed | Shipped 2026-10-07 as part of [FEAT-070](../../archive/ep-06-wallet-depth/FEAT-070-reports-design-adoption.md), [PR #249](https://github.com/moascode/daybook/pull/249) |
| [FEAT-023](../../archive/ep-06-wallet-depth/FEAT-023-reports-category-trends.md) | Reports: category sparkline trends | Shipped 2026-10-07 as part of [FEAT-070](../../archive/ep-06-wallet-depth/FEAT-070-reports-design-adoption.md), [PR #249](https://github.com/moascode/daybook/pull/249) |
| [FEAT-066](../../archive/ep-06-wallet-depth/FEAT-066-budgets-design-adoption.md) | Budgets: exact mock parity (no composer — a Plan page) | [PR #246](https://github.com/moascode/daybook/pull/246), 2026-10-06 |
| [FEAT-067](../../archive/ep-06-wallet-depth/FEAT-067-goals-design-adoption.md) | Goals: exact mock parity, incl. FEAT-019 (no composer — a Plan page) | [PR #247](https://github.com/moascode/daybook/pull/247), 2026-10-06 |
| [FEAT-068](../../archive/ep-06-wallet-depth/FEAT-068-recurring-design-adoption.md) | Recurring: exact mock parity, incl. FEAT-020/021 (no composer — a Plan page) | [PR #248](https://github.com/moascode/daybook/pull/248), 2026-10-07 |
| [FEAT-070](../../archive/ep-06-wallet-depth/FEAT-070-reports-design-adoption.md) | Reports: exact mock parity, incl. FEAT-022/023 (no composer — read-only) | [PR #249](https://github.com/moascode/daybook/pull/249), 2026-10-07 |
| [FEAT-063](../../archive/ep-06-wallet-depth/FEAT-063-transactions-category-avatar.md) | Transactions: category-coloured row avatar | [PR #251](https://github.com/moascode/daybook/pull/251), 2026-10-07 — `categoryIcon.tsx`, `TransactionList.tsx` |
| [FEAT-064](../../archive/ep-06-wallet-depth/FEAT-064-dashboard-settle-up-header.md) | Dashboard: page-header "Settle up" quick action | [PR #252](https://github.com/moascode/daybook/pull/252), 2026-10-09 — `Dashboard.tsx` |
| [FEAT-065](../../archive/ep-06-wallet-depth/FEAT-065-accounts-composer.md) | Accounts: mount the transaction composer | [PR #252](https://github.com/moascode/daybook/pull/252), 2026-10-09 — `PageComposer.tsx`, `AccountsPage.tsx` |
| [FEAT-069](../../archive/ep-06-wallet-depth/FEAT-069-shared-composer-and-activity-icons.md) | Shared: mount the transaction composer; category-coloured activity icons | Icons [PR #251](https://github.com/moascode/daybook/pull/251), 2026-10-07; composer [PR #252](https://github.com/moascode/daybook/pull/252), 2026-10-09 — `SharedActivity.tsx`, `SharedPage.tsx` |

**2026-10-07.** FEAT-066 (Budgets), FEAT-067 (Goals), FEAT-068 (Recurring) and
FEAT-070 (Reports) shipped — PRs #246–#249 — each to exact mock parity. In
shipping, FEAT-067 absorbed and shipped FEAT-019 whole, FEAT-068 absorbed
and shipped FEAT-020 and FEAT-021 whole, and FEAT-070 absorbed and shipped
FEAT-022 and FEAT-023 whole. All ten item docs are archived above.

**2026-10-10.** FEAT-063 (category-coloured row avatars, [PR #251](https://github.com/moascode/daybook/pull/251)), FEAT-064 (Dashboard "Settle up" header action), FEAT-065 (Accounts composer) and FEAT-069 (Shared composer + activity icons; icons in #251, composer in [PR #252](https://github.com/moascode/daybook/pull/252)) shipped. With them, Wallet matches the v2 mockup; what remains open here (FEAT-024, FEAT-025) is unbuilt computation, not design parity.

## Items

| ID | Title | Still needed? |
|---|---|---|
| [FEAT-024](FEAT-024-shared-minimum-transfers.md) | Shared: group-wide minimum-transfer set | Yes — read the settlement CAS trap first |
| [FEAT-025](FEAT-025-shared-split-rules.md) | Shared: split rules with staleness | Yes |

**FEAT-063–FEAT-069, filed 2026-10-02**, are a second-pass design-adoption
audit (same pipeline as the Tasks module's FEAT-054–062): the real running
app at `:8788` diffed page-by-page against the rendered mockup DOM at
`:4873`, after checking this epic's own table above so nothing already
tracked here as computation work got double-filed as "design." Reports got
no new item — its entire visible gap is FEAT-022/023, already listed above.

**FEAT-066 revised 2026-10-04** to full exact-mock-parity scope (owner
call) rather than composer-only — see the item for why, and for why that
also folds in and corrects FEAT-018's stale status. **FEAT-067 revised
2026-10-06** the same way for Goals, and absorbs FEAT-019 whole — that page's
gap was the funding-rate computation, not restyling. It adds two nullable
columns (`goals.target_date`, `goals.note`) on owner sign-off. **FEAT-068
revised 2026-10-06** the same way for Recurring, and absorbs FEAT-020 and
FEAT-021 whole. It adds three nullable/defaulted columns to
`recurring_transactions` (`paused`, `previous_amount`, `amount_changed_at`)
on owner sign-off. **FEAT-070 filed 2026-10-07** for Reports the same way;
it absorbs FEAT-022 and FEAT-023 whole and needs no schema change.
