> **Status:** Archived · **Last verified:** 2026-10-07 · **Filed:** 2026-10-02 · **Revised:** 2026-10-06 · **Shipped:** 2026-10-07 (PR #248) · **Epic:** [EP-06](../../backlog/EP-06-wallet-depth/README.md)

# FEAT-068 — Recurring: exact mock parity

**What.** `RecurringPage.tsx` renders as a single narrow column
(`max-w-2xl mx-auto`): one card per rule, with Expense/Monthly/category
badges and inline **Post now** / edit / delete. The mockup's
`recurring.html` is a 12-column grid page with four cards:

- a **Locked in every month** band (committed vs income, a per-category
  bar, and Left this month / Annual cost / Price rises stats);
- a **Worth a look** card;
- a **month calendar** showing every charge on the day it lands;
- an **All recurring** table with a filter, Active / Paused / All tabs, an
  Annual column and a `⋯` menu per row.

Checked on 2026-10-06 against the mockup's rendered DOM
(`http://localhost:4873/recurring.html`, 1400 wide) and the real page at
`:8788`.

**Revision note.** First filed 2026-10-02 as composer-only — too narrow, the
same way [FEAT-066](FEAT-066-budgets-design-adoption.md) and
[FEAT-067](FEAT-067-goals-design-adoption.md) were. The owner wants exact
mock parity, with the standing carve-out that **Recurring is a "Plan" page
and gets no composer**, even though the mockup shows one. This revision
therefore **absorbs [FEAT-020](FEAT-020-recurring-calendar.md)** (month
calendar and annual cost) and
**[FEAT-021](FEAT-021-recurring-anomalies.md)** ("Worth a look": price
rises, dormant subscriptions, same-day collisions) whole. Both are marked
superseded by this item in the same PR. It also builds the mockup's
**Detect from history** button, which no item covered before.

**What the data model gives us, and what it doesn't.**

- **Gives:** a rule (`recurring_transactions`) holds amount, merchant,
  type, category, frequency (`monthly` | `weekly`) and `next_due_date`.
  From those, every occurrence in a month can be projected (the same
  arithmetic as the Worker's `advanceDate`), and monthly and annual cost
  follow.
- **Lacks a link from transaction to rule.** An auto-posted transaction
  copies the rule's amount exactly, and nothing points it back to the rule.
  So a posted row can **never** show a price rise. A rise only shows up in a
  charge the user typed or imported for the same merchant, or in an edit to
  the rule itself.
- **Lacks usage data.** Nothing records whether a subscription is "used,"
  so the mockup's "Adobe unused for 4 months" cannot be computed honestly.
- **Lacks a pause state.** A rule is either live or deleted.

## Owner decisions (2026-10-06)

| Question | Decision |
|---|---|
| Composer | **None** — a Plan page (standing rule) |
| Price rise | **Both** sources: (a) match real charges against the rule, (b) record edits to the rule. Schema: `recurring_transactions.previous_amount` + `amount_changed_at` |
| Dormant / "Unused" | **Replaced** by a *costliest-subscription nudge*. It states the cost and makes no usage claim. No "Unused" chip |
| Pause | **Add** `recurring_transactions.paused`. Paused rules post nothing, notify nothing and count in no total |
| Detect from history | **Build it**, rule-based. No AI, and no Anthropic call |
| "Shared 3 ways" / "12 visits last month" sub-lines | **Dropped** — rules carry no split, and nothing records visits. Sub-line is `{account} · {category}` |
| Kind colours (Bill / Subscription / Health / Income) | **Category colour** — the app has no "kind." Income uses `--pos` |
| PR split | **One PR** |

## Stated rules (assumptions — documented, tunable, not hidden)

All of these are this item's best-effort picks. They are written down here
so they are easy to find and change, not buried as magic numbers. Every rule
below covers **active (non-paused) rules only**.

- **Occurrences in a month.** Monthly: one per month on the rule's
  day-of-month, projected forwards *and backwards* from `nextDueDate` with
  `advanceDate`'s clamping. An end-of-month rule stays on month-end (B-10).
  Weekly: every 7 days from `nextDueDate`, in both directions. Projecting
  backwards only — forwards from `nextDueDate` is always kept. A
  backward-projected occurrence is kept **backwards only for dates on or
  before today and not before the rule was created** — those are the
  charges already posted; future dates come only from forward projection.
  This also resolves the B-10 inverse ambiguity (a 30th-of-month rule
  advanced to Nov 30 retreating to a phantom Oct 31) for any day that
  hasn't happened yet.
- **Monthly equivalent.** Monthly rule = `amount`; weekly = `amount × 52 / 12`.
  **Annual** = monthly equivalent × 12.
- **Locked in** = the sum of the monthly equivalents of active **expense**
  rules.
- **Income** (the "of {income} income" figure) = the average monthly
  income across the viewer's **own** accounts over the last 3 **complete**
  calendar months, via `countableAmount` (§3 money traps). If that is 0, it
  falls back to the monthly equivalent of active income rules. If that is 0
  too, the "of … income" text and the % chip are omitted.
- **% committed chip** = `lockedIn / income`. Below 25% → `chip-pos`; 25–50% →
  `chip-warn`; above 50% → `chip-neg`.
- **Left this month** = the expense occurrences dated strictly after today
  and on or before month-end. Today's charges have already been posted by
  the boot-time processor. Sub-line: "{n} charges, {d1}–{d2} {Mon}", or
  "Nothing else due this month."
- **Normalised merchant** = lower-cased, trimmed, inner whitespace collapsed.
  Matching is equality on this form only — no fuzzy matching.
- **Price rise, source (a): a matched charge.** For each active expense rule
  with a non-empty merchant, take the **most recent** expense transaction
  in the last **120 days** that meets three conditions:
  - it is on one of the viewer's own accounts;
  - its normalised merchant equals the rule's;
  - its amount is between `0.5×` and `1.5×` the rule amount. This band keeps
    a one-off big purchase at the same shop out.

  If that charge is more than `1.005 ×` the rule amount, the rule is flagged.
  Text: "{merchant} charged {charge}, rule says {amount}", with an **Update
  rule** button that PATCHes the rule's amount to the charge.
- **Price rise, source (b): an edit.** A PATCH that changes `amount` stores
  the old figure in `previous_amount` and the date (`YYYY-MM-DD`) in
  `amount_changed_at`. A rule is flagged when `amount > previous_amount` and
  `amount_changed_at` falls in the last **6 months**. Text: "{merchant} went
  up {delta}" / "{prev} → {amount} in {Mon}".
- When both sources apply to one rule, **(a)** wins, because it is the
  unacknowledged one.
- Clicking **Update rule** on an (a) row PATCHes the rule's amount, which
  writes `previous_amount`/`amount_changed_at` and makes the row a
  source-(b) "went up" row afterwards. This is intended — the rise is now
  acknowledged and recorded, not unacknowledged, so it shows informationally
  rather than with a fix-it button.
- **Price rises stat** = the number of flagged rules. Chip: "+{Σ monthly-
  equivalent delta}/mo since {earliest Mon}". The table row gets a
  `chip-warn` "+{delta} in {Mon}".
- **Costliest-subscription nudge** = the active expense rule with the
  largest annual cost whose `createdAt` is more than 6 months ago. Text:
  "{merchant} costs {annual} a year" / "{amount}/mo · running since {Mon
  YYYY}". A **Review** button opens that rule's Edit form. Omitted when no
  rule is older than 6 months.
