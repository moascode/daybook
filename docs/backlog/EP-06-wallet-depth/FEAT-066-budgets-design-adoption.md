> **Status:** Open · **Filed:** 2026-10-02 · **Revised:** 2026-10-04 · **Epic:** [EP-06](README.md)

# FEAT-066 — Budgets: exact mock parity

**What.** `BudgetsPage.tsx` renders as a single narrow column
(`max-w-2xl mx-auto`) with a simplified summary band and a plain card list
per category. The mockup's `budgets.html` is a full 12-column grid page with
a richer month band, a per-category **table**, and a repositioned,
restyled Suggestions card. Confirmed against both the real rendered DOM
(`/wallet/budgets`, seeded data) and the mockup's rendered DOM
(`http://localhost:4873/budgets.html`), 2026-10-02/04.

**Revision note.** This item originally (2026-10-02) scoped only "add the
composer," on the theory that everything else here was either already a
deliberate, reviewed simplification (FEAT-017) or genuinely unbuilt
computation already tracked by FEAT-018. On review, that was too narrow:
the owner wants this page built to **exact mock parity**, with the single
carve-out that Budgets (a "Plan" page, not a transaction-entry page) does
**not** get the composer. This revision reflects that scope. FEAT-017's
archived "intentional simplification" note is superseded by this item for
the pieces it covers (the band stats, the per-row pace treatment) — it is
not being silently overridden, the owner made the call directly.

## Acceptance criteria

**Layout**
- [ ] Page root uses the `.dash` 12-column grid (matching every other
      restyled Wallet page), not `max-w-2xl`.
- [ ] Card order: month summary band (`c12`) → per-category table (`c12`)
      → Budget-vs-actual (`c7`) + Suggestions (`c5`) side by side. Today
      Suggestions renders first, full-width, alone — it moves to the bottom
      pair.
- [ ] Page header subtitle becomes `"{Month} · {daysLeft} days left"`
      (computed, replacing the static "Monthly spend limits per category").
- [ ] Page header gains a `"{Month}" / "Rolling 30d"` segmented toggle
      (`role="tablist"`, matching the pattern `Dashboard.tsx`'s Month/Year
      toggle already uses).

**Rolling 30d mode** (stated simplification — documented here, not hidden)
- [ ] In this mode, each category's "Spent" sums transactions over the
      trailing 30 days (today − 29 … today) instead of calendar
      month-to-date; "Left" = `limit − spent` on that same window.
- [ ] The pace notch, "today — you should be at $X" caption, and the month
      band's "Projected finish" / "On track N of M" stats are **omitted**
      in this mode (a trailing window has no "day N of the period" to
      project a pace from) — the band shows the headline figure and a
      plain progress bar only. This is an honest simplification, not a bug
      to "complete" later without a product decision on what "pace" even
      means for a rolling window.

**Month summary band**
- [ ] Three stats replace the current "Remaining / Categories / Over
      budget": **Left to spend** (`limit total − spent total`, with a
      "$X a day for Y days" sub-line), **Projected finish**
      (`spentTotal / elapsedFraction`, sub-line stating the over/under
      amount), **On track N of M** (see chip rule below for what counts).
- [ ] A chip in the card head reads `"{N} points ahead of pace"` where
      `N = round((spentTotal/budgetedTotal − elapsedFraction) × 100)`,
      shown only when positive (ahead); omitted, not shown as negative or
      zero, when behind or exactly on pace — inventing a "behind pace"
      framing the mock never shows isn't this item's call to make.
- [ ] Full-width pace track beneath the band: fill = `spentTotal/budgetedTotal`,
      a marker at `elapsedFraction`, and a caption row
      ("1 {Mon} … today — you should be at $X … {last day} {Mon}").

**Per-category table** (replaces the current card list)
- [ ] `.lhead` column headers: Category · Pace · Spent · Left · Status.
- [ ] One `.lrow` per budget: colored `.cat-dot` (category's own color) +
      name + "$X limit" sub-line; a `.budget-track`/`.budget-fill` pace bar
      with a `.budget-mark` notch at `elapsedFraction`; Spent; Left;
      a Status chip.
- [ ] **Status chip — a stated-threshold approximation**, not a literal
      reproduction of the mock's 6 example rows (two of which have nearly
      identical numbers but different chips in the static mockup, so no
      single rule reproduces all six; this rule is internally consistent
      instead):
      ```
      ratio = spent / effectiveLimit
      aheadPts = (ratio − elapsedFraction) × 100
      over-limit OR aheadPts ≥ 20   → "Over pace"  (chip-neg)
      aheadPts ≥ 8                  → "Tight"      (chip-warn)
      aheadPts < 8, but ratio ≥ 0.70 → "Watch"     (chip-mute)
      otherwise                     → "On track"   (chip-pos)
      ```
      Note: "Watch" is reachable with `aheadPts` anywhere below 8, including
      a small positive value (modestly ahead but not "Tight" yet) — not only
      the behind-or-exactly-on-pace case the wording above might suggest.
      Gate 2 review flagged this as a docs/code wording mismatch and judged
      the code's actual behaviour the more sensible of the two; this doc was
      corrected to match the code rather than the other way around.
      Tunable after review — the thresholds (20/8/0.70) are this item's
      best-effort pick, called out explicitly so they're easy to find and
      change, not buried as a magic number.
