> **Status:** Open · **Filed:** 2026-10-02 · **Epic:** [EP-07](README.md)

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
- [ ] A `.segment` 30d/6m/All range toggle (default "6m" per the mockup),
      filtering the "Recently finished" list and its day groups by
      `completedAt` — the heatmap and "What you finish"/"Time to finish"
      cards stay on their existing full-year/all-time aggregation (the
      heatmap is explicitly "a year of finishing things," constant
      regardless of the list's range).
- [ ] An "Export" button that triggers an immediate client-side CSV
      download of the currently-filtered completed tasks (content, list
      name, completed date) — no modal/picker (the mockup shows a single
      click, not Wallet's `ExportModal` multi-step flow; don't import that
      pattern's complexity for a single-click affordance this page
      doesn't ask for).
- [ ] Page-sub reads "N in the last year" (or "N completed" if the range
      toggle changes what's being counted — pick whichever reads more
      honestly given the toggle's actual scope, and say which in the PR).

**Heatmap card**
- [ ] `.band-main`/`.band-fig`: the existing `totalCompleted` figure with
      a "tasks completed" caption.
- [ ] `.band-stats` with three real stats, all derivable from the
      already-loaded `heatmap` array (`{date, count}[]`) with no new
      fetch: **Longest streak** (longest run of consecutive days with
      count > 0, sub-line: the date it ended), **Current streak** (the
      run ending today/yesterday, sub-line something like "best run since
      X" only if honestly computable — otherwise a simpler honest
      sub-line), **Busiest day** (which day-of-week has the highest total
      completions summed across the year, sub-line: its % share of the
      total).
- [ ] Card title/sub updated to "A year of finishing things" / "One
      square per day — darker means more done", matching the mockup
      (currently "Analytics" / inline total+avg text).

**Split into two cards**
- [ ] "What you finish" — share of completions by list: count + % of
      total, each as its own row with a progress bar (`.track`), sorted
      by count descending (not by avg-days, which is the OTHER card's
      sort).
- [ ] "Time to finish" — per-list **average** days (keep existing
      `avgDays` data, label honestly), sorted slowest-first, with the
      existing graveyard insight sentence kept exactly as it is today.

**Out of scope.** Time-tracking sub-text (no such data exists). A true
server-side median (kept as average, honestly labeled). Pagination
("Showing N of M / Load more" — the page already loads everything at
once, which isn't worse UX and isn't broken; not changing it for this
pass). Habits / List detail pages (separate future items, same pattern).

**Still needed?** Yes — the band-stats, the card split, and the page-head
controls are real, visible gaps; everything else on this page (the
heatmap itself, the day-grouped list, the graveyard insight) was confirmed
already shipped and correct.