- **Same-day collision** = among this month's occurrences, the day with 2 or
  more active expense charges and the largest total. Text: "{Two|Three|N}
  charges land on the {Nth}". Sub-line: "{total} the day before payday
  clears" when an income-rule occurrence lands on the next day, otherwise
  "{total} on the same day." Omitted when no day has 2 or more.
- **Worth a look** lists price rises first (most recent first, max 2), then
  the collision, then the nudge — at most 4 rows. Sub-line: "{N} things the
  data noticed" (singular when 1). With zero rows, the card says "Nothing
  worth a look right now" — it is never blank.
- **Detect from history.** Over the last 6 months of the viewer's own-account
  expenses, group by normalised merchant, skipping empty merchants and any
  merchant that already has a rule, paused or not. A group is a candidate
  when two things hold:
  - it has charges in **3 or more consecutive calendar months**;
  - every charge is within **±10% of the group median**.

  Suggested rule: monthly, the most recent charge's amount, account and
  category, next due = the most recent charge's date + 1 month (via
  `advanceDate`), rolled forward again (repeatedly, if needed) until it is
  **strictly after today** — so adding the candidate never back-posts a
  charge that already happened. A group is also dropped when its most
  recent charge is **more than 45 days old** (lapsed — it stopped
  recurring). Candidates are sorted by amount, descending.
- **Pause.** The `/recurring-transactions/process` sweep and the
  bills-due-soon notification both skip paused rules. **Post now** on a
  paused rule is refused with 409 and a toast; the menu item is disabled.
  The dashboard's Upcoming bills / committed-spend insights and the nav
  badge also skip paused rules. **Resume** keeps `next_due_date` as stored.
  If that date is already past, the next boot sweep catches it up, exactly
  as it does for any overdue rule today. The Resume confirmation toast says
  so.

## Acceptance criteria

**Schema** (additive only)
- [ ] Migration `worker/migrations/0027_recurring_pause_price.sql` makes
      three additive changes:
      - `paused INTEGER NOT NULL DEFAULT 0`
      - `previous_amount REAL`
      - `amount_changed_at TEXT`

      It is mirrored in `server/migrations/0026_recurring_pause_price.sql`
      so `scripts/schema-diff.mjs` parity holds.
      `docs/reference/database-schema.md` is updated.
- [ ] `RecurringTransaction` gains `paused: boolean`, `previousAmount:
      number | null` and `amountChangedAt: string | null`. `GET` returns
      them. `PATCH` accepts `paused` (boolean). When `amount` actually
      changes, `PATCH` writes `previous_amount`/`amount_changed_at`
      server-side; neither is client-writable.
- [ ] The process sweep and notifications SQL add `AND paused = 0`.
      `POST /recurring-transactions/:id/post` returns 409 for a paused rule.

