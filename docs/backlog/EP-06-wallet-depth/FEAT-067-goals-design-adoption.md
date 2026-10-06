> **Status:** Open · **Filed:** 2026-10-02 · **Revised:** 2026-10-06 · **Epic:** [EP-06](README.md)

# FEAT-067 — Goals: exact mock parity

**What.** `GoalsPage.tsx` renders as a single narrow column
(`max-w-2xl mx-auto`): a three-stat summary band, then one card per goal
with a linear progress bar and inline edit/delete icons. The mockup's
`goals.html` is a 12-column grid page: a "Saving toward" band with a
per-goal segmented bar and legend, a 2-up grid of **ring** cards with a
status chip and an honest ETA, a **Total saved** trajectory chart, and a
**Next milestones** card that closes on the knock-on consequence. Confirmed
against the mockup's rendered DOM (`http://localhost:4873/goals.html`) and
the real page's source and data model, 2026-10-06.

**Revision note.** Originally (2026-10-02) filed composer-only — the same
too-narrow scoping [FEAT-066](FEAT-066-budgets-design-adoption.md) started
with. On review the owner wants exact mock parity, with the standing
carve-out that Goals is a **"Plan" page and gets no composer**, even though
the mockup shows one. This revision therefore **absorbs
[FEAT-019](FEAT-019-goals-trajectory.md)** (rings, funding rate, honest
ETA, trajectory, milestones — R9) whole: almost none of this page's gap is
restyle; it is the funding-rate computation FEAT-019 tracked. FEAT-019 is
marked superseded by this item in the same PR.

**What the data model already gives us, and what it doesn't.** A goal's
"saved" figure is its linked account's balance (clamped to
`[0, target]`), so *contributions* are derivable from that account's
transaction history with no new table. What does not exist is a **target
date** — without one there is no "On track / Behind / Ahead" and no
"needs $X/mo." Owner decision 2026-10-06: add it (nullable) rather than
reduce the page to ETA-only.

## Owner decisions (2026-10-06)

| Question | Decision |
|---|---|
| Target date | Add nullable `goals.target_date` + `goals.note` (card subtitle). Paused is **derived**, not stored |
| Funding-rate rule | Average monthly net inflow over the last **3 complete** calendar months (below) |
| "Interest earned" stat | **Dropped** — no interest/growth data exists; the band shows two stats, not three |
| Trip-tag chip ("Tokyo & Kyoto") | **Dropped** — no goal↔trip link exists |
| "$700 automatic · $140 top-ups" sub-line | **Dropped** — would need transaction↔recurring-rule matching. "Added this month" keeps its figure, with a plain sub-line |
| "Room for another $X" row | **Kept**, with the stated rule below |
| PR split | **One PR** |

## Stated rules (assumptions — documented, tunable, not hidden)

All of these are this item's best-effort picks, called out so they are easy
to find and change rather than buried as magic numbers.

- **Net inflow** of an account in a period = income − expense − transfers
  out + transfers in, excluding `is_non_cash` rows — exactly the arms
  `GET /accounts/balances` sums, bucketed by month.
- **Funding rate** (`rate`, per goal) = mean net inflow of the linked
  account over the last 3 **complete** calendar months, floored at 0.
  The current, in-progress month is excluded so a payday on the 25th does
  not swing the figure.
- **Paused** = no positive net-inflow month in that 3-month window **and**
  no positive inflow so far this month. Chip sub-line: "no contribution
  since {Mon}" (last month with positive inflow), or "no contributions yet"
  if there has never been one.
- **ETA** = today + `ceil((target − saved) / rate)` months, when `rate > 0`.
  No ETA (shown as "—") when paused or `rate = 0`.
- **Status chip** (only when the goal is not complete and not paused):
  - no target date → no chip, sub-line "full by {ETA Mon YYYY} · $R/mo";
  - with a target date, `needed = (target − saved) / monthsUntil(targetDate)`
    (months ≥ 1):
    - ETA ≥ 1 month before target date → **Ahead** (`chip-pos`), "done N months early";
    - `rate ≥ needed` → **On track** (`chip-pos`), "full by {ETA} · $R/mo";
    - otherwise → **Behind** (`chip-warn`), "needs $needed/mo, getting $R";
    - target date already passed → **Behind**, "target was {Mon YYYY}".
- **Complete** (`saved ≥ target`) → **Funded** chip (`chip-pos`), no ETA.
- Shared linked account: if two goals link the same account, both read the
  same balance — **existing behaviour, unchanged**. Band totals keep the
  current per-goal clamp sum (no de-duplication), as today.

## Acceptance criteria

**Schema** (additive only)
- [ ] Migration `worker/migrations/0026_goal_target_date.sql`:
      `ALTER TABLE goals ADD COLUMN target_date TEXT;` and
      `ALTER TABLE goals ADD COLUMN note TEXT;` (both nullable, no default).
      Mirrored in `server/migrations/0025_goal_target_date.sql` so
      `scripts/schema-diff.mjs` parity holds.
- [ ] `Goal` type gains `targetDate: string | null`, `note: string | null`.
      `GET /goals` returns them; `POST`/`PATCH /goals` accept them
      (`targetDate` validated as an ISO `YYYY-MM-DD` date or `null`; `note`
      trimmed, ≤ 80 chars, empty → `null`).
- [ ] New `GET /goals/flows` returns, per goal-linked account visible to
      the user, monthly net inflow (`{ accountId, month: 'YYYY-MM', net }`)
      for every month with activity — one query, the same `is_non_cash = 0`
      filtering as `/accounts/balances`. Drives the rate, paused state,
      "Added this month," and the trajectory history.

