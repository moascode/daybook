# Wallet — design adoption (R3)

Four PRs behind one tag. No new computation, no schema change. Every figure on
screen after R3 is a figure that was on screen before it.

---

## PR 1 · Transactions + Accounts

Highest-traffic pages; they establish the row, day-header, stat-card and
account-card components the rest of the module reuses.

### Transactions (`/wallet` — `WalletPage.tsx` 997 L, `TransactionList.tsx` 350 L)

| Design element | Today | Work |
|---|---|---|
| Three stat cards (In / Out / Net), 3 lines each, icon on the label's line | summary row | restyle to `.stat-card`, 20px padding to match Accounts |
| Filter field visibly distinct from global search | shares styling | `.filter-field` — sunken, funnel icon, `Filter these 128 transactions…` |
| **Removable filter chips** | `Filters (2)` count | render each active filter as an individually removable chip |
| Day headers on the row's grid, weekday bold + date muted | unaligned | `.tday` sharing `.trow`'s column template |
| **Day net as an unlabelled overlay pill**, green when positive | labelled total | `−RM90.60` in a `surface-sunk` pill on the amount column |
| Two-line rows, amount right-aligned, hover actions sliding in | 5-line stacked cards on mobile | `.trow` — same component desktop and mobile |
| `Import CSV` button on the page | sidebar item | move the entry point |
| Composer above everything | — | **R7**; R3 leaves the header action |

Audit the day-header totals for split double-counting while here (see
[README.md](README.md) invariant 2).

### Accounts (`/wallet/accounts` — `AccountsPage.tsx`, `AccountCard.tsx`)

- Summary card at 20px padding, matching Transactions.
- `.acct` card grid: name, type, balance, hover lift.
- The redundant "All accounts" table below the cards is **dropped** — the cards
  already say it.
- Composition, sparklines, utilisation and the 12-month chart are **R8**.
- Totals sum `ownAccounts` only.

---

## PR 2 · Overview

The page that most needs the grid, and the one whose content already exists.

**Layout** — one 12-column `.dash`, one 20px gap, `align-items: stretch`:

```
A  hero (8)                       featured account (4)
B  coming up (4)  budget pace (4)  shared (4)
C  spend pace (12)
D  where it goes (6)              week rhythm (6)
E  recent activity (8)            top merchants (4)
```

**Hero** (v4 restored, v6 re-laid-out, v7.1 tightened): two columns — greeting
and net worth on the left, Money in / out / Kept to the right of a hairline.
Gradient on the corrected emerald ramp 700 → 600 → 400. **No buttons in the
hero** — actions live in the page header, where they sit on every other page.
**No decorative sparkline** — it stood in for data the card does not otherwise
show.

**Existing cards, re-housed** (this is most of the work — they exist and work):

| Design card | Component | R3 |
|---|---|---|
| Coming up | `dashboard/UpcomingBills.tsx` | restyle |
| Budget pace | `dashboard/BudgetPace.tsx` | restyle, keep the where-you-should-be notch |
| Shared | `dashboard/SharedSummary.tsx` | restyle |
| Spend pace | `dashboard/SpendPace.tsx` | restyle to full width, 280px; axes/today rule = R7 |
| Where it goes | `dashboard/CategoryBreakdown.tsx` | restyle; donut = R7 |
| Week rhythm | `dashboard/WeekRhythm.tsx` | restyle to 6 cols; average line = R7 |
| Top merchants | `dashboard/MerchantTable.tsx` | restyle; Month/Year toggle = R7 |
| Recent activity | (the page's txn table) | **cut to 5 rows + link out** — the duplicated table with its own search and date range is a second copy of the Transactions page |
| Committed vs discretionary, What changed | `CommittedSpend`, `WhatChanged` | keep; they are good and insight-led |

**Featured account card** keeps its coloured treatment — it earns the one
remaining coloured surface by being the thing you check most.

Cards ending in a summary line push it down with `margin-top: auto` so footers
align across the row.

---

## PR 3 · Shared

Restyle only, and carefully. Read [README.md](README.md) invariant 1 first.

- Balances read **against a centre line**, so who owes whom is a direction
  rather than a minus sign.
- The footer uses the **same grid as the rows**, so the amount column runs
  straight down (v10 fixed this after a Settle button broke the right edge).
- Settle buttons live **only in the Settle up card**, not per row in Balances
  (v11 reverted v9 here). On mobile they drop out of Balances entirely.
- Shared activity rows show **total and your share** — different numbers that
  people confuse.
- Keep the existing claim-lifecycle UI, `SplitStateBar`, `ConfirmReceiptDialog`
  and the derived-state grouping intact. Restyle the containers, not the logic.
- Minimum-transfer settle-up and Split rules are **R9**.

---

## PR 4 · Budgets, Goals, Recurring, Reports

Restyle only; their depth lands in R8/R9. The one structural change to make now,
because it is a layout rule rather than a feature:

**Summaries become `c12` bands, not half-width cards with a partner.** v9 tried
matching card heights by padding the short one and moved the empty space
elsewhere; v10's rule is that a `c12` band has nothing to match, so it is exactly
as tall as its content.

- **Budgets** — month summary as a band: figure left, three stats right of a
  hairline, pace bar full width beneath. Budget rows take the standard row hover.
- **Goals** — band with the four goal rows across the full width, then the goal
  cards. Rings replace bars in R9.
- **Recurring** — list restyle; the month calendar is R9.
- **Reports** — chart restyle through `useChartTheme()`; new charts are R9.

---

## Done when

- Four PRs merged under one tag.
- **No Wallet behaviour changed.** A diff of any computed figure before/after is
  a bug, not a redesign.
- ~25 Wallet spec files green.
- Rendered and reviewed in both themes at 1440 / 768 / 390.
