> **Status:** Open · **Filed:** 2026-09-23 · **Epic:** [EP-07](README.md)

# FEAT-059 — Tasks: Assigned to me page exact design adoption

**What.** Close the real gaps between `/tasks/assigned` and
`proposal-v2/tasks-assigned.html`. FEAT-027 already shipped the functional
core — "Waiting on you" grouped by who asked, "What you've handed out" with
a per-task "gone quiet" flag, and a turnaround-by-assignee computation —
so, like FEAT-058, this is a wiring pass on an already-substantial page,
verified against the actual rendered mockup DOM (not just raw HTML, per the
lesson from FEAT-058's first draft getting a markup assumption wrong).
Page-scoped: **Assigned to me only.**

**Why now.** Continuation of the FEAT-054/057/058 design-adoption pass,
authorized by the owner on 2026-09-23 to proceed autonomously.

**Confirmed against the real rendered mockup DOM** (not assumed):
```html
<section class="card card-pad c12">
  <div class="card-head">
    <div><div class="card-title">Between the three of you</div>
         <div class="card-sub">Who is carrying what this week</div></div>
    <span class="chip chip-mute" style="margin-left:auto">Household · 3 members</span>
  </div>
  <div class="band">
    <div class="band-main">
      <div class="band-fig"><span class="v">3</span><span class="k">tasks waiting on you</span></div>
      <div class="track">…</div>
    </div>
    <div class="band-stats">
      <div class="band-stat">You assigned out / 5 / "2 to Priya, 3 to Jordan"</div>
      <div class="band-stat">Average turnaround / 2.4 days / "Jordan 1.1, Priya 3.8"</div>
      <div class="band-stat">Never picked up / 2 / "both older than a month"</div>
    </div>
  </div>
</section>
```
This page genuinely uses the `.band-stats`/`.band-main` idiom (unlike
All-tasks, which uses `.stat-card`) — confirmed by inspecting the live DOM,
not inferred from pattern-matching against other pages.

**Reference implementations to copy, not reinvent:**
- Composer: `TaskComposer`/`TaskFormModal` (FEAT-054), reused as-is, same
  undated-stays-undated principle as Upcoming/All-tasks (a task assigned
  to someone else via `@username` composer syntax is the one meaningful
  difference in how this page's composer gets used — no special handling
  needed, the parser already resolves `@username` against household
  co-members).
- Band card idiom: `TasksTodayPage.tsx`'s `.card-head`/`.band`/`.band-main`/
  `.band-stats` (FEAT-054), which this page's actual mockup structure
  matches directly (see above) — reuse the exact classes.
- Segment toggle: `TasksTodayPage.tsx`'s Mine/Everyone `.segment` pattern
  (FEAT-054) for this page's To me/From me toggle.

## Acceptance criteria

**Composer**
- [ ] A composer at the top of the page, reusing `TaskComposer`/`TaskFormModal`
      unchanged.

**To me / From me toggle**
- [ ] A `.segment` toggle in the page head (default "To me"), switching
      between the existing "Waiting on you" section and the existing "What
      you've handed out" section — both sections already exist and are
      correct; this only changes whether both show at once or one at a
      time. Default view ("To me") shows "Waiting on you"; "From me" shows
      "What you've handed out".

**Band card**
- [ ] A `.card.card-pad.c12` card ("Between the three of you" / "Who is
      carrying what this week", with a `.chip.chip-mute` household-size
      badge) containing:
      - `.band-main`/`.band-fig`: count of tasks currently waiting on the
        viewer (already computable from `waitingByOwner`'s total) with a
        one-line caption, plus a `.track` progress bar (against what total
        is a judgement call — e.g. relative to total open household
        tasks; pick something honest and explain the choice in the PR).
      - `.band-stats` with three stats: **You assigned out** (existing
        `handedOut.length`, sub-line: real per-person breakdown, e.g. "N
        to X, M to Y"), **Average turnaround** (existing
        `turnaroundByAssignee` data, aggregate average + sub-line with the
        real per-person averages), **Never picked up** (count of handed-out
        tasks with no due date AND created over some threshold — reuse
        whatever "gone quiet" already uses for staleness — sub-line: "both
        older than a month" style, real data only).

**Out of scope.** "Nudge all" and "Add dates" bulk actions from the
mockup — both need product decisions this item doesn't have: "Nudge"
implies some notification mechanism (in-app? email?) that doesn't exist
anywhere in the app yet, and "Add dates" implies bulk multi-task date
assignment beyond the existing per-row inline date picker `TaskListRow`
already provides (users can already set a date on any handed-out row
today, just not via a single "add dates to all stale ones" affordance).
Same category as FEAT-055/FEAT-056 — needs its own product decision
first. All tasks / Completed / Habits / List detail pages (separate
future items, same pattern).

**Still needed?** Yes — the band card and composer are real, visible gaps;
the two bulk actions are correctly deferred pending a product decision.
