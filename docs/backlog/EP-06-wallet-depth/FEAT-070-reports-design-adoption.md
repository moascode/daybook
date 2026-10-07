> **Status:** Open · **Filed:** 2026-10-07 · **Epic:** [EP-06](README.md)

# FEAT-070 — Reports: exact mock parity

**What.** `ReportsPage.tsx` is a narrow column (`max-w-4xl mx-auto`) with two
cards:

- a Recharts **Year-on-year comparison** (last calendar year vs this one, four
  bar series);
- a **Custom date range** card that lists raw transactions after you press
  Apply.

The mockup's `reports.html` is a 12-column `.dash` page. Its header has
"Reports" / "{window}", with a **3m / 6m / 12m / All** segment and **Export**.
Below that come seven cards:

- four **stat cards**: Income, Spending, Savings rate, Net worth change;
- **Income vs spending** (`c8`) — paired monthly columns, with a sentence on
  growth and when the gap closes;
- **Savings rate** (`c4`) — this month's rate, a monthly line and the average;
- **What changed** (`c7`) — a diverging bar per category against your own
  12-month average, plus the net effect;
- **Cash flow** (`c5`) — In / Out / Kept for recent months, and the total kept;
- **Category trends** (`c12`) — a sparkline per category, its average, this
  month and the change, with an **Amount / Share** toggle.

Checked on 2026-10-07 against the mockup's rendered DOM
(`http://localhost:4873/reports.html`, 1400 wide) and the real page at
`:8788`, seeded with 15 months of data.

**Absorbs [FEAT-022](FEAT-022-reports-what-changed.md)** (paired columns,
savings gap, "What changed") and **[FEAT-023](FEAT-023-reports-category-trends.md)**
(category sparkline trends) whole. Both are marked superseded by this item in
the same PR. The EP-06 audit of 2026-10-02 filed no design item for Reports,
because those two were its whole visible gap. This item is that gap plus the
stat cards, savings-rate card, cash-flow table and header the mock also shows.

**What the data model gives us.** Everything on the page is a read over
existing `transactions` and `accounts` rows. There is **no schema change**. Net
worth at any date comes from `accountBalanceAsOf`
(`src/modules/wallet/accounts/insights.ts`), which already reconstructs
balances honestly (0 before an account existed).

**What it doesn't.** Nothing records *why* a month was weak. The mockup's
"both had unbudgeted travel" is a causal claim the data cannot make. The
sentence therefore names the category that ran furthest above its own
average, and claims nothing more.

## Owner decisions (2026-10-07)

| Question | Decision |
|---|---|
| Composer | **None** — Reports is read-only (design.md: "absent from read-only pages") |
| What "this month" means | **The last complete month.** Today (Oct 7) that is September. The window ends there |
| "Your own 12-month average" with less history | **Average the complete months that exist, up to 12, minimum 3.** Below 3, What changed and Category trends say "Needs 3 months of history" and show no figures |
| Growth % and "gap closes in N months" | **Linear trend.** A least-squares line through monthly income and through monthly spending over the window. Growth % = fitted last ÷ fitted first − 1. The gap closes where the lines cross — shown only if they converge within 120 months |
| Old Year-on-year chart and Custom date range card | **Dropped.** The period segment and Export replace them; Transactions already filters by date |
| Schema | **None needed** |
| PR split | **One PR** |

## Stated rules (assumptions — documented, tunable, not hidden)

Every figure below follows the §3 money traps:

- **own accounts only** (`!a.isShared`) — never the whole
  `GET /api/accounts` array;
- **`countableAmount`**, never `t.amount`;
- **transfers excluded** from income and spending.

**Window and months**

- **Months.** A "month" is a calendar month of `YYYY-MM-DD` business dates.
  The **anchor month** ("this month") is the last *complete* month: the month
  before `businessToday()`'s.
- **Window.** The segment picks how many complete months end at the anchor:
  **3m** = 3, **6m** = 6, **12m** = 12 (default). **All** = from the month of
  the earliest own-account transaction to the anchor. A window never starts
  before that first month — 12m over 5 months of history shows 5 months.
- **Header sub** = "{Mon YYYY} – {Mon YYYY}" of the window. With no
  complete-month data at all, the page shows an empty state: "Reports start
  once a full month of transactions exists", plus Export.

**Stat cards**

- **Income** = sum over the window. Sub-line: "{avg} average" (per month in
  the window).
