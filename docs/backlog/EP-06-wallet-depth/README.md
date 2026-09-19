> **Status:** Open · **Filed:** 2026-09-16 · **Roadmap:** R8–R9

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

**Sequencing note.** [FEAT-021](FEAT-021-recurring-anomalies.md)
(recurring anomalies) and [FEAT-018](FEAT-018-budgets-suggestions.md)
(budget suggestions) are the two that change behaviour rather than just
displaying it. If only part of this epic gets built, build those.

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

## Items

| ID | Title | Still needed? |
|---|---|---|
| [FEAT-018](FEAT-018-budgets-suggestions.md) | Budgets: suggestions engine | Scheduled — split into 3 PRs, [PR #214](https://github.com/moascode/daybook/pull/214) is 1/3 |
| [FEAT-019](FEAT-019-goals-trajectory.md) | Goals: rings, funding rate, honest ETA | Yes |
| [FEAT-020](FEAT-020-recurring-calendar.md) | Recurring: month calendar and annual cost | Yes |
| [FEAT-021](FEAT-021-recurring-anomalies.md) | Recurring: "Worth a look" anomalies | **Yes — build early.** Pays for the module |
| [FEAT-022](FEAT-022-reports-what-changed.md) | Reports: paired columns, savings gap, What changed | Yes |
| [FEAT-023](FEAT-023-reports-category-trends.md) | Reports: category sparkline trends | Yes |
| [FEAT-024](FEAT-024-shared-minimum-transfers.md) | Shared: group-wide minimum-transfer set | Yes — read the settlement CAS trap first |
| [FEAT-025](FEAT-025-shared-split-rules.md) | Shared: split rules with staleness | Yes |
