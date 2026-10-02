> **Status:** Archived · **Last verified:** 2026-10-02 · **Filed:** 2026-10-02 · **Shipped:** 2026-10-02 (PR #241) · **Epic:** [EP-07](../../backlog/EP-07-tasks-depth/README.md)

# FEAT-060 — Tasks: Completed page exact design adoption

**What.** Close the real gaps between `/tasks/completed` and
`proposal-v2/tasks-completed.html`. FEAT-030 already shipped the analytics
core — a year heatmap, by-list average-days-to-finish, and a "graveyard"
insight, all server-aggregated (`GET /tasks/completed/analytics`) — bundled
into one `CompletedAnalytics` card. The mockup splits this differently and
adds a few real elements this item closes. Page-scoped: **Completed only.**

**Why now.** Continuation of the FEAT-054/057/058/059 design-adoption
pass, authorized by the owner to proceed autonomously.

**Confirmed against the real rendered mockup DOM** (not assumed — lesson
from FEAT-058):
```html
<!-- page-head -->
<span class="page-sub">438 in the last year</span>
<div class="segment" role="tablist"><button>30d</button><button aria-selected>6m</button><button>All</button></div>
<button class="btn btn-secondary">Export</button>

<!-- card 1: heatmap -->
<section class="card card-pad c12">
  <div class="card-head">"A year of finishing things" / "One square per day…" + .heat-key</div>
  <div class="heat">…364 days of squares…</div>
  <div class="band"><div class="band-main"><div class="band-fig">438 / "tasks completed"</div></div>
    <div class="band-stats">
      Longest streak / 23 days / "ended 4 June"
      Current streak / 9 days / "best run since May"
      Busiest day / Sunday / "31% of everything you finish"
    </div></div>
</section>

<!-- card 2: recently finished (c8) — day-grouped list, a filter input, unchanged otherwise -->
<!-- card 3: "What you finish" — share of completions BY LIST (count + %, progress bar) -->
<!-- card 4: "Time to finish" — per-list average days + the existing graveyard insight -->
```
This confirms the mockup splits the current single `CompletedAnalytics`
card into the heatmap+streaks card (unchanged scope) plus two SEPARATE
cards — one for completion *share* by list, one for *speed* by list — not
one combined list. No composer appears anywhere on this page (completing
isn't composing), so none is added here, unlike every other Tasks page in
this pass.

**No fabricated time-tracking.** The mockup's "Today … 1h 12m of tracked
work" sub-text implies a time-tracking feature this app doesn't have
anywhere in its data model — not built here, consistent with this pass's
standing rule against inventing data (same reasoning as Today's and
Upcoming's skipped historical-comparison stats).

**"Median" vs "average."** The mockup labels the by-list figures "median,"
but `GET /tasks/completed/analytics` computes a mean (`avgDays`) — this
item keeps the existing average and labels it honestly as "average," not
"median." Changing the server aggregation to a true median is a bigger
lift out of scope for a wiring pass; flag it separately if exact mockup
wording matters enough to the owner to justify the backend change.

## Acceptance criteria

**Page head**
- [x] A `.segment` 30d/6m/All range toggle (default "6m"), filtering the
      "Recently finished" list and its day groups by `completedAt` — the
      heatmap and "What you finish"/"Time to finish" cards stay on their
      existing full-year/all-time aggregation, confirmed by tracing the
      data flow in review.
- [x] An "Export" button, single click, client-side CSV of the
      currently-filtered completed tasks (content, list name, completed
      date) — RFC-4180 quote-escaping plus a leading-apostrophe guard
      against formula injection, with a try/catch surfacing a toast on
      failure (CLAUDE.md rule 10).
- [x] Page-sub is range-dependent ("N in the last 30 days" / "N in the
      last 6 months" / "N completed") rather than a fixed "N in the last
      year" — reads correctly for whichever range is selected rather than
      claiming a window the toggle has already changed.
- [x] An honest empty state when the selected range has zero completions
      but the user has completed tasks outside it (`completed-empty-range`,
      distinct from the genuine "never completed anything" state) — caught
      in review; the first pass showed the wrong message here.

**Heatmap card**
- [x] `.band-main`/`.band-fig`: the sum of the loaded `heatmap` array
      (364-day window) rather than the server's all-time `totalCompleted`
      — caught in review: the original figure disagreed with the card's
      own "Busiest day" percentage (which is necessarily heatmap-scoped)
      for any user with over a year of history. `totalCompleted` keeps its
      honest all-time meaning everywhere else it's used.
- [x] `.band-stats`: **Longest streak**, **Current streak** (with a "best
      run since X" sub-line when an earlier, equal-or-longer run exists,
      falling back to an honest "N days running" otherwise), **Busiest
      day** — all derived client-side from the already-loaded `heatmap`
      array, no new fetch. Streak math reviewed in detail (boundary
      handling, UTC-safe date arithmetic, tie-breaking) and confirmed
      correct.
- [x] Card title/sub: "A year of finishing things" / "One square per day
      — darker means more done", plus the mockup's `.heat-key` Less→More
      legend (the CSS already existed, unused until now).

**Split into two cards**
- [x] "What you finish" — count + % share per list with a `.track` bar,
      sorted by count descending.
- [x] "Time to finish" — per-list average days, labeled "average" (not
      the mockup's "median," which the data doesn't compute), sorted
      slowest-first, with the pre-existing graveyard insight unchanged.

**Deferred, not built:** the mockup's "Filter completed…" search input
on the "Recently finished" card — real search/filter logic against the
day-groups is a bigger feature than this wiring pass's scope, flagged
explicitly rather than skipped silently.

**Out of scope.** Time-tracking sub-text (no such data exists). A true
server-side median (kept as average, honestly labeled). Pagination
("Showing N of M / Load more" — the page already loads everything at
once, which isn't worse UX and isn't broken; not changing it for this
pass). Habits / List detail pages (separate future items, same pattern).

**Still needed?** Shipped — PR to follow.