- **Spending** works the same way, over expenses.
- **Income and Spending chips** = trend growth % (see **Trend** below). The
  chip is omitted when the window has fewer than 3 months.
  - Income: up → `chip-pos`, down → `chip-warn`.
  - Spending: up → `chip-warn`, down → `chip-pos`.
  - Within ±0.5% → `chip-mute`.
- **Savings rate** = (income − spending) ÷ income over the window, shown with
  1 decimal. It is "—" when income is 0. Sub-line: "Best month {x}% · worst
  {y}%", over months with income > 0.
- **Net worth change** = Σ own-account `accountBalanceAsOf` at the window's
  last day − the same at the day before the window starts. Signed, `pos`/`neg`.
  Sub-line: "{start} → {end}".

**Trend**

- **Trend** = an ordinary least-squares line over the window's monthly values
  (x = 0…n−1). Growth % = `fit(n−1) ÷ fit(0) − 1`, shown with 1 decimal.
  It is undefined (no chip, no sentence) when n < 3, `fit(0) ≤ 0` or
  `fit(n−1) < 0` — a fitted line below zero would read as "down 120%".
- **Gap sentence** (under Income vs spending): "Income is {up|down} {a}% over
  the {window}, spending {up|down} {b}%." Then one of:
  - "If both hold, the gap closes in about {N} months." (N ≥ 1, singular
    at 1) — when the spending
    slope exceeds the income slope, the fitted spending at n−1 is below the
    fitted income, and they cross within 120 months after the anchor
    (N rounded);
  - "If both hold, the gap is widening." — when the income slope ≥ the
    spending slope and fitted income > fitted spending;
  - "Spending is already above income." — when fitted spending ≥ fitted
    income at n−1;
  - "At this rate the gap holds for over 10 years." — when they converge but
    cross after 120 months.

  With an undefined trend, the sentence says only "{Kept} kept over the
  {window}."

**Charts**

- **Income vs spending chart** = paired columns per window month (income
  `--pos`, spending `--info`), and an axis in round MYR steps (4 gridlines;
  step = max ÷ 3 rounded up to 1/2/2.5/5 × 10ᵏ, top = 3 × step). The anchor month's label is bold `--fg`.
  With more than 12 months ("All"), it shows the last 12 columns. The chart
  has an `aria-label` summarising both series.
- **Savings rate card** shows three things:
  - the anchor month's rate, with a "this month" chip — `chip-pos` if ≥ the
    window rate, else `chip-warn`;
  - a line of the monthly rates, with the window rate as a dashed "avg {x}%"
    line. The axis runs 0 → max(60, ceil10(max rate)), and down to
    min(0, floor10(min rate)) when a month went negative. The bounds include
    the avg rate, and the floor never goes below −100% — a lower month draws
    clamped at the bottom edge;
  - the sentence "{M1} and {M2} were the weakest months of the {window}."
    Months are named in calendar order, with the year added if two share a name.
    (one month if the window has < 4 months). When the same expense category
    has the largest positive delta over its baseline in every named month,
    it adds "Both had {category} above its usual." (or "It had …"). No causal
    claim beyond that.

**Comparisons**

- **Baseline (the "12-month average")** = per category, the mean monthly
  spend over up to 12 complete months **before** the anchor (the anchor is
  excluded). Months with no spend count as 0. It needs at least 3 such months
  of history, measured from the first own-account transaction. It is
  independent of the window segment, as the mock's card subtitle says.
- **What changed** = per expense category (uncategorised → "Uncategorised"),
  `delta = anchor spend − baseline`. It shows the 6 largest by |delta|, with
  |delta| < RM1 dropped. The order is positives (descending), then negatives
  (by size, the largest decrease last — as in the mock).
  - Bars are `left:50%` red (`--neg`) for increases and `right:50%` green
    (`--pos`) for decreases. Width = |delta| ÷ max|delta| × 45%.
  - Values are signed, coloured `--neg-fg` / `--pos-fg`.
  - Footer: "Net effect: {±net} versus a typical month", where net = Σ delta
    over **all** categories, rounded to cents (|net| < 0.005 is 0).
  - It adds "{category} alone explains most of it." when that category's
    delta has the net's sign and is ≥ 50% of |net|, and net ≠ 0.
  - With no rows: "This month was in line with your average."
