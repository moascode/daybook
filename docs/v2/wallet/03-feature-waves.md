# Wallet — feature waves (R7–R9)

What the proposal shows that the app does not compute. Ordered by value; each
wave is a release.

The design's own rule for these pages, worth keeping as the acceptance test:
**every card either answers a question or proposes an action — no card exists
just to display a number that already appears elsewhere.**

---

## R7 · `v3.1.0` — Composer + Overview honesty

### The composer

The primary action stops being a button in the corner and becomes the first and
largest interactive element on the page: avatar, full-width rounded field, and a
row of typed shortcuts beneath a hairline.

- Placeholder **teaches the syntax** rather than describing the field:
  `Add a transaction — try "coffee 4.20 cash"`.
- Shortcut row: Expense · Income · Transfer · Split · Import CSV, each icon in
  its semantic colour so the row is scannable before it is read.
- `N` anywhere on the page focuses it. Ink circle send button.
- Focus uses the app-bar search's language: lifts to solid surface, scales ~1%,
  gains a shadow, card takes an accent ring.
- **Because the composer is the primary action, the duplicate `Add transaction`
  button leaves the page header.**
- Absent from read-only pages (Reports) — there is nothing to add there.
- Parsing: **rules-first, Claude Haiku fallback** (D-11, governed by
  [../cross-cutting/ai-usage.md](../cross-cutting/ai-usage.md) — item A1). Always
  show a **parse preview** before commit: a natural-language field that silently
  guesses wrong about money is worse than a form. Works with no API key (falls
  back to the form).

### Overview

| Card | What lands |
|---|---|
| **Spend pace** | real axes (day 1–31, RM0–RM6k), correct aspect ratio, a `today` rule, a tooltip anchored to its actual data point, and the projection. The numbers must agree with the drawing — the design's cautionary example is old copy reading "$210 ahead" over a curve showing something else |
| **Where it goes** | donut, month total in the centre, direct-labelled legend carrying amount *and* share, slices largest-first with "Everything else" last. Hovering a segment fades the others to 50% and thickens the hovered one |
| **Week rhythm** | real column chart with values, an average line, and the daily average stated in words. Hover lifts a bar 3px |
| **Top merchants** | Month / Year toggle, plus the one-line insight: the most *frequent* merchant and the most *expensive* one are different |
| **Coming up** | bills due, with a `Total due` footer pushed to the bottom |
| **Featured account** | "RM7,232.30 safe to spend after RM2,180 of bills" — the number you actually want from a checking account, and one nothing in the app computes today |

Every figure via `countableAmount`. Every chart an `aria-label` that says what it
means in words.

---

## R8 · `v3.2.0` — Accounts depth + Budgets suggestions

### Accounts

- **Composition breakdown** — where the net worth actually sits.
- **Per-account 30-day sparklines** under an explicit "Balance and 30-day trend"
  heading. (Sparklines are allowed *here* because the section is about the trend;
  the Overview's was removed for being decoration.)
- **Credit utilisation** for card accounts.
- **12-month net-worth chart**, hovering one month dropping the other eleven to
  35% so a single month reads clearly.

### Budgets

The page's reason to exist is **Suggestions** — compact one-line rows with the
action button on the right:

1. **Reallocate** — "move RM60 from Transport, which has run at 45% for three
   months, to Dining out"
2. **Right-size** — "raise Groceries to what you actually spend"
3. **Create missing** — "you have no Sport budget and spend RM90/mo on it"

Each is one click. Beside them, six months of budget-vs-actual. The separate
overspend-ranking card is **deleted** — it and the chart said overlapping things.

The summary band closes with an **instruction, not a projection**:
"RM34 a day instead of RM46 brings it in exactly on budget."

Suggestions is the first genuine analysis engine in the app. Put the rules in a
pure module with its own unit-testable inputs, the way `insights.ts` already is.

---

## R9 · `v3.3.0` — Goals, Recurring, Reports, Shared depth

### Goals

Rings, not bars — a goal is a whole thing you are filling, not a rate.

- Funding rate and an **honest ETA** per goal, including the **paused** one and
  the **behind** one that needs RM520/mo but gets RM300.
- Trajectory chart drawing the target as a line you can see yourself reaching.
- **Next milestones** closes with the knock-on: finishing Japan in October frees
  RM140/mo, which is what puts the House deposit back on schedule. That
  second-order consequence is the card's whole point.

### Recurring

- **Month calendar as the centrepiece** — every recurring charge on the day it
  lands, colour-coded by kind, so clustering is visible.
- **Annual cost next to monthly** — RM59.99 and RM719.88 feel very different.
- **"Worth a look"** — the three things only this data can notice:
  1. a **price rise** without notice (Netflix +RM3)
  2. a **dormant subscription** (Adobe, unused since April, RM59.99/mo)
  3. a **same-day collision** (two charges on the 22nd, the day before payday)

### Reports

- Income vs spending as **paired columns where the gap *is* the savings**, with
  the sentence underneath: income up 6.1%, spending up 11.4%, gap closes in about
  26 months.
- **"What changed"** as a diverging bar chart against **your own 12-month
  average**, not against last month, which is noisier.
- **Category trends** — a 12-month sparkline beside each category's average and
  change, so a 168% jump is visibly a spike rather than a trend.

### Shared

- **Minimum-transfer settle-up**: compute the smallest set of transfers that
  clears the whole household, instead of everyone paying everyone. Each proposed
  transfer gets its own Settle button; `Mark all as settled` still clears the lot.
  This sits **on top of** the existing bilateral netting and the CAS-guarded
  `POST /settlements`, which is the part that must not be simplified.
- **Split rules** — make the automatic behaviour visible, and flag staleness
  ("the income shares are five months old").

---

## Schema impact

R7–R9 need **at most one additive column**, and possibly none:

- Everything on Overview, Reports and Budgets is derivable from existing rows.
- Goals' funding rate and ETA are derivable from goal contributions over time.
- Recurring anomalies are derivable from `recurring_transactions` history plus
  matched transactions.
- **Split rules** is the one candidate for a new table, if the rules are to
  persist rather than be inferred. Decide when R9 starts.

That is the payoff of doing Wallet first: three feature releases with almost no
migration risk, on a module whose backend is already the most complete in the app.
