> **Status:** Archived · **Last verified:** 2026-10-03 · **Filed:** 2026-10-02 · **Shipped:** 2026-10-03 (PR #243) · **Epic:** [EP-07](../../backlog/EP-07-tasks-depth/README.md)

# FEAT-061 — Tasks: Habits page exact design adoption

**What.** Close the real gaps between `/tasks/habits`
(`src/modules/tasks/TasksHabitsPage.tsx`) and `proposal-v2/tasks-habits.html`.
FEAT-029 already shipped the real functionality — per-habit current/best
streak, a 28-day due/done grid, a 12-week weekday-rate chart with a
"weakest day" callout, archive/delete, and the Wallet-linked "no spend day"
habit (`linked_kind`). The mockup's visual language is entirely different
(rings instead of a square grid, a dot strip instead of 7×4 squares, a
summary card, an aggregate weekday chart, a "Worth knowing" rail) but **all
of the CSS for it already shipped** in earlier pages — `.ring`/`.ring-center`
(`src/styles/charts.css`), `.dots`/`.habit`/`.habit-main`
(`src/styles/tasks.css`), `.goal-name`/`.goal-sub`/`.stat-foot`/`.sug`/
`.tavatar` (`src/styles/data.css`), `.bars`/`.bars-avg`/`.bar-fill`
(`src/styles/charts.css`), `.chip-pos`/`.chip-mute` (`src/styles/primitives.css`).
This item is wiring those onto real habit data, not new CSS. Page-scoped:
**Habits only.**

**Why now.** Continuation of the FEAT-054/057/058/059/060 design-adoption
pass, authorized by the owner to proceed autonomously.

**Confirmed against the real rendered mockup DOM** (`document.querySelector('.content').outerHTML`
at `http://localhost:8901/tasks-habits.html`, not assumed):
```html
<!-- page-head -->
<span class="page-sub hide-mobile">4 active · 9-day streak</span>
<button class="btn btn-primary">New habit</button>

<!-- card 1: "Consistency" (c12) -->
<span class="chip chip-pos">3 of 4 above 70%</span>
<div class="band"><div class="band-main"><div class="band-fig">
  <span class="v">78%</span><span class="k">of habit days kept, last 30</span>
</div></div>
  <div class="band-stats">
    Current streak / 9 days / "all four kept"
    Longest ever / 23 days / "ended 4 June"
    Weakest day / Friday / "52% kept"
  </div></div>

<!-- cards 2-5: one per habit (c6, 2-up grid), replaces current square-grid card -->
<section class="card card-pad c6"><div class="habit">
  <div class="ring"><svg role="img" aria-label="Morning run completed 87% of days.">
    <circle stroke="rgb(var(--track))"/><circle stroke="rgb(var(--calm))" stroke-dasharray="…"/></svg>
    <div class="ring-center"><span class="v">87%</span><span class="k">30 DAYS</span></div></div>
  <div class="habit-main">
    <div class="goal-name">Morning run</div>
    <div class="goal-sub">Every day before 08:00 · Errands</div>
    <div class="dots"><i class="on"/>…28 of them, class on/miss/(empty=not-due)…</div>
    <div class="stat-foot"><span class="streak">🔥 14-day streak</span><span>best 21 days</span></div>
  </div>
  <button class="icon-btn" aria-label="Habit options">⋮</button>
</div></section>
<!-- (ring stroke color varies per habit: --calm/--info/--alt/--warn — cosmetic, cycles) -->

<!-- card 6: "Kept by weekday" (c8) -->
<div class="card-sub">All habits, last 12 weeks</div>
<div class="bars"><div class="bars-avg" style="bottom:80px"/>
  <div class="bar hi"><span class="bar-val">91%</span><div class="bar-fill"/><span class="bar-day">Mon</span></div>…
</div>
<div class="divider"/>
<div>"Friday is the only day below 70%. …" (free-text insight)</div>

<!-- card 7: "Worth knowing" (c4) -->
<div class="sug"><div class="tavatar">⚠</div>
  <div class="sug-main"><div class="sug-title">"No spend day" is at 48%</div>
    <div class="sug-sub">Target is 3 a week, you average 1.4</div></div>
  <button class="btn btn-secondary btn-sm">Lower it</button></div>
<!-- …2 more .sug rows, one with a "Move" button -->
```

## What this item does NOT build (scoped out, same reasoning as FEAT-054/057/060)

- **No "Lower it" / "Move" action buttons on "Worth knowing."** These imply
  real features this app doesn't have — auto-adjusting a habit's weekly
  target, and moving specific *tasks* (a different entity) off a specific
  weekday based on a cross-module schedule-conflict analysis. FEAT-031's
  shipped "Worth knowing" pattern on `/tasks/today`
  (`TasksTodayPage.tsx:281`) already establishes the precedent: honest,
  text-only insight rows with no action buttons, derived purely from data
  already on the page. This item follows that precedent exactly.
- **"Longest ever … ended 4 June"** is a fabrication risk if taken literally
  — `computeStats` only tracks `bestStreak`'s *value*, not the date range it
  occurred in, and only within the 84-day (12-week) stats window, not literal
  all-time history. This item extends `computeStats` (worker/routes/habits.ts)
  to also return `bestStreakEnd: string | null` — the date the longest run in
  that window ended — a small addition to the loop that already computes
  `bestStreak`, no schema change. The card is honestly scoped to the stats
  window: labeled "Longest, last 12 weeks" rather than "ever."
- **"last 30" (days) on the Consistency band, "30 DAYS" on each ring.** The
  app's per-habit grid (`HabitStats.entries`) is a 28-day window
  (`GRID_DAYS = 28` in `worker/routes/habits.ts`), not 30 — same
  average-vs-median honesty call as FEAT-060. This item keeps 28 and labels
  it "28 DAYS" / "last 28 days," not the mockup's "30."
- **"Kept by weekday" aggregate stays client-side, no new fetch.** Computed
  by pooling `due`/`done` across all active habits' already-loaded `entries`
  arrays (28-day window) — **not** the per-habit `weekdayRates` (a 12-week
  server aggregate that can't be correctly pooled across habits client-side
  without raw counts). Labeled "All habits, last 4 weeks," not the mockup's
  "last 12 weeks," to match the window actually used.
- **No "Habit options" dropdown framework is built from scratch.** Reuses the
  existing outside-click + Escape popover pattern already shipped in
  `src/components/layout/AccountMenu.tsx` (`.pop-anchor`, ref-based
  outside-click, Escape-to-close) for a small two-item menu (Archive,
  Delete) — replacing the current two separate inline icon buttons, not
  adding new interaction infrastructure.
- **Ring stroke colors are cosmetic**, cycled per habit position (not tied to
  any data meaning in the mockup) — implemented as a fixed palette cycle
  (`--calm`, `--info`, `--alt`, `--warn`, repeating), not a new per-habit
  color field.

## Acceptance criteria

**Page head**
- [ ] `page-sub` (hidden below `md`, via the existing `.hide-mobile` utility)
      reads "`N active · M-day streak`" — N = count of non-archived habits,
      M = the "all habits kept together" current streak (see Consistency
      card below); omits the "· M-day streak" clause honestly when M is 0
      rather than showing "· 0-day streak."
- [ ] "New habit" button becomes `btn btn-primary` sizing/icon to match the
      mockup (currently `Button size="sm"` default variant) — same click
      handler, same modal.

**Consistency card (new, `card card-pad c12`, first in the grid)**
- [ ] `band-fig`: sum of `kept` across all active habits' due days in the
      28-day window ÷ sum of `due` across the same, as a %, labeled "of
      habit days kept, last 28 days."
- [ ] `band-stats`: **Current streak** — a joint streak counting back from
      today where, for every date, every habit due that day was done (a
      habit not due that day doesn't break it) — with a "all N kept" / "best
      run since X" / honest "N days running" sub-line, same three-state
      pattern FEAT-060 used for its heatmap current-streak. **Longest, last
      12 weeks** — max per-habit `bestStreak` across all habits, with its
      `bestStreakEnd` date (new field, see above) as the sub-line. **Weakest
      day** — the single (day, habit) pair with the lowest `weekdayRates`
      value among habits with at least one due day that weekday, shown as
      the day name + "N% kept."
- [ ] Chip: "`K of N above 70%`" — K = count of active habits whose 28-day
      window kept-rate (due days kept ÷ due days, within the grid window) is
      ≥ 0.7, N = total active habits. `chip-pos` when K/N ≥ 0.5 of N,
      `chip-mute` otherwise (matches the existing chip-tone convention from
      FEAT-059/060's positive-vs-neutral chips).

**Per-habit cards (`card card-pad c6`, 2-up grid, replaces the current square
grid card)**
- [ ] `.ring`: SVG circular progress, `stroke-dasharray` driven by the
      habit's 28-day kept-rate (not the mockup's 30), `role="img"` with
      `aria-label="{name} completed {pct}% of days."` — matches the mockup's
      accessible-name pattern exactly (confirmed in the real DOM above).
      `ring-center` shows the same % + "28 DAYS."
- [ ] `.goal-name` / `.goal-sub`: habit name, then a schedule description —
      "Every day" (schedule `null`), "Weekdays" (schedule is exactly
      Mon–Fri), "Every N days" is **not** built (the data model has no
      every-N-days cadence, only a weekly day-of-week schedule — the mockup's
      "Water the plants / Every 3 days" is a cadence shape this app doesn't
      support; day-of-week habits render their selected days, e.g. "Mon, Wed,
      Fri") — plus a list/category label only when one genuinely exists on
      the habit (none does today; the mockup's "· Errands" / "· Wallet"
      segment is  omitted rather than inventing a category system, except
      the one real case: linked habits show "· Wallet", same as today's
      `chip-mute` "Linked · Wallet", reusing the real `linkedKind`).
- [ ] `.dots`: 28 `<i>` elements replacing the current 7×4 square grid —
      `on` (kept), `miss` (due, missed), empty class (not due) — same
      `entry.due`/`entry.done` data, same click-to-toggle for unlinked
      habits (click handler moves from the square button to the dot,
      `disabled`/no-op cursor preserved for linked habits).
- [ ] `.stat-foot`: flame icon + "`N-day streak`" (today's `currentStreak`,
      unchanged math) + "`best N days`" (today's `bestStreak`).
- [ ] `.icon-btn` "Habit options" popover (Archive, Delete) replacing the two
      separate inline icon buttons — same underlying `onArchive`/`onDelete`
      handlers, `AccountMenu.tsx`'s outside-click/Escape pattern reused.

**"Kept by weekday" card (new, `card card-pad c8`)**
- [ ] `.bars`: one bar per weekday, pooled kept/due across all active
      habits' 28-day `entries`, `bar-val` = rounded %, `bar.hi` class for
      bars at/above some habit's single highest day (matches the mockup's
      visual emphasis on the top day(s), not a fixed threshold).
- [ ] `.bars-avg` dashed line at the pooled all-days average %.
- [ ] Insight line below the divider: names the single weakest day **only
      when** it's genuinely below 70% pooled — "`{Day} is the only day below
      70%.`" when exactly one qualifies, "`{Day} and {Day} are below 70%.`"
      for two, honest fallback ("Every day is holding at 70% or higher.")
      when none do. **No "squeezed out by scheduled tasks" causal claim** —
      the mockup's "it is also the day with the most scheduled tasks" ties
      habits data to Tasks' due-date load, which is a real cross-module join
      this item does not build; omitted.

**"Worth knowing" card (new, `card card-pad c4`)**
- [ ] Text-only `.sug` rows (no action buttons — see scope note above),
      each conditionally shown only when genuinely true, same pattern as
      `TasksTodayPage.tsx`'s `worthKnowing` array:
      - Weakest habit (lowest 28-day kept-rate) when below 60%: "`"{name}"
        is at N%`" / "`kept N of M due days`."
      - Strongest habit (highest 28-day kept-rate) when at or above 85% AND
        `bestStreak` ≥ 14: "`"{name}" is holding strong`" / "`N% kept, M-day
        best streak`."
      - A habit at/above 80% kept-rate for the full 12-week `weekdayRates`
        window (average of the 7 rates ≥ 0.8): "`A habit kept above 80% for
        12 weeks almost never lapses. {count} of yours {is/are} there.`"
        (matches the mockup's closing insight, generalized to the real
        count instead of a hardcoded "Two").
      Empty state: when none of the three conditions fire (too few habits
      or no signal yet), the whole card is omitted rather than rendering
      empty — same "don't show a card with nothing in it" rule as prior
      pages' empty-state handling.

**Out of scope.** "Lower it"/"Move" actions (no backend for either). Literal
"ever" streaks and dates beyond the 12-week stats window. Every-N-days
habit cadence (data model only supports weekly day-of-week). Cross-module
"squeezed out by tasks" claims. List/category labels for habits (no such
field exists beyond the one real `linkedKind` case). List detail page
(separate future item, same pattern).

**Still needed?** Open.