- **Cash flow** = the window's months, newest first, capped at 6 rows:
  Month (full name) · In · Out · Kept.
  - The anchor month's Kept is `--pos-fg`; a negative Kept is `--neg-fg`.
  - Footer: "{n}-month total kept" — n is the window's month count, and the
    sum covers the **whole** window, not just the 6 rows.
  - **Full ledger** links to `/wallet/transactions`.
  - On phones (≤ 680px) the In column is hidden so Out and Kept fit
    without sideways scrolling (owner call, 2026-10-07). Category trends
    likewise drops the sparkline and Average there.
- **Category trends** shows one row per expense category with spend in the
  window or the baseline, sorted by baseline descending.
  - Columns: dot and name · sparkline over the window's months · Average
    (baseline) · This month (anchor) · Change.
  - Change = anchor ÷ baseline − 1, as a whole %.
  - Chip: |Δ| < 5% → `chip-mute`; up 5–50% → `chip-warn`; up > 50% →
    `chip-neg`; down ≥ 5% → `chip-pos`. A baseline of 0 with anchor spend
    gives "New" (`chip-warn`).
  - **Share** shows each figure as % of that month's total spend, and
    Change in percentage points ("+3.2 pts", same chip bands on |pts| with
    5/15 cut-offs). The share average uses the same baseline months as
    Amount (months with no spend at all are skipped), and the row order stays
    the Amount baseline order.
  - Colour = the category's own `color`; uncategorised = `rgb(var(--fg-subtle))`.
- **Export** opens the existing `ExportModal` with the window's own-account
  transactions — transfers included, since this is an export, not a total —
  wired to `useWallet().exportTransactions`.
- **Net worth and opening balances.** An account created mid-window counts
  as 0 before its `createdAt`, so its opening balance shows up as net worth
  gained in that window. This is the same reconstruction the Accounts
  net-worth chart uses, kept deliberately so the two pages agree.

## Acceptance criteria

**Layout**
- [ ] Page root uses `.dash`, not `max-w-4xl`. Card order and spans follow
      the mock: 4× `stat-card c3` → `c8` + `c4` → `c7` + `c5` → `c12`.
- [ ] Header: `h1` "Reports", the window sub, a `.segment` `role="tablist"`
      with **3m / 6m / 12m / All** (12m selected), and **Export**
      (`btn-secondary`). **No composer.**
- [ ] The empty state (no complete month) shows the copy and Export only.
- [ ] Year-on-year chart and Custom date range card are removed.

**Cards** — each as specified in the Stated rules, with the mock's titles,
subtitles, legends and footers verbatim (except where a rule replaces mock
copy).
- [ ] Income vs spending is hand-drawn SVG, like the mock, not Recharts.
      `data-testid="income-vs-spending"`, with one `rect` pair per month.
- [ ] What changed rows use `.div-row` / `.div-track` / `.div-bar` and carry
      `data-testid="what-changed-row"`.
- [ ] Cash flow is a `<table>` with `thead` Month / In / Out / Kept.
- [ ] Category trends rows use `.lhead` / `.lrow` (`data-testid=
      "category-trend-row"`). The Amount / Share segment is `role="tablist"`.
- [ ] Below the minimum history, What changed and Category trends show
      "Needs 3 months of history" and no figures — never zeros.

**Data loading** — one page-local `api.get('/transactions')` with no date
bounds (net worth needs all of it). It does **not** go through
`useWallet().loadTransactions`, the same pattern as Goals/Recurring, and it
filters to own accounts. If it fails, a toast appears and the page shows an
error state with **Retry**, not an empty report.

**Code** — the maths lives in pure functions in
`src/modules/wallet/reports/insights.ts`, one component per card under
`src/modules/wallet/reports/`, and React keys come from ids or month keys,
never labels.

**Tests**
- [ ] `e2e/18-wallet-advanced-reports.spec.ts` keeps its navigation tests and
      drops the Year-on-year / custom-range assertions. Those are replaced by
      the new spec.
- [ ] New `e2e/104-reports-design-adoption.spec.ts` covers:
      - the stat figures and window sub for a seeded history;
      - the segment changing the window (3m vs 12m totals);
      - one column pair per month;
      - What changed signs and net effect;
      - the cash-flow rows and total kept;
      - a category-trend change chip and the Share toggle;
      - the < 3-month "Needs 3 months of history" state;
      - shared-in account money excluded from totals;
      - Export opening the modal.

      Dates via `businessToday()` / `businessDatePlus()` only.
- [ ] Both themes checked rendered; no `dark:` variants.

## Out of scope

The composer. Causal explanations ("unbudgeted travel"). A custom date range
(Transactions has one). Click-through from a chart column to that month's
transactions.

**Still needed?** Yes — filed 2026-10-07, in progress.