**Layout**
- [ ] Page root uses the `.dash` 12-column grid, not `max-w-2xl`.
- [ ] Card order: band (`c12`) → goal cards (`c6` each, 2-up) → Total saved
      chart (`c8`) + Next milestones (`c4`).
- [ ] Header subtitle: `"{N} active · {totalSaved} saved"` (active = not
      yet complete).
- [ ] Header actions: **Add money** (`btn-secondary`) and **New goal**
      (primary). **No composer** (owner rule).
- [ ] Empty state (no goals) unchanged in behaviour.

**"Saving toward" band**
- [ ] Head: "Saving toward {totalTarget}" / "Across {N} goals, at
      {totalRate} a month"; chip "All {N} funded on time at the current
      rate" (`chip-pos`) only when every dated, non-complete goal is On
      track or Ahead; otherwise "{k} behind at the current rate"
      (`chip-warn`); omitted when no goal has a target date.
- [ ] Figure `{totalSaved}` + "{pct}% of the way".
- [ ] Two stats: **Added this month** (sum of this month's positive net
      inflow across linked accounts; sub-line "across {k} goals") and
      **Still to go** (`totalTarget − totalSaved`; sub-line "about {M}
      months at {totalRate}", or "no current funding" when `totalRate = 0`).
- [ ] Segmented bar: one segment per goal, width = `saved / totalTarget`,
      each goal's own colour from a fixed 4+ colour cycle (mock: green,
      blue, violet, amber); legend row "{name} {saved} · {rate}/mo" or
      "· paused".

**Goal cards**
- [ ] SVG ring (`.ring`, stroke = goal colour, track = `--surface-hover`),
      centre "{pct}% / FUNDED".
- [ ] `.goal-name`, `.goal-sub` (the `note`, omitted when null), figure
      "{saved} of {target}", status chip + sub-line per the rules above.
- [ ] A `⋯` icon button opens a menu with **Edit** and **Delete** (replacing
      the two inline icons); accessible names "More actions for {name}",
      "Edit {name}", "Delete {name}" — existing e2e selectors keep working.
- [ ] Edit/New goal modal gains optional **Target date** (date input) and
      **Note** fields. Clearing the date stores `null`.

**Total saved chart**
- [ ] SVG line chart: solid actual line (month-end saved total, history
      reconstructed backwards from today's balances via the monthly flows,
      each goal clamped to `[0, target]`), dashed projection from today at
      `totalRate` until `totalTarget` or the window end, a dashed
      horizontal "{totalTarget} target" line, and a "today" marker.
- [ ] Segmented `1y` / `3y` / `All` toggle (`role="tablist"`). `1y`/`3y` show
      that many years back and forward from today; `All` spans the first
      month with activity to projected completion, capped at 10 years ahead.
- [ ] Sub-line: "Actual to today, projected at the current {totalRate} a
      month". No projection drawn when `totalRate = 0`.

**Next milestones**
- [ ] Per goal (not paused, not complete), the next unreached of 25/50/75/100%,
      labelled "{name} at 25%" / "halfway" / "at 75%" / "fully funded", with
      "{amount} to go" and an estimated `Mon YYYY` at the goal's rate. Top 3
      by date. Card omitted when none.
- [ ] **Knock-on sentence** under a divider: take the first goal projected
      to be **fully funded** within 12 months; its rate is freed then.
      - If a **Behind** goal exists and the freed rate ≥ its shortfall
        (`needed − rate`): "Finishing {A} in {Mon} frees {rate}/mo — enough
        to put {B} back on schedule."
      - If a Behind goal exists but the freed rate is smaller: "… frees
        {rate}/mo — about {pct}% of what {B} is short."
      - No Behind goal: "Finishing {A} in {Mon} frees {rate}/mo."
      - No goal finishing within 12 months → sentence omitted.
- [ ] **Room for another $X** row (kept by owner decision). Rule:
      `kept` = this month's income − expense across the viewer's **own**
      accounts (via `countableAmount`, transfers excluded — §3 money
      traps); `projectedKept` = income MTD − (expense MTD /
      elapsedFraction); `room = floor50(projectedKept − addedThisMonth)`.
      Shown only when `room ≥ 50` and some goal is not complete: "Room for
      another {room}" / "You kept {kept} this month", with a button "Add to
      {goal}" targeting the most-behind goal (else the soonest-finishing
      one). Omitted otherwise — no sentence with nothing behind it.

**Add money**
- [ ] Both "Add money" (header) and "Add to {goal}" open the existing
      `TransactionForm` in create mode, pre-filled as a **transfer** whose
      destination is the goal's linked account (header button: the first
      non-complete goal, changeable in the form). Amount pre-filled with
      `room` for "Add to {goal}". On success, balances and flows reload so
      every figure on the page moves without a manual refresh.
- [ ] Every failed fetch (`/goals/flows`, balances) or submit shows a toast
      (CLAUDE.md §2 rule 10); a failed flows fetch leaves the rings/figures
      rendering and replaces rate-derived text with "—", not with zeros.

**Tests**
- [ ] `e2e/16-wallet-goals.spec.ts` updated for the ⋯ menu and new fields.
- [ ] New `e2e/9N-goals-trajectory.spec.ts`: seeded transfers into a goal
      account across 3 past months → asserts rate, ETA, On track vs Behind
      (target-date driven), Paused, a milestone row, the knock-on sentence,
      and the Add-money transfer moving the figure. Dates via
      `businessToday()` / `businessDatePlus()` only.
- [ ] Both themes checked rendered; no `dark:` variants.

## Out of scope

The composer (owner rule). Interest, trip linking, the automatic/top-up
split (dropped above). Any change to how a goal's "saved" is defined
(linked-account balance) or to shared-account double counting.

**Still needed?** Open.