- [ ] Month band's "On track N of M": N = count of budgets whose chip is
      "On track" or "Watch" (both read as "not a pace problem"); the
      "{M−N} need attention" sub-line counts "Tight" + "Over pace".

**Suggestions card**
- [ ] Repositioned to the bottom `c5` slot (paired with Budget-vs-actual).
- [ ] Card head gains the mock's subtitle: "From six months of your own
      behaviour."
- [ ] Every row restyled from the current plain `flex items-center` line to
      the mock's `.sug` pattern: colored `.tavatar` icon circle (per-type
      colour — info/warn/calm/alt, matching the mock's four examples),
      bold `.sug-title` + `.sug-sub` two-line text, `.btn.btn-secondary.btn-sm`
      action button. Existing copy/logic for the 3 shipped types
      (reallocate/right-size/create-missing — FEAT-018) is preserved;
      only the markup changes.
- [ ] Closing insight line beneath a divider: names the one or two
      categories responsible for the largest share of total overspend this
      month ("{Cat} and {Cat} are {N}% of all overspend. Everything else is
      behaving.") — computed from the same spending data already loaded,
      honest fallback when there's no overspend this month (card simply
      omits the line, same "don't show a sentence with nothing behind it"
      rule used elsewhere).

**Roll-forward (new, 4th suggestion type)**
- [ ] New additive column: `budgets.rollover_enabled INTEGER NOT NULL DEFAULT 0`
      (migration `00XX_budget_rollover.sql`). No other schema change — no
      accumulating multi-month "bank," to avoid compounding logic that
      could silently drift; a budget's effective limit only ever folds in
      **last month's** leftover.
- [ ] `effectiveLimit(budget) = budget.limitAmount + (budget.rolloverEnabled
      ? max(0, budget.limitAmount − spendIn(history, categoryId, previousMonth))
      : 0)`. Every "Spent/Left/pace/status" computation above uses
      `effectiveLimit`, not raw `limitAmount`, once rollover is on.
- [ ] New suggestion rule in `insights.ts`: a budget consistently under-used
      over the same 3-month window `reallocateSuggestions` already checks,
      **not already matched as a reallocate donor** (avoids offering two
      conflicting treatments — move the slack vs. bank it — for the same
      underuse), and not already `rolloverEnabled`. Copy: "Roll unused
      {Category} forward" / "{amount} left over, {N} months running."
      `PATCH /budgets/:id { rolloverEnabled: true }` on "Enable."
- [ ] `GET /budgets` returns `rolloverEnabled` on every row;
      `PATCH /budgets/:id` accepts it (boolean → `0`/`1`).

**No composer.** Budgets is a "Plan" page, not a transaction-entry page —
unlike Accounts/Shared (FEAT-065/069), it does not get the composer even
though the mockup shows one.

**Also fixes.** [FEAT-018](FEAT-018-budgets-suggestions.md)'s doc says
"Still needed: Yes" — stale; all 3 of its PRs (#214/#215/#216) are merged.
This item corrects that status as part of the same PR.

## Known trade-offs (Gate 2 review, acknowledged not fixed)

- **Suggestion copy for the 3 pre-existing types changed**, not just their
  markup — e.g. "Raise X to RM Y" wording, shortened button labels
  (Apply/Raise/Create). This reads closer to the mock than the original
  sentence-style copy and is almost certainly wanted, but it's a deliberate
  deviation from this item's original "copy preserved, markup only" plan,
  flagged here so it isn't mistaken for drift.
- **Rollover and the suggestion engine's other rules see different numbers.**
  `computeBudgetVsActual` (the 6-month chart) and the reallocate/right-size
  rules still compare against the raw `limitAmount`, not `effectiveLimit` —
  so a rollover-enabled budget can look "On track" in its own row while still
  being offered as a reallocate *receiver* (its raw limit is still exceeded).
  Reconciling the whole suggestion engine to rollover-aware limits throughout
  is a larger change than this item's scope; flagged for a future pass if it
  proves confusing in practice.
- **No way to turn rollover back off** once enabled (no toggle in the edit
  modal, no per-row indicator beyond the Left-vs-configured-limit
  difference). The AC never asked for either; noted as a gap, not a bug.
- **Roll-forward and reallocate both use a 3-month window that includes the
  current, still-in-progress month.** Early in a calendar month, a
  thin-history budget's current-month "leftover" sits close to its full
  limit, which can inflate `avgLeftover` and make a budget that's
  genuinely on pace this month still surface a roll-forward suggestion
  (on top of F4's never-used-budget guard, which only excludes the
  no-history case). This is an existing characteristic of
  `reallocateSuggestions`' donor detection (FEAT-018, shipped before this
  item) that `rollForwardSuggestions` inherited by reusing the same window
  — not a new regression, but worth a dedicated look if it recurs often
  with real usage data.

## Out of scope

Everything in [FEAT-019](FEAT-019-goals-trajectory.md),
[FEAT-020](FEAT-020-recurring-calendar.md),
[FEAT-021](FEAT-021-recurring-anomalies.md) — other pages, not touched here.
No change to `BudgetVsActualChart.tsx`'s existing SVG-free bar-chart
implementation (already functionally equivalent to the mock's SVG version —
same information, same over/under colour cue, already verified).

**Still needed?** Open.