**Layout**
- [ ] Page root uses the `.dash` 12-column grid, not `max-w-2xl`. Card
      order: band (`c8`) + Worth a look (`c4`) → calendar (`c12`) → All
      recurring (`c12`).
- [ ] Header: "Recurring" / "{n} active · {lockedIn} a month". Actions:
      **Detect from history** (`btn-secondary`) and **Add recurring**
      (primary). **No composer.**
- [ ] The empty state (no rules) keeps the "No recurring transactions" copy
      and adds both header actions. Band, calendar and Worth a look are
      hidden when there are no rules.

**Locked in every month** — figure, "of {income} income", % chip, a
segmented bar by category (top 3 + "Other"; uncategorised → "Uncategorised"),
a legend "{category} {monthly}", then three stats: **Left this month**,
**Annual cost** (sub-line "{top category} alone: {annual}") and **Price
rises** (count + chip, or "None" with no chip). The bar and legend use each
category's own colour (the same mapping the calendar's dots use), so a
category has one colour on the page — `Other` keeps `rgb(var(--warn))` and
"Uncategorised" keeps `rgb(var(--fg-subtle))`.

**Worth a look** — `.prow` rows with a `tavatar`: `warn` for a price rise
(chevron-up), `info` for a collision (arrow), `neutral` for the nudge
(receipt). Each row's action button works and shows a toast on failure.

**Calendar** — "{Month}" / "Every recurring charge, on the day it lands".
The legend shows each category present plus "Income". It is a Mon-first
`.cal` grid, with muted lead/trail days from adjacent months and `today`
highlighted. Each day shows its rules' dots (category colour; income
`--pos`) and the summed amount (income summed separately as "+{x}" in
`--pos-fg`). Current month only, as in the mock.

**All recurring table**
- [ ] `.lhead` / `.lrow` columns: Item · Cadence · Next · Annual · Amount · ⋯.
      - **Item**: avatar tinted with the category colour, plus merchant, a
        price-rise chip and a "Paused" chip.
      - **Sub-line**: `{account} · {category|income}`.
      - **Cadence**: "Monthly · 18th" or "Weekly · Tue".
      - **Next**: "Today" / "Tomorrow" / "d MMM", or "Paused".
      - **Amount**: income signed "+", `pos`.
- [ ] Rows keep `data-testid="recurring-row"`.
- [ ] Filter input (`aria-label="Filter recurring items"`, placeholder
      "Filter these {n}…") matches merchant, account and category. The
      **Active / Paused / All** segment (`role="tablist"`) defaults to
      Active.
- [ ] Shows the first 8 rows, then "Showing 8 of {n} active · {k} paused"
      with a **Show all** / **Show fewer** toggle.
- [ ] `⋯` (`aria-label="More actions for {merchant}"`) opens a `role="menu"`
      with four items:
      - **Post now** — disabled when paused;
      - **Edit {merchant}**;
      - **Pause {merchant}** / **Resume {merchant}**;
      - **Delete {merchant}** — keeps `ConfirmDeleteModal`.

      The menu follows the Goals `GoalCard` menu pattern: focus moves to
      the first item, Esc / outside-click closes it, and focus returns to
      the trigger.

**Detect from history** — a modal listing candidates ("{merchant} ·
{amount} · seen {k} months running"), each with **Add as recurring**, which
opens the rule form pre-filled. With no candidates it says "No repeating
charges found that aren't already recurring" — the click is never silent.
A failed history fetch shows a toast.

**Data loading** — one page-local `GET /transactions?dateFrom={6 months
ago, 1st}&dateTo={today}`, fetched with `api.get` and not through
`useWallet().loadTransactions`, the same way Goals does it. It feeds
income, price rise (a) and detection. If it fails, a toast appears. The
income fallback still applies, and price rise (a) and detection are shown as
unavailable, never as zeros.

**Tests**
- [ ] `e2e/14-wallet-recurring.spec.ts`, `e2e/24-recurring-posting.spec.ts`
      and `e2e/32-wallet-error-toasts.spec.ts` are updated for the ⋯ menu
      and the dropped "Expense" badge.
- [ ] New `e2e/103-recurring-design-adoption.spec.ts` covers:
      - band figures and committed %;
      - annual column;
      - calendar dots and amounts on the right days;
      - price rise (a) via a seeded higher charge, with Update rule
        clearing it;
      - price rise (b) via an amount edit;
      - collision;
      - nudge (needs a rule `createdAt` > 6 months — seeded via the test
        hook, or the row is asserted absent);
      - pause → excluded from totals and the process sweep, then resume;
      - Detect from history: candidate found, Add as recurring, then gone.

      Dates via `businessToday()` / `businessDatePlus()` only.
- [ ] Both themes checked rendered; no `dark:` variants.

## Out of scope

The composer (owner rule). Usage tracking and any "Unused" claim.
Per-rule splits ("shared 3 ways"). Month navigation on the calendar (the
mock has none). Linking posted transactions to their rule.

**Still needed?** No — shipped. [PR #248](https://github.com/moascode/daybook/pull/248), merged 2026-10-07.
